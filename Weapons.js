// The armoury. Every weapon is pure drawing code — no image assets, no
// sprites to ship — split into three jobs:
//
//   makeDecal(key, x, y, opts)  build a *deterministic* damage record
//   drawDecal(ctx, decal)       paint that record onto the damage canvas
//   drawIcon(ctx, key, size)    draw the weapon itself (menu tile + cursor)
//
// The split matters: all randomness is rolled once, at make time, and frozen
// into the record. That lets the damage canvas be replayed from scratch —
// same mess, same pixels — whenever the surface is lost (screen change,
// plugin reload) instead of only ever being painted incrementally.

// --- dice -------------------------------------------------------------------

function R(a, b) { return a + Math.random() * (b - a) }
function RI(a, b) { return Math.floor(a + Math.random() * (b - a + 1)) }
function pick(list) { return list[Math.floor(Math.random() * list.length)] }

// --- the shared look of broken things ---------------------------------------

var VOID = "rgba(9,9,12,0.93)"      // what's behind the desktop: nothing good
var VOID_SOFT = "rgba(14,14,18,0.72)"
var CRACK = "rgba(6,6,9,0.88)"
var SHINE = "rgba(255,255,255,0.20)" // the chiselled lip of a fresh break
var DUST = "rgba(196,190,178,0.55)"
var ASH = "rgba(214,208,196,0.42)"   // the pale rim that makes a dark hole read
var TORN = "rgba(255,255,255,0.34)"

// --- the catalogue ----------------------------------------------------------
//
// mode drives the input handling in Game.qml:
//   click  one hit per press
//   auto   keeps firing while held, every `rate` ms
//   drag   paints along the pointer path, plus one on press

var WEAPONS = [
  { key: "hammer",   name: "Hammer",        mode: "click", rate: 0,   bb: 190 },
  { key: "chainsaw", name: "Chain-saw",     mode: "drag",  rate: 0,   bb: 60 },
  { key: "gun",      name: "Machine gun",   mode: "auto",  rate: 70,  bb: 46 },
  { key: "flame",    name: "Flame-thrower", mode: "auto",  rate: 80,  bb: 90 },
  { key: "paint",    name: "Color-thrower", mode: "auto",  rate: 90,  bb: 150 },
  { key: "phaser",   name: "Phaser",        mode: "click", rate: 0,   bb: 90 },
  { key: "stamp",    name: "Stamp",         mode: "click", rate: 0,   bb: 130 },
  { key: "termites", name: "Termites",      mode: "click", rate: 0,   bb: 24 },
  { key: "wash",     name: "Washing",       mode: "drag",  rate: 0,   bb: 60 }
]

function weaponAt(index) {
  return (index >= 0 && index < WEAPONS.length) ? WEAPONS[index] : WEAPONS[0]
}

var STAMPS = ["VOID", "NULL", "404", "OOPS", "SUDO", "RM -RF", "EOF", "PWNED", "KERNEL\nPANIC"]

// --- cracks -----------------------------------------------------------------
// A crack is a jittered polyline in coordinates local to its origin, so it can
// be replayed anywhere. Width tapers to nothing along its length.

function makeCrackPath(ang, len, w, allowBranch) {
  var n = Math.max(3, Math.round(len / 15))
  var pts = [[0, 0]]
  var a = ang, cx = 0, cy = 0
  for (var i = 0; i < n; i++) {
    a += R(-0.42, 0.42)
    var step = len / n
    cx += Math.cos(a) * step
    cy += Math.sin(a) * step
    pts.push([cx, cy])
  }
  var branch = null
  if (allowBranch && n > 2 && Math.random() < 0.6) {
    branch = {
      at: RI(1, n - 1),
      path: makeCrackPath(a + (Math.random() < 0.5 ? 1 : -1) * R(0.5, 1.2),
                          len * R(0.25, 0.5), w * 0.6, false)
    }
  }
  return { pts: pts, w: w, branch: branch }
}

function drawCrack(ctx, ox, oy, cr) {
  var pts = cr.pts
  var n = pts.length - 1
  ctx.lineCap = "round"
  // Two passes: an offset highlight underneath reads as the lit edge of a
  // chip, then the dark fissure itself on top.
  for (var pass = 0; pass < 2; pass++) {
    ctx.strokeStyle = pass === 0 ? SHINE : CRACK
    var off = pass === 0 ? 1.3 : 0
    for (var i = 0; i < n; i++) {
      var taper = 1 - i / n
      ctx.lineWidth = Math.max(0.5, cr.w * taper) * (pass === 0 ? 0.75 : 1)
      ctx.beginPath()
      ctx.moveTo(ox + pts[i][0] + off, oy + pts[i][1] + off)
      ctx.lineTo(ox + pts[i + 1][0] + off, oy + pts[i + 1][1] + off)
      ctx.stroke()
    }
  }
  if (cr.branch) {
    var b = pts[cr.branch.at]
    drawCrack(ctx, ox + b[0], oy + b[1], cr.branch.path)
  }
}

