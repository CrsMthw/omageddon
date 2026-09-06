// The nine tools, drawn rather than shipped. Everything lives in a normalized
// 0..1 box so the same code serves the menu tile and the mouse cursor at
// whatever size each wants. Each icon is composed in the tool's own upright
// frame and then tilted, which keeps the geometry readable.

var WOOD = "#b5763a", WOOD_D = "#8a5526", WOOD_L = "#d69a5c"
var STEEL = "#c3cad3", STEEL_D = "#79818c", STEEL_L = "#eef3f8"
var IRON = "#3b4048", IRON_L = "#5b626c"
var ORANGE = "#f08a1e", ORANGE_D = "#c96a08"
var RED = "#d8453c", RED_D = "#a32b24"
var BLUE = "#3f8fe0", BLUE_D = "#2a6bb0", BLUE_L = "#8fc4f5"
var CYAN = "#4fd6e0", CYAN_D = "#1f8f9c"
var BUG = "#8a6a3c", BUG_D = "#5d4526"

// Rounded rectangle path — QML's Context2D has roundedRect(), but building it
// by hand keeps this portable and lets radii clamp sanely at tiny sizes.
function rr(ctx, x, y, w, h, r) {
  r = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2)
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

function box(ctx, x, y, w, h, r, fill, stroke, lw) {
  rr(ctx, x, y, w, h, r === undefined ? 0 : r)
  if (fill) { ctx.fillStyle = fill; ctx.fill() }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 0.012; ctx.stroke() }
}

function dot(ctx, x, y, r, fill) {
  ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283)
  ctx.fillStyle = fill; ctx.fill()
}

// Entry point: draws `key` filling a size x size box at (x, y).
function drawIcon(ctx, key, x, y, size) {
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(size, size)
  ctx.lineJoin = "round"
  ctx.lineCap = "round"
  ctx.translate(0.5, 0.5)   // origin at the middle of the box

  if (key === "hammer") hammer(ctx)
  else if (key === "chainsaw") chainsaw(ctx)
  else if (key === "gun") gun(ctx)
  else if (key === "flame") flame(ctx)
  else if (key === "paint") paint(ctx)
  else if (key === "phaser") phaser(ctx)
  else if (key === "stamp") stamp(ctx)
  else if (key === "termites") termites(ctx)
  else if (key === "wash") wash(ctx)

  ctx.restore()
}

// --- 1: Hammer --------------------------------------------------------------

function hammer(ctx) {
  ctx.rotate(0.5)
  // Handle
  box(ctx, -0.045, -0.30, 0.09, 0.72, 0.03, WOOD)
  box(ctx, -0.045, -0.30, 0.032, 0.72, 0.02, WOOD_L)
  box(ctx, -0.05, 0.30, 0.10, 0.12, 0.04, WOOD_D)
  // Head: a flat face on the right, a claw on the left
  ctx.beginPath()
  ctx.moveTo(-0.05, -0.30)
  ctx.lineTo(-0.20, -0.34)
  ctx.quadraticCurveTo(-0.30, -0.40, -0.24, -0.47)
  ctx.quadraticCurveTo(-0.17, -0.42, -0.05, -0.42)
  ctx.closePath()
  ctx.fillStyle = STEEL_D; ctx.fill()
  box(ctx, -0.07, -0.47, 0.28, 0.19, 0.03, STEEL)
  box(ctx, 0.13, -0.48, 0.09, 0.21, 0.03, STEEL_L)
  box(ctx, -0.07, -0.47, 0.28, 0.055, 0.02, STEEL_L)
}

// --- 2: Chain-saw -----------------------------------------------------------

function chainsaw(ctx) {
  ctx.rotate(-0.30)
  // Guide bar with its chain of teeth
  box(ctx, 0.00, -0.055, 0.50, 0.11, 0.055, STEEL_D)
  box(ctx, 0.02, -0.032, 0.44, 0.064, 0.032, STEEL_L)
  ctx.fillStyle = IRON
  for (var i = 0; i < 9; i++) {
    var tx = 0.03 + i * 0.052
    ctx.beginPath()
    ctx.moveTo(tx, -0.055); ctx.lineTo(tx + 0.028, -0.055); ctx.lineTo(tx + 0.005, -0.10)
    ctx.closePath(); ctx.fill()
    ctx.beginPath()
    ctx.moveTo(tx, 0.055); ctx.lineTo(tx + 0.028, 0.055); ctx.lineTo(tx + 0.023, 0.10)
    ctx.closePath(); ctx.fill()
  }
  // Motor housing and the top grab handle
  box(ctx, -0.44, -0.17, 0.47, 0.34, 0.07, ORANGE)
  box(ctx, -0.40, -0.13, 0.20, 0.12, 0.04, ORANGE_D)
  box(ctx, -0.30, -0.30, 0.26, 0.07, 0.035, IRON)
  box(ctx, -0.31, -0.30, 0.07, 0.16, 0.035, IRON)
  dot(ctx, -0.14, 0.03, 0.055, IRON_L)
}