// A ragged hole: a polygon of wobbling radii, so no two are alike.
function makeRagged(r, lobes, wobble) {
  var out = []
  for (var i = 0; i < lobes; i++) out.push(r * R(1 - wobble, 1 + wobble))
  return out
}

function pathRagged(ctx, x, y, radii, rot) {
  var n = radii.length
  var step = Math.PI * 2 / n
  var px = [], py = [], i, a
  for (i = 0; i < n; i++) {
    a = rot + i * step
    px.push(x + Math.cos(a) * radii[i])
    py.push(y + Math.sin(a) * radii[i])
  }
  // Curve through the midpoints with each vertex as the control point: the
  // outline keeps its irregularity but stops looking like a cut gemstone.
  ctx.beginPath()
  ctx.moveTo((px[n - 1] + px[0]) / 2, (py[n - 1] + py[0]) / 2)
  for (i = 0; i < n; i++) {
    var next = (i + 1) % n
    ctx.quadraticCurveTo(px[i], py[i], (px[i] + px[next]) / 2, (py[i] + py[next]) / 2)
  }
  ctx.closePath()
}

// --- decal factory ----------------------------------------------------------

function makeDecal(key, x, y, opts) {
  opts = opts || {}
  var p = {}
  var i

  if (key === "hammer") {
    var cn = RI(6, 10)
    var cracks = []
    var base = R(0, 6.283)
    for (i = 0; i < cn; i++)
      cracks.push(makeCrackPath(base + i * (6.283 / cn) + R(-0.3, 0.3),
                                R(40, 150), R(2.4, 4.0), true))
    var chips = []
    for (i = 0; i < RI(4, 8); i++)
      chips.push({ a: R(0, 6.283), d: R(16, 42), r: R(1.5, 4) })
    p = { r: R(11, 18), radii: makeRagged(1, RI(8, 11), 0.42), rot: R(0, 6.283),
          cracks: cracks, chips: chips }

  } else if (key === "chainsaw") {
    // One record per movement step, and each one is a *slit*: two jittered
    // edges filled as one polygon. Consecutive records share their endpoints,
    // so a drag reads as one continuous ragged cut rather than a bead chain.
    var x2 = opts.x2 !== undefined ? opts.x2 : x + R(-6, 6)
    var y2 = opts.y2 !== undefined ? opts.y2 : y + R(-6, 6)
    var cdx = x2 - x, cdy = y2 - y
    var clen = Math.sqrt(cdx * cdx + cdy * cdy) || 1
    // The kerf width belongs to the whole stroke, not to each step: rolling
    // it per segment made consecutive pieces bulge and pinch, and a row of
    // bulges is a chain, not a cut.
    var half = opts.half > 0 ? opts.half : R(3.4, 5.0)
    var samples = Math.max(2, Math.round(clen / 5))
    var edgeA = [], edgeB = []
    for (i = 0; i <= samples; i++) {
      edgeA.push(half * R(0.9, 1.12))
      edgeB.push(half * R(0.9, 1.12))
    }
    // Splinters: the odd dark sliver torn off the kerf.
    var teeth = []
    for (i = 0; i < RI(0, 2); i++)
      teeth.push({ t: R(0.05, 0.95), side: Math.random() < 0.5 ? -1 : 1,
                   d: half * R(1.3, 2.4), w: R(0.06, 0.16) })
    var dust = []
    for (i = 0; i < RI(0, 2); i++)
      dust.push({ t: R(0, 1), off: R(-34, 34), along: R(-8, 8), r: R(0.6, 1.8) })
    p = { x2: x2, y2: y2, half: half, edgeA: edgeA, edgeB: edgeB,
          teeth: teeth, dust: dust, dustAlpha: R(0.25, 0.45) }

  } else if (key === "gun") {
    var bc = []
    for (i = 0; i < RI(3, 6); i++)
      bc.push(makeCrackPath(R(0, 6.283), R(8, 22), R(1.1, 1.8), false))
    var spall = []
    for (i = 0; i < RI(5, 10); i++)
      spall.push({ a: R(0, 6.283), d: R(7, 19), r: R(0.6, 1.7) })
    p = { r: R(5, 8.5), radii: makeRagged(1, 8, 0.3), rot: R(0, 6.283),
          cracks: bc, spall: spall }

  } else if (key === "flame") {
    // `scale` lets a dying flame leave a burn the size it actually was.
    var sc = opts.scale > 0 ? opts.scale : 1
    var blobs = []
    for (i = 0; i < RI(4, 6); i++)
      blobs.push({ dx: R(-16, 16) * sc, dy: R(-16, 16) * sc,
                   r: R(20, 44) * sc, a: R(0.34, 0.62) })
    var soot = []
    for (i = 0; i < RI(14, 26); i++)
      soot.push({ dx: R(-44, 44) * sc, dy: R(-44, 44) * sc,
                  r: R(0.8, 3.2), a: R(0.25, 0.7) })
    var ash = []
    for (i = 0; i < RI(10, 20); i++)
      ash.push({ a: R(0, 6.283), d: R(24, 52) * sc, r: R(0.7, 2.6), o: R(0.2, 0.7) })
    p = { blobs: blobs, soot: soot, ash: ash, ember: R(0, 1) < 0.14, glow: R(26, 44) * sc }

  } else if (key === "paint") {
    var hue = RI(0, 359)
    var col = Qt.hsla(hue / 360, R(0.72, 1.0), R(0.45, 0.62), 0.92)
    var drops = []
    for (i = 0; i < RI(5, 12); i++)
      drops.push({ a: R(0, 6.283), d: R(24, 90), r: R(1.5, 6) })
    var drips = []
    for (i = 0; i < RI(1, 3); i++)
      drips.push({ dx: R(-14, 14), len: R(20, 80), w: R(2, 5), bulb: R(2.5, 5) })
    p = { color: col, r: R(16, 30), radii: makeRagged(1, RI(9, 13), 0.38),
          rot: R(0, 6.283), drops: drops, drips: drips }

  } else if (key === "phaser") {
    var streaks = []
    for (i = 0; i < RI(5, 9); i++)
      streaks.push({ a: R(0, 6.283), d: R(20, 60), w: R(1.2, 3) })
    p = { r: R(13, 22), radii: makeRagged(1, 10, 0.24), rot: R(0, 6.283),
          streaks: streaks, hue: R(0.5, 0.58) }

  } else if (key === "stamp") {
    p = { word: pick(STAMPS), rot: R(-0.35, 0.35), size: R(22, 34),
          hue: pick([0.0, 0.0, 0.62, 0.33]), jitter: [R(-1, 1), R(-1, 1)] }

  } else if (key === "termites") {
    // A bite: tiny, ragged, and there will be thousands of them.
    p = { r: R(1.8, 4.2), radii: makeRagged(1, 6, 0.45), rot: R(0, 6.283) }

  } else if (key === "wash") {
    p = { r: R(30, 46) }
  }

  var meta = null
  for (i = 0; i < WEAPONS.length; i++) if (WEAPONS[i].key === key) meta = WEAPONS[i]
  return { k: key, x: x, y: y, p: p, bb: meta ? meta.bb : 80 }
}

// --- decal painting ---------------------------------------------------------

function drawDecal(ctx, d) {
  var p = d.p
  var i, c

  ctx.save()

  if (d.k === "hammer") {
    for (i = 0; i < p.cracks.length; i++) drawCrack(ctx, d.x, d.y, p.cracks[i])
    // The lit lip first, then the hole punched over it.
    var lip = []
    for (i = 0; i < p.radii.length; i++) lip.push(p.radii[i] * p.r * 1.18)
    pathRagged(ctx, d.x + 1.5, d.y + 1.5, lip, p.rot)
    ctx.fillStyle = SHINE
    ctx.fill()
    var hole = []
    for (i = 0; i < p.radii.length; i++) hole.push(p.radii[i] * p.r)
    pathRagged(ctx, d.x, d.y, hole, p.rot)
    ctx.fillStyle = VOID
    ctx.fill()
    ctx.fillStyle = DUST
    for (i = 0; i < p.chips.length; i++) {
      c = p.chips[i]
      ctx.beginPath()
      ctx.arc(d.x + Math.cos(c.a) * c.d, d.y + Math.sin(c.a) * c.d, c.r, 0, 6.283)
      ctx.fill()
    }

  } else if (d.k === "chainsaw") {
    var dx = p.x2 - d.x, dy = p.y2 - d.y
    var len = Math.sqrt(dx * dx + dy * dy) || 1
    var ux = dx / len, uy = dy / len
    var nx = -uy, ny = ux
    var n = p.edgeA.length - 1
    var t, bx, by

    // Sawn-off teeth flying out of the kerf, under the slit itself.
    ctx.fillStyle = VOID_SOFT
    for (i = 0; i < p.teeth.length; i++) {
      var tooth = p.teeth[i]
      bx = d.x + dx * tooth.t
      by = d.y + dy * tooth.t
      var back = tooth.w * len
      ctx.beginPath()
      ctx.moveTo(bx - ux * back, by - uy * back)
      ctx.lineTo(bx + nx * tooth.side * tooth.d, by + ny * tooth.side * tooth.d)
      ctx.lineTo(bx + ux * back, by + uy * back)
      ctx.closePath()
      ctx.fill()
    }

    // The kerf: down one jittered edge and back along the other. Butt joins,
    // no round caps — that is what keeps a drag from beading up.
    ctx.beginPath()
    for (i = 0; i <= n; i++) {
      t = i / n
      var ax = d.x + dx * t + nx * p.edgeA[i]
      var ay = d.y + dy * t + ny * p.edgeA[i]
      if (i === 0) ctx.moveTo(ax, ay)
      else ctx.lineTo(ax, ay)
    }
    for (i = n; i >= 0; i--) {
      t = i / n
      ctx.lineTo(d.x + dx * t - nx * p.edgeB[i], d.y + dy * t - ny * p.edgeB[i])
    }
    ctx.closePath()
    ctx.fillStyle = VOID
    ctx.fill()

    // A quiet lit lip along one side, running at a constant offset rather
    // than tracing every wobble of the edge — a traced lip scallops, and a
    // row of scallops is exactly what makes a cut look like a chain.
    ctx.lineCap = "butt"
    ctx.lineJoin = "round"
    ctx.strokeStyle = "rgba(255,255,255,0.16)"
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(d.x + nx * (p.half + 0.9), d.y + ny * (p.half + 0.9))
    ctx.lineTo(p.x2 + nx * (p.half + 0.9), p.y2 + ny * (p.half + 0.9))
    ctx.stroke()

    // Sawdust thrown clear of the cut.
    ctx.fillStyle = Qt.rgba(0.77, 0.75, 0.70, p.dustAlpha)
    for (i = 0; i < p.dust.length; i++) {
      var du = p.dust[i]
      bx = d.x + dx * du.t + nx * du.off + ux * du.along
      by = d.y + dy * du.t + ny * du.off + uy * du.along
      ctx.beginPath()
      ctx.arc(bx, by, du.r, 0, 6.283)
      ctx.fill()
    }

  } else if (d.k === "gun") {
    for (i = 0; i < p.cracks.length; i++) drawCrack(ctx, d.x, d.y, p.cracks[i])
    ctx.fillStyle = "rgba(150,148,142,0.35)"
    for (i = 0; i < p.spall.length; i++) {
      c = p.spall[i]
      ctx.beginPath()
      ctx.arc(d.x + Math.cos(c.a) * c.d, d.y + Math.sin(c.a) * c.d, c.r, 0, 6.283)
      ctx.fill()
    }
    var rim = []
    for (i = 0; i < p.radii.length; i++) rim.push(p.radii[i] * p.r * 1.45)
    pathRagged(ctx, d.x, d.y, rim, p.rot)
    ctx.fillStyle = "rgba(158,155,148,0.45)"
    ctx.fill()
    var bore = []
    for (i = 0; i < p.radii.length; i++) bore.push(p.radii[i] * p.r)
    pathRagged(ctx, d.x, d.y, bore, p.rot)
    ctx.fillStyle = VOID
    ctx.fill()
    ctx.strokeStyle = ASH
    ctx.lineWidth = 1.6
    ctx.beginPath()
    ctx.arc(d.x, d.y, p.r * 1.25, 0, 6.283)
    ctx.stroke()
    ctx.strokeStyle = TORN
    ctx.lineWidth = 1.4
    ctx.beginPath()
    ctx.arc(d.x, d.y, p.r * 1.05, 0.5, 2.5)
    ctx.stroke()

  } else if (d.k === "flame") {
    for (i = 0; i < p.blobs.length; i++) {
      var b = p.blobs[i]
      var g = ctx.createRadialGradient(d.x + b.dx, d.y + b.dy, 0, d.x + b.dx, d.y + b.dy, b.r)
      // Char in the middle, scorched copper at the edge. A burn painted in
      // pure black vanishes on a dark desktop; the warm rim is what sells it.
      // Weighted towards char: one burn keeps a warm copper rim, but a
      // hundred of them stacked have to go black, not glow orange.
      g.addColorStop(0, Qt.rgba(0.02, 0.015, 0.01, b.a))
      g.addColorStop(0.45, Qt.rgba(0.09, 0.045, 0.02, b.a * 0.92))
      g.addColorStop(0.78, Qt.rgba(0.32, 0.13, 0.03, b.a * 0.42))
      g.addColorStop(0.93, Qt.rgba(0.5, 0.21, 0.05, b.a * 0.16))
      g.addColorStop(1, Qt.rgba(0.6, 0.26, 0.06, 0))
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(d.x + b.dx, d.y + b.dy, b.r, 0, 6.283)
      ctx.fill()
    }
    for (i = 0; i < p.soot.length; i++) {
      var s = p.soot[i]
      ctx.fillStyle = Qt.rgba(0.03, 0.03, 0.03, s.a)
      ctx.beginPath()
      ctx.arc(d.x + s.dx, d.y + s.dy, s.r, 0, 6.283)
      ctx.fill()
    }
    var haze = ctx.createRadialGradient(d.x, d.y, p.glow * 0.4, d.x, d.y, p.glow * 1.7)
    haze.addColorStop(0, "rgba(180,172,160,0.10)")
    haze.addColorStop(1, "rgba(180,172,160,0)")
    ctx.fillStyle = haze
    ctx.beginPath(); ctx.arc(d.x, d.y, p.glow * 1.7, 0, 6.283); ctx.fill()
    for (i = 0; i < p.ash.length; i++) {
      var sp = p.ash[i]
      ctx.fillStyle = Qt.rgba(0.84, 0.81, 0.77, sp.o)
      ctx.beginPath()
      ctx.arc(d.x + Math.cos(sp.a) * sp.d, d.y + Math.sin(sp.a) * sp.d, sp.r, 0, 6.283)
      ctx.fill()
    }
    if (p.ember) {
      // A ring of embers still glowing at the edge of the burn.
      var eg = ctx.createRadialGradient(d.x, d.y, p.glow * 0.55, d.x, d.y, p.glow)
      eg.addColorStop(0, "rgba(255,120,20,0)")
      eg.addColorStop(0.55, "rgba(255,150,40,0.30)")
      eg.addColorStop(0.85, "rgba(255,100,15,0.14)")
      eg.addColorStop(1, "rgba(255,80,10,0)")
      ctx.fillStyle = eg
      ctx.beginPath(); ctx.arc(d.x, d.y, p.glow, 0, 6.283); ctx.fill()
      ctx.fillStyle = "rgba(255,170,60,0.55)"
      ctx.beginPath(); ctx.arc(d.x, d.y, 3.5, 0, 6.283); ctx.fill()
    }

  } else if (d.k === "paint") {
    ctx.fillStyle = p.color
    for (i = 0; i < p.drips.length; i++) {
      var dr = p.drips[i]
      ctx.lineCap = "round"
      ctx.strokeStyle = p.color
      ctx.lineWidth = dr.w
      ctx.beginPath()
      ctx.moveTo(d.x + dr.dx, d.y)
      ctx.lineTo(d.x + dr.dx, d.y + dr.len)
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(d.x + dr.dx, d.y + dr.len, dr.bulb, 0, 6.283)
      ctx.fill()
    }
    var splat = []
    for (i = 0; i < p.radii.length; i++) splat.push(p.radii[i] * p.r)
    pathRagged(ctx, d.x, d.y, splat, p.rot)
    ctx.fill()
    for (i = 0; i < p.drops.length; i++) {
      c = p.drops[i]
      ctx.beginPath()
      ctx.arc(d.x + Math.cos(c.a) * c.d, d.y + Math.sin(c.a) * c.d, c.r, 0, 6.283)
      ctx.fill()
    }
    // A wet highlight so the paint reads as fresh.
    ctx.fillStyle = "rgba(255,255,255,0.18)"
    ctx.beginPath()
    ctx.arc(d.x - p.r * 0.3, d.y - p.r * 0.35, p.r * 0.22, 0, 6.283)
    ctx.fill()

  } else if (d.k === "phaser") {
    var glow = ctx.createRadialGradient(d.x, d.y, 0, d.x, d.y, p.r * 3.4)
    glow.addColorStop(0, Qt.hsla(p.hue, 1, 0.75, 0.5))
    glow.addColorStop(0.4, Qt.hsla(p.hue, 1, 0.6, 0.18))
    glow.addColorStop(1, Qt.hsla(p.hue, 1, 0.5, 0))
    ctx.fillStyle = glow
    ctx.beginPath(); ctx.arc(d.x, d.y, p.r * 3.4, 0, 6.283); ctx.fill()
    ctx.strokeStyle = Qt.hsla(p.hue, 1, 0.7, 0.5)
    ctx.lineCap = "round"
    for (i = 0; i < p.streaks.length; i++) {
      c = p.streaks[i]
      ctx.lineWidth = c.w
      ctx.beginPath()
      ctx.moveTo(d.x + Math.cos(c.a) * p.r, d.y + Math.sin(c.a) * p.r)
      ctx.lineTo(d.x + Math.cos(c.a) * c.d, d.y + Math.sin(c.a) * c.d)
      ctx.stroke()
    }
    var mol = []
    for (i = 0; i < p.radii.length; i++) mol.push(p.radii[i] * p.r * 1.3)
    pathRagged(ctx, d.x, d.y, mol, p.rot)
    ctx.fillStyle = Qt.hsla(p.hue, 0.9, 0.62, 0.55)
    ctx.fill()
    var core = []
    for (i = 0; i < p.radii.length; i++) core.push(p.radii[i] * p.r)
    pathRagged(ctx, d.x, d.y, core, p.rot)
    ctx.fillStyle = "rgba(0,0,0,0.92)"
    ctx.fill()

  } else if (d.k === "stamp") {
    ctx.save()
    ctx.translate(d.x, d.y)
    ctx.rotate(p.rot)
    var ink = Qt.hsla(p.hue, 0.75, 0.42, 0.80)
    var lines = p.word.split("\n")
    ctx.font = "bold " + Math.round(p.size) + "px monospace"
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    var wide = 0
    for (i = 0; i < lines.length; i++)
      wide = Math.max(wide, ctx.measureText(lines[i]).width)
    var boxW = wide + p.size * 1.1
    var boxH = p.size * (lines.length * 1.25 + 0.7)
    ctx.strokeStyle = ink
    ctx.lineWidth = Math.max(2, p.size * 0.13)
    ctx.strokeRect(-boxW / 2, -boxH / 2, boxW, boxH)
    ctx.lineWidth = Math.max(1, p.size * 0.06)
    ctx.strokeRect(-boxW / 2 + p.size * 0.22, -boxH / 2 + p.size * 0.22,
                   boxW - p.size * 0.44, boxH - p.size * 0.44)
    ctx.fillStyle = ink
    // Two slightly offset passes: uneven ink, like a real rubber stamp.
    for (var pass = 0; pass < 2; pass++) {
      ctx.globalAlpha = pass === 0 ? 1 : 0.45
      for (i = 0; i < lines.length; i++) {
        var ly = (i - (lines.length - 1) / 2) * p.size * 1.25
        ctx.fillText(lines[i], pass * p.jitter[0], ly + pass * p.jitter[1])
      }
    }
    ctx.globalAlpha = 1
    ctx.restore()

  } else if (d.k === "termites") {
    var bite = []
    for (i = 0; i < p.radii.length; i++) bite.push(p.radii[i] * p.r)
    pathRagged(ctx, d.x, d.y, bite, p.rot)
    ctx.fillStyle = VOID
    ctx.fill()

  } else if (d.k === "wash") {
    // The only weapon that repairs: a soft eraser punched through everything
    // painted before it. Replays in order, so the mess comes back exactly.
    ctx.globalCompositeOperation = "destination-out"
    var w = ctx.createRadialGradient(d.x, d.y, 0, d.x, d.y, p.r)
    w.addColorStop(0, "rgba(0,0,0,1)")
    w.addColorStop(0.65, "rgba(0,0,0,1)")
    w.addColorStop(1, "rgba(0,0,0,0)")
    ctx.fillStyle = w
    ctx.beginPath(); ctx.arc(d.x, d.y, p.r, 0, 6.283); ctx.fill()
    ctx.globalCompositeOperation = "source-over"
  }

  ctx.restore()
}