// --- 3: Machine gun ---------------------------------------------------------

function gun(ctx) {
  ctx.rotate(-0.22)
  box(ctx, 0.02, -0.035, 0.46, 0.07, 0.02, IRON_L)          // barrel
  box(ctx, 0.30, -0.055, 0.06, 0.11, 0.02, IRON)            // muzzle brake
  box(ctx, -0.34, -0.11, 0.40, 0.22, 0.04, IRON)            // receiver
  box(ctx, -0.30, -0.07, 0.30, 0.05, 0.02, IRON_L)
  box(ctx, -0.06, 0.09, 0.13, 0.30, 0.03, IRON_L)           // magazine
  box(ctx, -0.30, 0.09, 0.10, 0.20, 0.03, IRON)             // grip
  ctx.beginPath()                                            // stock
  ctx.moveTo(-0.34, -0.09); ctx.lineTo(-0.50, 0.02)
  ctx.lineTo(-0.50, 0.14); ctx.lineTo(-0.34, 0.09)
  ctx.closePath(); ctx.fillStyle = IRON_L; ctx.fill()
  box(ctx, 0.06, -0.14, 0.05, 0.05, 0.01, IRON)             // front sight
}

// --- 4: Flame-thrower -------------------------------------------------------

function flame(ctx) {
  ctx.rotate(-0.20)
  box(ctx, -0.46, -0.20, 0.24, 0.42, 0.10, RED_D)           // fuel tank
  box(ctx, -0.42, -0.16, 0.08, 0.34, 0.04, RED)
  box(ctx, -0.26, -0.05, 0.42, 0.10, 0.03, IRON)            // pipe
  box(ctx, -0.30, 0.02, 0.10, 0.22, 0.03, IRON_L)           // grip
  box(ctx, 0.10, -0.08, 0.10, 0.16, 0.03, IRON_L)           // nozzle
  // The business end
  var g = ctx.createRadialGradient(0.34, 0, 0, 0.34, 0, 0.22)
  g.addColorStop(0, "#fff2b0")
  g.addColorStop(0.35, "#ffb020")
  g.addColorStop(0.75, "#f2560e")
  g.addColorStop(1, "rgba(200,40,0,0)")
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.moveTo(0.20, -0.09)
  ctx.quadraticCurveTo(0.38, -0.20, 0.50, -0.02)
  ctx.quadraticCurveTo(0.40, 0.02, 0.48, 0.12)
  ctx.quadraticCurveTo(0.34, 0.20, 0.20, 0.09)
  ctx.closePath(); ctx.fill()
}

// --- 5: Color-thrower -------------------------------------------------------

function paint(ctx) {
  ctx.rotate(-0.18)
  box(ctx, -0.40, -0.24, 0.34, 0.48, 0.08, "#d9dde2")       // can
  box(ctx, -0.40, -0.14, 0.34, 0.10, 0, RED)                // colour bands
  box(ctx, -0.40, -0.02, 0.34, 0.10, 0, "#39b54a")
  box(ctx, -0.40, 0.10, 0.34, 0.10, 0, BLUE)
  box(ctx, -0.36, -0.24, 0.07, 0.48, 0.03, "#ffffff")
  box(ctx, -0.10, -0.09, 0.16, 0.18, 0.04, IRON)            // nozzle
  box(ctx, 0.04, -0.05, 0.07, 0.10, 0.02, IRON_L)
  // The spray: a fan of colourful droplets
  var cols = ["#e8453c", "#f2a03c", "#f5e04a", "#48c25a", "#3f8fe0", "#a45fd8"]
  var seedA = [-0.42, -0.28, -0.12, 0.02, 0.18, 0.34, -0.35, -0.05, 0.25]
  for (var i = 0; i < 9; i++) {
    var a = seedA[i] * 0.9
    var d = 0.16 + (i % 3) * 0.11 + 0.06
    dot(ctx, 0.12 + Math.cos(a) * d, Math.sin(a) * d,
        0.020 + (i % 3) * 0.012, cols[i % cols.length])
  }
}

// --- 6: Phaser --------------------------------------------------------------

function phaser(ctx) {
  ctx.rotate(-0.24)
  ctx.beginPath()                                            // swept body
  ctx.moveTo(-0.42, -0.02)
  ctx.quadraticCurveTo(-0.30, -0.17, 0.06, -0.15)
  ctx.lineTo(0.30, -0.09)
  ctx.quadraticCurveTo(0.38, 0, 0.30, 0.09)
  ctx.lineTo(0.02, 0.10)
  ctx.lineTo(-0.10, 0.30)
  ctx.lineTo(-0.28, 0.28)
  ctx.lineTo(-0.20, 0.06)
  ctx.quadraticCurveTo(-0.34, 0.06, -0.42, 0.10)
  ctx.closePath()
  ctx.fillStyle = "#4b5561"; ctx.fill()
  ctx.strokeStyle = "#2b323b"; ctx.lineWidth = 0.016; ctx.stroke()
  box(ctx, -0.24, -0.09, 0.34, 0.055, 0.025, CYAN)          // energy strip
  // Muzzle glow
  var g = ctx.createRadialGradient(0.34, 0, 0, 0.34, 0, 0.18)
  g.addColorStop(0, "#eaffff")
  g.addColorStop(0.4, CYAN)
  g.addColorStop(1, "rgba(79,214,224,0)")
  ctx.fillStyle = g
  ctx.beginPath(); ctx.arc(0.34, 0, 0.18, 0, 6.283); ctx.fill()
  dot(ctx, 0.34, 0, 0.05, "#ffffff")
}

// --- 7: Stamp ---------------------------------------------------------------

function stamp(ctx) {
  ctx.rotate(0.10)
  ctx.beginPath()                                            // knob
  ctx.arc(0, -0.30, 0.15, 0, 6.283)
  ctx.fillStyle = ORANGE; ctx.fill()
  dot(ctx, -0.05, -0.35, 0.05, "#ffc46b")
  box(ctx, -0.06, -0.20, 0.12, 0.22, 0.03, WOOD)            // shaft
  box(ctx, -0.24, 0.00, 0.48, 0.16, 0.04, WOOD_D)           // block
  box(ctx, -0.28, 0.15, 0.56, 0.14, 0.03, RED)              // inked face
  box(ctx, -0.24, 0.18, 0.48, 0.05, 0.02, RED_D)
}

// --- 8: Termites ------------------------------------------------------------

function termites(ctx) {
  var nest = [[-0.22, -0.14, 0.30], [0.14, 0.02, -0.45], [-0.08, 0.24, 0.15]]
  for (var i = 0; i < nest.length; i++) {
    ctx.save()
    ctx.translate(nest[i][0], nest[i][1])
    ctx.rotate(nest[i][2])
    ctx.scale(1.15, 1.15)
    bug(ctx)
    ctx.restore()
  }
}

// One termite, nose at +x, drawn in a unit frame centred on the thorax.
function bug(ctx) {
  ctx.strokeStyle = BUG_D
  ctx.lineWidth = 0.018
  for (var s = -1; s <= 1; s += 2) {
    for (var l = 0; l < 3; l++) {
      ctx.beginPath()
      ctx.moveTo(-0.02 + l * 0.06, 0)
      ctx.lineTo(-0.05 + l * 0.07, s * 0.10)
      ctx.stroke()
    }
  }
  dot(ctx, 0.11, 0, 0.055, BUG_D)                  // head
  dot(ctx, 0.02, 0, 0.062, BUG)                    // thorax
  dot(ctx, -0.09, 0, 0.075, BUG)                   // abdomen
  ctx.beginPath()                                  // antennae
  ctx.moveTo(0.14, -0.02); ctx.lineTo(0.22, -0.07)
  ctx.moveTo(0.14, 0.02); ctx.lineTo(0.22, 0.07)
  ctx.stroke()
}

// A live termite on the loose: world coordinates, its own heading.
function drawBug(ctx, x, y, size, angle) {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(angle || 0)
  ctx.scale(size, size)
  ctx.lineJoin = "round"
  ctx.lineCap = "round"
  bug(ctx)
  ctx.restore()
}

// --- 9: Washing -------------------------------------------------------------

function wash(ctx) {
  ctx.rotate(-0.12)
  box(ctx, -0.30, -0.06, 0.30, 0.44, 0.07, BLUE)            // bottle
  box(ctx, -0.26, -0.02, 0.09, 0.36, 0.04, BLUE_L)
  box(ctx, -0.24, 0.10, 0.18, 0.12, 0.02, "#ffffff")        // label
  box(ctx, -0.22, -0.16, 0.14, 0.12, 0.02, "#2a6bb0")       // neck
  box(ctx, -0.20, -0.28, 0.26, 0.13, 0.03, "#2a6bb0")       // head
  box(ctx, 0.04, -0.26, 0.14, 0.07, 0.02, "#2a6bb0")        // nozzle
  ctx.beginPath()                                            // trigger
  ctx.moveTo(-0.06, -0.15); ctx.lineTo(-0.02, -0.02); ctx.lineTo(-0.09, -0.03)
  ctx.closePath(); ctx.fillStyle = "#2a6bb0"; ctx.fill()
  // Spray
  var sp = [[0.24, -0.32, 0.05], [0.34, -0.20, 0.038], [0.22, -0.12, 0.03],
            [0.42, -0.32, 0.028], [0.33, -0.40, 0.033]]
  for (var i = 0; i < sp.length; i++) {
    ctx.beginPath(); ctx.arc(sp[i][0], sp[i][1], sp[i][2], 0, 6.283)
    ctx.fillStyle = "rgba(255,255,255,0.30)"; ctx.fill()
    ctx.strokeStyle = "rgba(255,255,255,0.85)"; ctx.lineWidth = 0.014; ctx.stroke()
  }
}