// --- fire -------------------------------------------------------------------
// The flame-thrower does not stamp a burn — it starts a fire. Each cell burns
// for a few seconds, wanders and flickers, can set a neighbour alight, and
// leaves a scorch behind when it finally goes out. Children inherit a slightly
// shorter life than their parent, so a blaze spreads, peaks, and dies on its
// own instead of eating the screen forever.

function makeFire(x, y, opts) {
  opts = opts || {}
  return {
    x: x, y: y,
    r: opts.r !== undefined ? opts.r : R(13, 24),
    life: opts.life !== undefined ? opts.life : R(1.6, 3.0),
    age: 0,
    phase: R(0, 6.283),
    drift: R(-11, 11),
    rise: R(4, 14),
    // Chance per *second* of catching a neighbour. Per-tick would silently
    // change the whole feel of the fire whenever the tick rate moved.
    spread: R(0.10, 0.30),
    charred: false
  }
}

// Returns the survivors and the ones that just burned out — the caller turns
// those into scorch marks.
function stepFires(list, dt, cap) {
  var alive = [], dead = []
  var i, f
  for (i = 0; i < list.length; i++) {
    f = list[i]
    f.age += dt
    if (f.age >= f.life) { dead.push(f); continue }
    f.x += f.drift * dt
    f.y -= f.rise * dt * 0.4
    alive.push(f)
  }
  var room = cap - alive.length
  if (room > 0) {
    var born = []
    for (i = 0; i < alive.length && born.length < room; i++) {
      f = alive[i]
      if (f.age < 0.35) continue           // a new flame has to take hold first
      if (Math.random() >= f.spread * dt) continue
      var a = R(0, 6.283)
      var dist = f.r * R(0.9, 2.1)
      born.push(makeFire(f.x + Math.cos(a) * dist, f.y + Math.sin(a) * dist,
                         { r: f.r * R(0.7, 1.0), life: f.life * R(0.6, 0.85) }))
    }
    alive = alive.concat(born)
  }
  return { alive: alive, dead: dead }
}

function drawFire(ctx, f) {
  var k = f.age / f.life
  // Catch, burn steadily, then collapse.
  var envelope = k < 0.14 ? k / 0.14 : (k > 0.7 ? (1 - k) / 0.3 : 1)
  var flick = 0.78 + 0.22 * Math.sin(f.phase + f.age * 17)
  var r = f.r * envelope * flick
  if (r < 1) return

  var body = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r)
  body.addColorStop(0, "rgba(255,242,175,0.95)")
  body.addColorStop(0.30, "rgba(255,178,40,0.85)")
  body.addColorStop(0.66, "rgba(238,88,14,0.52)")
  body.addColorStop(1, "rgba(150,25,0,0)")
  ctx.fillStyle = body
  ctx.beginPath(); ctx.arc(f.x, f.y, r, 0, 6.283); ctx.fill()

  // A tongue licking upward, leaning with the flicker.
  var h = r * (1.5 + 0.6 * flick)
  var lean = Math.sin(f.phase + f.age * 9) * r * 0.35
  // A flat fill rather than a second gradient: with a hundred flames on
  // screen, building two gradients each per frame is the whole frame budget.
  ctx.fillStyle = "rgba(255,150,40,0.34)"
  ctx.beginPath()
  ctx.moveTo(f.x - r * 0.52, f.y)
  ctx.quadraticCurveTo(f.x - r * 0.3 + lean, f.y - h * 0.6, f.x + lean, f.y - h)
  ctx.quadraticCurveTo(f.x + r * 0.3 + lean, f.y - h * 0.55, f.x + r * 0.52, f.y)
  ctx.closePath(); ctx.fill()

  ctx.fillStyle = "rgba(255,250,228,0.8)"
  ctx.beginPath(); ctx.arc(f.x, f.y, r * 0.22, 0, 6.283); ctx.fill()
}

// --- transient effects ------------------------------------------------------
// Sparks, flames, beams: things that live for a moment and leave nothing
// behind. Kept on their own canvas, cleared and redrawn every tick.

function makeFx(type, x, y, opts) {
  opts = opts || {}
  var f = { type: type, x: x, y: y, t: 0, life: 0.4, bits: [] }
  var i

  if (type === "boom") {
    f.life = 0.55
    f.r = opts.r || R(40, 70)
    for (i = 0; i < RI(10, 18); i++)
      f.bits.push({ a: R(0, 6.283), v: R(90, 320), g: R(300, 700), r: R(1.5, 4) })

  } else if (type === "spark") {
    f.life = 0.28
    for (i = 0; i < RI(5, 10); i++)
      f.bits.push({ a: R(0, 6.283), v: R(70, 260), g: R(200, 500), r: R(0.8, 2) })

  } else if (type === "flame") {
    f.life = 0.42
    f.ang = opts.ang || -1.57
    for (i = 0; i < RI(5, 9); i++)
      f.bits.push({ a: f.ang + R(-0.5, 0.5), v: R(90, 240), r: R(6, 16), h: R(0.02, 0.12) })

  } else if (type === "beam") {
    f.life = 0.3
    f.fromX = opts.fromX
    f.fromY = opts.fromY
    f.hue = opts.hue !== undefined ? opts.hue : 0.53

  } else if (type === "bubble") {
    f.life = 0.9
    for (i = 0; i < RI(4, 8); i++)
      f.bits.push({ dx: R(-22, 22), dy: R(-10, 10), r: R(3, 9), v: R(20, 70) })

  } else if (type === "splat") {
    f.life = 0.35
    f.color = opts.color
    for (i = 0; i < RI(4, 9); i++)
      f.bits.push({ a: R(0, 6.283), v: R(60, 200), g: R(150, 400), r: R(2, 5) })
  }
  return f
}

// Advances every effect; returns the survivors.
function stepFx(list, dt) {
  var out = []
  for (var i = 0; i < list.length; i++) {
    list[i].t += dt
    if (list[i].t < list[i].life) out.push(list[i])
  }
  return out
}

function drawFx(ctx, f) {
  var k = f.t / f.life          // 0 → 1 over the effect's life
  var fade = 1 - k
  var i, b, px, py

  ctx.save()

  if (f.type === "boom") {
    var g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r * (0.4 + k))
    g.addColorStop(0, Qt.rgba(1, 0.95, 0.7, 0.9 * fade))
    g.addColorStop(0.35, Qt.rgba(1, 0.55, 0.1, 0.7 * fade))
    g.addColorStop(0.75, Qt.rgba(0.7, 0.15, 0.02, 0.35 * fade))
    g.addColorStop(1, Qt.rgba(0.2, 0.05, 0, 0))
    ctx.fillStyle = g
    ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (0.4 + k), 0, 6.283); ctx.fill()
    ctx.fillStyle = Qt.rgba(1, 0.8, 0.4, fade)
    for (i = 0; i < f.bits.length; i++) {
      b = f.bits[i]
      px = f.x + Math.cos(b.a) * b.v * f.t
      py = f.y + Math.sin(b.a) * b.v * f.t + 0.5 * b.g * f.t * f.t
      ctx.beginPath(); ctx.arc(px, py, b.r * fade, 0, 6.283); ctx.fill()
    }

  } else if (f.type === "spark" || f.type === "splat") {
    ctx.fillStyle = f.type === "splat" ? f.color : Qt.rgba(1, 0.9, 0.55, fade)
    ctx.globalAlpha = f.type === "splat" ? fade : 1
    for (i = 0; i < f.bits.length; i++) {
      b = f.bits[i]
      px = f.x + Math.cos(b.a) * b.v * f.t
      py = f.y + Math.sin(b.a) * b.v * f.t + 0.5 * b.g * f.t * f.t
      ctx.beginPath(); ctx.arc(px, py, b.r * fade, 0, 6.283); ctx.fill()
    }

  } else if (f.type === "flame") {
    for (i = 0; i < f.bits.length; i++) {
      b = f.bits[i]
      px = f.x + Math.cos(b.a) * b.v * f.t
      py = f.y + Math.sin(b.a) * b.v * f.t
      var fg = ctx.createRadialGradient(px, py, 0, px, py, b.r * (1 + k))
      fg.addColorStop(0, Qt.hsla(0.14, 1, 0.85, 0.85 * fade))
      fg.addColorStop(0.5, Qt.hsla(b.h, 1, 0.55, 0.6 * fade))
      fg.addColorStop(1, Qt.hsla(0.02, 1, 0.4, 0))
      ctx.fillStyle = fg
      ctx.beginPath(); ctx.arc(px, py, b.r * (1 + k), 0, 6.283); ctx.fill()
    }

  } else if (f.type === "beam") {
    var lg = ctx.createLinearGradient(f.fromX, f.fromY, f.x, f.y)
    lg.addColorStop(0, Qt.hsla(f.hue, 1, 0.7, 0))
    lg.addColorStop(0.5, Qt.hsla(f.hue, 1, 0.8, 0.75 * fade))
    lg.addColorStop(1, Qt.hsla(f.hue, 1, 0.95, 0.95 * fade))
    ctx.strokeStyle = lg
    ctx.lineCap = "round"
    ctx.lineWidth = 16 * fade
    ctx.globalAlpha = 0.4
    ctx.beginPath(); ctx.moveTo(f.fromX, f.fromY); ctx.lineTo(f.x, f.y); ctx.stroke()
    ctx.globalAlpha = 1
    ctx.lineWidth = Math.max(1, 5 * fade)
    ctx.beginPath(); ctx.moveTo(f.fromX, f.fromY); ctx.lineTo(f.x, f.y); ctx.stroke()

  } else if (f.type === "bubble") {
    ctx.strokeStyle = Qt.rgba(1, 1, 1, 0.55 * fade)
    ctx.lineWidth = 1.2
    for (i = 0; i < f.bits.length; i++) {
      b = f.bits[i]
      px = f.x + b.dx
      py = f.y + b.dy - b.v * f.t
      ctx.beginPath(); ctx.arc(px, py, b.r, 0, 6.283); ctx.stroke()
      ctx.fillStyle = Qt.rgba(1, 1, 1, 0.10 * fade)
      ctx.fill()
    }
  }

  ctx.restore()
}
