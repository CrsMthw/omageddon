import QtQuick
import Quickshell
import Quickshell.Io
import QtMultimedia
import Quickshell.Wayland
import Quickshell.Hyprland
import qs.Commons
import "Weapons.js" as Weapons
import "Icons.js" as Icons

// Desktop Destroyer, the way it was in 2003: a full-screen layer that eats
// every click and lets you take a hammer to your own desktop.
//
// Three stacked surfaces do all the work:
//   damage   persistent decal canvas, painted incrementally, replayable
//   fx       transient sparks/flames/beams, cleared and redrawn each tick
//   cursor   the weapon itself, drawn where the pointer is
//
// Nothing here touches the real desktop — it is paint on glass, and `R`
// wipes it clean. The overlay claims one output; the others stay usable.
Item {
  id: root

  // Injected by the shell's panel loader.
  property string omarchyPath: Quickshell.env("OMARCHY_PATH")
  property var shell: null
  property var manifest: null

  readonly property string pluginId: manifest && manifest.id
    ? String(manifest.id) : "io.github.crsmthw.omageddon"

  property bool opened: false
  property bool menuOpen: true
  property int weaponIndex: 0
  readonly property var weapon: Weapons.weaponAt(weaponIndex)

  // Damage records in paint order. `paintedCount` is how many of them the
  // canvas already holds; anything beyond it is still owed a brush stroke.
  property var decals: []
  property int decalCount: 0
  property int paintedCount: 0
  property bool needsFullRepaint: false
  // Only a bound on the replay log's memory — see trimDecals().
  readonly property int maxDecals: 60000

  // --- lifecycle -------------------------------------------------------------

  function open(payloadJson) {
    root.resolveScreen()
    root.opened = true
    root.menuOpen = true
    Qt.callLater(function () { keys.forceActiveFocus() })
  }

  function close() {
    root.opened = false
    endFire()
    termiteTick.stop()
    fireTick.stop()
    fxLayer.effects = []
    termites = []
    fires = []
    gasTimer.stop()
    waterTimer.stop()
    stopAllLoops()
  }

  // The way out. `close()` alone would leave the shell believing the overlay
  // is still summoned, so a second hotkey press would appear to do nothing.
  function dismiss() {
    root.close()
    if (root.shell && typeof root.shell.hide === "function")
      root.shell.hide(root.pluginId)
  }

  function toggle() {
    if (root.opened) root.dismiss()
    else root.open("{}")
  }

  // --- which output ----------------------------------------------------------

  property string targetScreen: ""

  function resolveScreen() {
    var monitor = Hyprland.focusedMonitor
    root.targetScreen = monitor ? String(monitor.name || "") : ""
  }

  function screenObject() {
    var screens = Quickshell.screens
    var i
    if (root.targetScreen !== "") {
      for (i = 0; i < screens.length; i++)
        if (String(screens[i].name) === root.targetScreen) return screens[i]
    }
    var best = null
    for (i = 0; i < screens.length; i++)
      if (!best || screens[i].width * screens[i].height > best.width * best.height)
        best = screens[i]
    return best
  }

  // --- damage ----------------------------------------------------------------

  property var pendingRect: null

  function growDirty(x, y, r) {
    var box = { x1: x - r, y1: y - r, x2: x + r, y2: y + r }
    if (!pendingRect) { pendingRect = box; return }
    pendingRect.x1 = Math.min(pendingRect.x1, box.x1)
    pendingRect.y1 = Math.min(pendingRect.y1, box.y1)
    pendingRect.x2 = Math.max(pendingRect.x2, box.x2)
    pendingRect.y2 = Math.max(pendingRect.y2, box.y2)
  }

  // The canvas is the damage; `decals` is only the log used to repaint it if
  // the surface is ever lost. Forgetting the oldest entries bounds that log's
  // memory and deliberately does NOT repaint — the pixels stay exactly as
  // they are, so nothing you broke ever un-breaks itself. (The one cost is
  // that a full repaint, which in practice only happens on a resize, cannot
  // reconstruct damage older than the log.)
  function trimDecals() {
    if (decals.length <= maxDecals) return
    decals = decals.slice(Math.floor(maxDecals / 4))
    paintedCount = Math.max(0, paintedCount - Math.floor(maxDecals / 4))
  }

  function addDecal(decal) {
    decals.push(decal)
    trimDecals()
    decalCount = decals.length
    growDirty(decal.x, decal.y, decal.bb)
    flushDamage()
  }

  property bool flushPending: false

  function scheduleFlush() {
    if (needsFullRepaint) { flushDamage(); return }
    flushPending = true
    if (!flushTimer.running) flushTimer.start()
  }

  Timer {
    id: flushTimer
    // Fast enough that a termite tunnel still grows smoothly under the
    // insects, slow enough that the 30 fps fire tick does not drive a
    // full-screen repaint of the damage layer twice as often as it needs.
    interval: 60
    repeat: false
    onTriggered: {
      if (!root.flushPending) return
      root.flushPending = false
      root.flushDamage()
    }
  }

  function flushDamage() {
    if (needsFullRepaint || !pendingRect) {
      pendingRect = null
      damage.requestPaint()
      return
    }
    var box = pendingRect
    pendingRect = null
    damage.markDirty(Qt.rect(box.x1, box.y1, box.x2 - box.x1, box.y2 - box.y1))
  }

  function repairAll() {
    decals = []
    decalCount = 0
    needsFullRepaint = true
    termites = []
    termiteTick.stop()
    fires = []
    fireTick.stop()
    damage.requestPaint()
    hud.flash("Desktop repaired")
    playSound("wash")
  }

  // --- effects ---------------------------------------------------------------

  function addFx(type, x, y, opts) {
    var list = fxLayer.effects.slice()
    list.push(Weapons.makeFx(type, x, y, opts))
    fxLayer.effects = list
  }

  // --- fire ------------------------------------------------------------------
  // The flame-thrower starts fires rather than stamping burns. They keep
  // burning, spreading, and blackening the desktop after you let go.

  property var fires: []
  readonly property int maxFires: 80

  readonly property int flamesPerShot: 3

  function igniteAt(x, y) {
    var list = fires.slice()
    // At the cap, retire whatever is closest to burning out rather than
    // refusing to light — a flame-thrower that stops working once the screen
    // is busy is just broken. Retired flames leave their scorch as usual.
    var over = list.length + flamesPerShot - maxFires
    if (over > 0) {
      list.sort(function (a, b) { return (b.age / b.life) - (a.age / a.life) })
      var retired = list.splice(0, over)
      for (var r = 0; r < retired.length; r++) {
        var g = retired[r]
        decals.push(Weapons.makeDecal("flame", g.x, g.y, { scale: g.r / 22 }))
        growDirty(g.x, g.y, 90)
      }
      trimDecals()
      decalCount = decals.length
      scheduleFlush()
    }
    for (var i = 0; i < flamesPerShot; i++)
      list.push(Weapons.makeFire(x + (Math.random() - 0.5) * 26,
                                 y + (Math.random() - 0.5) * 26))
    fires = list
    fireTick.start()
  }

  Timer {
    id: fireTick
    interval: 33
    repeat: true
    running: false
    onTriggered: {
      if (!root.opened || root.fires.length === 0) { stop(); return }
      var out = Weapons.stepFires(root.fires, interval / 1000, root.maxFires)
      var i, f
      var scorched = 0
      // A flame chars the ground once it has been burning a moment, and again
      // where it finally goes out — so a spreading blaze leaves a trail.
      for (i = 0; i < out.alive.length; i++) {
        f = out.alive[i]
        if (f.charred || f.age < f.life * 0.45) continue
        f.charred = true
        root.decals.push(Weapons.makeDecal("flame", f.x, f.y, { scale: f.r / 30 }))
        root.growDirty(f.x, f.y, 70)
        scorched++
      }
      for (i = 0; i < out.dead.length; i++) {
        f = out.dead[i]
        root.decals.push(Weapons.makeDecal("flame", f.x, f.y, { scale: f.r / 22 }))
        root.growDirty(f.x, f.y, 90)
        scorched++
      }
      if (scorched > 0) {
        root.trimDecals()
        root.decalCount = root.decals.length
        root.scheduleFlush()
      }
      root.fires = out.alive
      fireLayer.requestPaint()
      if (out.alive.length === 0) stop()
    }
  }

  // --- termites --------------------------------------------------------------
  // A colony is a handful of agents that chew a wandering tunnel and starve
  // out. They are the one weapon that keeps working after you let go.

  property var termites: []
  readonly property int maxTermites: 60

  function spawnColony(x, y) {
    var list = termites.slice()
    var count = Math.min(8, maxTermites - list.length)
    for (var i = 0; i < count; i++)
      list.push({ x: x, y: y, a: Math.random() * 6.283,
                  life: 4 + Math.random() * 7, speed: 26 + Math.random() * 34 })
    termites = list
    termiteTick.start()
  }

  Timer {
    id: termiteTick
    interval: 60
    repeat: true
    running: false
    onTriggered: {
      if (!root.opened || root.termites.length === 0) { stop(); return }
      var dt = interval / 1000
      var alive = []
      for (var i = 0; i < root.termites.length; i++) {
        var t = root.termites[i]
        t.a += (Math.random() - 0.5) * 1.1
        t.x += Math.cos(t.a) * t.speed * dt
        t.y += Math.sin(t.a) * t.speed * dt
        // Bounce off the edges instead of wandering into the void.
        if (t.x < 4 || t.x > field.width - 4) { t.a = Math.PI - t.a; t.x = Math.max(4, Math.min(field.width - 4, t.x)) }
        if (t.y < 4 || t.y > field.height - 4) { t.a = -t.a; t.y = Math.max(4, Math.min(field.height - 4, t.y)) }
        t.life -= dt
        root.decals.push(Weapons.makeDecal("termites", t.x, t.y))
        root.growDirty(t.x, t.y, 8)
        // A well-fed colony occasionally splits.
        if (t.life > 1 && root.termites.length + alive.length < root.maxTermites
            && Math.random() < 0.004)
          alive.push({ x: t.x, y: t.y, a: Math.random() * 6.283,
                       life: t.life * 0.6, speed: t.speed })
        if (t.life > 0) alive.push(t)
      }
      root.termites = alive
      root.trimDecals()
      root.decalCount = root.decals.length
      root.scheduleFlush()
      bugs.requestPaint()
      if (alive.length === 0) stop()
    }
  }

  // --- firing ----------------------------------------------------------------

  property real lastX: 0
  property real lastY: 0
  // Rolled once per chain-saw stroke so the whole cut keeps one width.
  property real sawHalf: 3.4

  function fire(x, y) {
    var key = root.weapon.key
    if (key === "termites") {
      root.spawnColony(x, y)
      root.addFx("spark", x, y)
      root.playSound("termites")
      return
    }

    if (key === "wash") {
      root.addDecal(Weapons.makeDecal("wash", x, y))
      root.addFx("bubble", x, y)
      root.waterPulse()
      return
    }

    if (key === "chainsaw") {
      // A press on the spot still bites: a short nick at a random angle,
      // rather than a zero-length segment that would draw as a dot.
      var nick = Math.random() * 6.283
      root.sawHalf = 3.4 + Math.random() * 1.6
      root.addDecal(Weapons.makeDecal("chainsaw", x, y, {
        x2: x + Math.cos(nick) * 11, y2: y + Math.sin(nick) * 11,
        half: root.sawHalf }))
      root.addFx("spark", x, y)
      root.playSound("chainsaw")
      return
    }

    if (key === "flame") {
      root.igniteAt(x, y)
      root.addFx("flame", x, y, { ang: Math.random() * 6.283 })
      root.gasPulse()
      return
    }

    var decal = Weapons.makeDecal(key, x, y)
    root.addDecal(decal)

    if (key === "hammer") {
      root.addFx("boom", x, y, { r: 55 })
      root.addFx("spark", x, y)
    } else if (key === "gun") {
      root.addFx("spark", x, y)
    } else if (key === "paint") {
      root.addFx("splat", x, y, { color: decal.p.color })
    } else if (key === "phaser") {
      // The shot arrives from the muzzle of the gun you are holding, which
      // sits down and to the left of the pointer.
      root.addFx("beam", x, y, { fromX: x - 46, fromY: y + 24, hue: decal.p.hue })
      root.addFx("boom", x, y, { r: 40 })
    } else if (key === "stamp") {
      root.addFx("spark", x, y)
    }
    root.playSound(key)
  }

  // Drag weapons paint along the whole path, not just where the pointer
  // happened to land on a frame boundary.
  function dragTo(x, y) {
    var dx = x - lastX, dy = y - lastY
    var dist = Math.sqrt(dx * dx + dy * dy)
    if (dist < 3) return
    var stride = root.weapon.key === "chainsaw" ? 11 : 7
    var steps = Math.max(1, Math.min(48, Math.round(dist / stride)))
    var px = lastX, py = lastY
    for (var i = 1; i <= steps; i++) {
      var nx = lastX + dx * (i / steps)
      var ny = lastY + dy * (i / steps)
      if (root.weapon.key === "chainsaw")
        root.addDecal(Weapons.makeDecal("chainsaw", px, py,
                                        { x2: nx, y2: ny, half: root.sawHalf }))
      else
        root.addDecal(Weapons.makeDecal("wash", nx, ny))
      px = nx; py = ny
    }
    if (root.weapon.key === "chainsaw") {
      if (Math.random() < 0.4) root.addFx("spark", x, y)
      root.playSound("chainsaw")
    } else {
      if (Math.random() < 0.25) root.addFx("bubble", x, y)
      root.waterPulse()
    }
    lastX = x; lastY = y
  }

  function selectWeapon(index) {
    if (index < 0 || index >= 9) return
    root.weaponIndex = index
    root.menuOpen = false
    cursorLayer.requestPaint()
    hud.flash((index + 1) + ": " + Weapons.weaponAt(index).name)
    root.playSound("menu")
  }

  // Is the trigger currently down? Auto weapons repeat only while it is.
  property bool firing: false

  function beginFire(x, y) {
    root.lastX = x
    root.lastY = y
    root.firing = true
    root.kick()
    root.fire(x, y)
    // A click is one shot. Repeat fire only starts if the button is still
    // down after this delay — otherwise the 90 ms repeat rate turns every
    // click of the color-thrower into a three-round burst.
    if (root.weapon.mode === "auto") autoDelay.restart()
  }

  function endFire() {
    root.firing = false
    autoDelay.stop()
    autoFire.stop()
  }

  Timer {
    id: autoDelay
    interval: 200
    repeat: false
    onTriggered: if (root.firing) autoFire.start()
  }

  Timer {
    id: autoFire
    interval: Math.max(30, root.weapon.rate || 60)
    repeat: true
    running: false
    onTriggered: {
      if (!root.firing) { stop(); return }
      root.kick()
      root.fire(root.lastX + (Math.random() - 0.5) * 8,
                root.lastY + (Math.random() - 0.5) * 8)
    }
  }

  // --- sound -----------------------------------------------------------------
  // Every effect is synthesised rather than sampled — see tools/make-sounds.py,
  // which is also how you change them. Playback goes through QtMultimedia
  // instead of shelling out to a player: the machine gun fires fourteen times
  // a second, and that would be fourteen process spawns a second.

  property real soundVolume: 0.55
  property var soundPools: ({})
  property var soundClock: ({})

  // Voices per effect. Anything that retriggers while it is still ringing
  // needs more than one, or each shot cuts off the last instead of layering.
  readonly property var soundVoices: ({
    hammer: 3, gun: 4, chainsaw: 3, paint: 2,
    phaser: 2, stamp: 2, termites: 2, wash: 3, menu: 1
  })

  // Effects that come in interchangeable takes. Held fire picks one at
  // random each time, which is the difference between a weapon and a
  // metronome. Files are <name>.wav, <name>2.wav, <name>3.wav ...
  readonly property var soundVariants: ({ paint: 3, hammer: 3 })

  // Sounds that run for as long as a state lasts rather than firing once:
  // the gas jet while the trigger is down, embers while anything is alight,
  // crickets while a colony is loose. All three are seamless loops.
  readonly property var soundLoopNames: ["flame_loop", "ember_loop", "cricket_loop",
                                        "water_loop"]
  property var loopVoices: ({})

  // Minimum gap between retriggers, for the weapons driven by pointer motion
  // rather than by a timer: a fast drag emits far more events than ears want.
  readonly property var soundGap: ({ chainsaw: 85, termites: 260 })

  Component {
    id: soundVoice
    SoundEffect {}
  }

  function loadSounds() {
    var pools = ({})
    for (var name in soundVoices) {
      var takes = soundVariants[name] || 1
      var voices = []
      for (var take = 0; take < takes; take++) {
        var file = "sounds/" + name + (take === 0 ? "" : String(take + 1)) + ".wav"
        for (var i = 0; i < soundVoices[name]; i++) {
          var voice = soundVoice.createObject(root, {
            source: Qt.resolvedUrl(file),
            volume: root.soundVolume
          })
          if (voice) voices.push(voice)
        }
      }
      if (voices.length > 0)
        pools[name] = { voices: voices, next: 0, shuffle: takes > 1 }
    }
    soundPools = pools

    var loops = ({})
    for (var l = 0; l < soundLoopNames.length; l++) {
      var loopName = soundLoopNames[l]
      var held = soundVoice.createObject(root, {
        source: Qt.resolvedUrl("sounds/" + loopName + ".wav"),
        volume: root.soundVolume,
        loops: SoundEffect.Infinite
      })
      if (held) loops[loopName] = held
    }
    loopVoices = loops
  }

  // --- looping ambience ------------------------------------------------------

  property var loopLevels: ({})

  function startLoop(name, level) {
    var voice = loopVoices[name]
    if (!voice) return
    loopLevels[name] = level
    voice.volume = root.soundVolume * level
    if (!voice.playing) voice.play()
  }

  function stopLoop(name) {
    var voice = loopVoices[name]
    if (!voice) return
    loopLevels[name] = 0
    if (voice.playing) voice.stop()
  }

  function stopAllLoops() {
    for (var name in loopVoices) stopLoop(name)
  }

  // Ember and cricket beds follow what is actually on screen, and get louder
  // the more of it there is.
  function updateAmbience() {
    if (!opened) { stopAllLoops(); return }
    if (fires.length > 0) startLoop("ember_loop", Math.min(1, 0.3 + fires.length / 45))
    else stopLoop("ember_loop")
    if (termites.length > 0) startLoop("cricket_loop", Math.min(1, 0.35 + termites.length / 60))
    else stopLoop("cricket_loop")
  }

  onFiresChanged: updateAmbience()
  onTermitesChanged: updateAmbience()

  // The gas jet runs while the trigger is down. Each shot re-arms a short
  // timer, so holding gives one continuous whoosh and releasing trails off,
  // without the loop needing to know anything about the mouse.
  function gasPulse() {
    startLoop("flame_loop", 1.0)
    gasTimer.restart()
  }

  Timer {
    id: gasTimer
    interval: 190
    onTriggered: root.stopLoop("flame_loop")
  }

  function waterPulse() {
    startLoop("water_loop", 1.0)
    waterTimer.restart()
  }

  Timer {
    id: waterTimer
    interval: 240
    onTriggered: root.stopLoop("water_loop")
  }

  function playSound(event) {
    if (soundVolume <= 0) return
    var pool = soundPools[event]
    if (!pool) return
    var gap = soundGap[event]
    if (gap > 0) {
      var now = Date.now()
      if (now - (soundClock[event] || 0) < gap) return
      soundClock[event] = now
    }
    var index = pool.shuffle
      ? Math.floor(Math.random() * pool.voices.length)
      : pool.next
    pool.next = (pool.next + 1) % pool.voices.length
    pool.voices[index].play()
  }

  function setVolume(level) {
    root.soundVolume = Math.max(0, Math.min(1, level))
    for (var name in soundPools) {
      var voices = soundPools[name].voices
      for (var i = 0; i < voices.length; i++) voices[i].volume = root.soundVolume
    }
    for (var loopName in loopVoices)
      loopVoices[loopName].volume = root.soundVolume * (loopLevels[loopName] || 0)
  }

  property real unmutedVolume: 0.55

  function toggleMute() {
    if (soundVolume > 0) {
      root.unmutedVolume = soundVolume
      setVolume(0)
      hud.flash("Sound off")
    } else {
      setVolume(root.unmutedVolume > 0 ? root.unmutedVolume : 0.55)
      hud.flash("Sound on")
      playSound("menu")
    }
  }

  Component.onCompleted: loadSounds()

  // --- scripting -------------------------------------------------------------
  // Vandalism by remote control: `omarchy-shell omageddon hit 800 500`
  // lands a blow wherever you point it, which is also how the whole thing is
  // tested without a hand on the mouse.

  IpcHandler {
    target: "omageddon"

    function open(): void { root.open("{}") }
    function close(): void { root.dismiss() }
    function toggle(): void { root.toggle() }
    function repair(): void { root.repairAll() }
    function menu(): void { root.menuOpen = true }
    function mute(): void { root.toggleMute() }

    function volume(level: string): string {
      var value = Number(level)
      if (!(value >= 0 && value <= 1)) return "volume takes 0.0 - 1.0"
      root.setVolume(value)
      return String(root.soundVolume)
    }

    function weapon(name: string): string {
      for (var i = 0; i < 9; i++) {
        var spec = Weapons.weaponAt(i)
        if (spec.key === name || String(i + 1) === name) {
          root.selectWeapon(i)
          return spec.name
        }
      }
      return "unknown weapon: " + name
    }

    // press/release drive exactly what the mouse drives, so held fire and
    // click-vs-hold behaviour are testable without a hand on the button.
    function press(x: string, y: string): string {
      if (!root.opened) return "not running"
      root.menuOpen = false
      var px = Number(x), py = Number(y)
      if (!(px >= 0) || !(py >= 0)) return "bad coordinates"
      root.beginFire(px, py)
      return "firing"
    }

    function release(): void { root.endFire() }

    function state(): string {
      return JSON.stringify({
        opened: root.opened,
        weapon: root.weapon.key,
        decals: root.decalCount,
        fires: root.fires.length,
        termites: root.termites.length,
        firing: root.firing
      })
    }

    function hit(x: string, y: string): string {
      if (!root.opened) return "not running"
      root.menuOpen = false
      var px = Number(x), py = Number(y)
      if (!(px >= 0) || !(py >= 0)) return "bad coordinates"
      root.kick()
      root.fire(px, py)
      return "hit"
    }

    // A drag of the current weapon, for the chain-saw and the sponge.
    function slash(x1: string, y1: string, x2: string, y2: string): string {
      if (!root.opened) return "not running"
      root.menuOpen = false
      root.lastX = Number(x1)
      root.lastY = Number(y1)
      root.fire(root.lastX, root.lastY)
      root.dragTo(Number(x2), Number(y2))
      return "slash"
    }
  }

  // --- the surface -----------------------------------------------------------

  PanelWindow {
    id: win
    visible: root.opened
    screen: root.screenObject()
    anchors { top: true; bottom: true; left: true; right: true }
    color: "transparent"
    WlrLayershell.namespace: "omageddon"
    WlrLayershell.layer: WlrLayer.Overlay
    WlrLayershell.keyboardFocus: WlrKeyboardFocus.Exclusive
    exclusionMode: ExclusionMode.Ignore

    // Everything painted so far.
    Canvas {
      id: damage
      anchors.fill: parent
      onPaint: {
        var ctx = getContext("2d")
        if (root.needsFullRepaint) {
          ctx.reset()
          ctx.clearRect(0, 0, width, height)
          root.paintedCount = 0
          root.needsFullRepaint = false
        }
        while (root.paintedCount < root.decals.length) {
          Weapons.drawDecal(ctx, root.decals[root.paintedCount])
          root.paintedCount++
        }
      }
      // A resize (or a move to another output) throws the backing store away.
      function surfaceLost() {
        root.needsFullRepaint = true
        Qt.callLater(requestPaint)
      }
      onWidthChanged: surfaceLost()
      onHeightChanged: surfaceLost()
      onAvailableChanged: if (available) surfaceLost()
    }

    // Everything currently alight. Like the effects layer, this clears only
    // the ground the fire actually covers — wiping the whole surface every
    // tick meant re-uploading a full-screen texture 16 times a second.
    Canvas {
      id: fireLayer
      anchors.fill: parent
      visible: root.fires.length > 0
      property var lastBox: null

      function unionBox() {
        var out = null
        for (var i = 0; i < root.fires.length; i++) {
          var f = root.fires[i]
          var pad = f.r * 2.6 + 30
          var b = { x1: f.x - pad, y1: f.y - pad * 1.6, x2: f.x + pad, y2: f.y + pad }
          if (!out) { out = b; continue }
          out.x1 = Math.min(out.x1, b.x1); out.y1 = Math.min(out.y1, b.y1)
          out.x2 = Math.max(out.x2, b.x2); out.y2 = Math.max(out.y2, b.y2)
        }
        return out
      }

      onPaint: {
        var ctx = getContext("2d")
        var now = unionBox()
        var wipe = now
        if (lastBox) {
          wipe = now ? {
            x1: Math.min(now.x1, lastBox.x1), y1: Math.min(now.y1, lastBox.y1),
            x2: Math.max(now.x2, lastBox.x2), y2: Math.max(now.y2, lastBox.y2)
          } : lastBox
        }
        if (wipe) ctx.clearRect(wipe.x1, wipe.y1, wipe.x2 - wipe.x1, wipe.y2 - wipe.y1)
        else ctx.clearRect(0, 0, width, height)
        for (var i = 0; i < root.fires.length; i++)
          Weapons.drawFire(ctx, root.fires[i])
        lastBox = now
      }
    }

    // Sparks, flames, beams — anything that lives for a fraction of a second.
    Canvas {
      id: fxLayer
      anchors.fill: parent
      property var effects: []
      property var lastBox: null

      function boxOf(f) {
        var pad = f.type === "boom" ? 240 : (f.type === "flame" ? 180
          : (f.type === "beam" ? 40 : 150))
        var x1 = f.x - pad, y1 = f.y - pad, x2 = f.x + pad, y2 = f.y + pad
        if (f.type === "beam") {
          x1 = Math.min(x1, f.fromX - pad); y1 = Math.min(y1, f.fromY - pad)
          x2 = Math.max(x2, f.fromX + pad); y2 = Math.max(y2, f.fromY + pad)
        }
        return { x1: x1, y1: y1, x2: x2, y2: y2 }
      }

      function unionBox() {
        var out = null
        for (var i = 0; i < effects.length; i++) {
          var b = boxOf(effects[i])
          if (!out) { out = b; continue }
          out.x1 = Math.min(out.x1, b.x1); out.y1 = Math.min(out.y1, b.y1)
          out.x2 = Math.max(out.x2, b.x2); out.y2 = Math.max(out.y2, b.y2)
        }
        return out
      }

      onPaint: {
        var ctx = getContext("2d")
        // Clear last frame's footprint as well as this one's, so nothing
        // smears when an effect shrinks or dies.
        var now = unionBox()
        var wipe = now
        if (lastBox) {
          wipe = now ? {
            x1: Math.min(now.x1, lastBox.x1), y1: Math.min(now.y1, lastBox.y1),
            x2: Math.max(now.x2, lastBox.x2), y2: Math.max(now.y2, lastBox.y2)
          } : lastBox
        }
        if (wipe) ctx.clearRect(wipe.x1, wipe.y1, wipe.x2 - wipe.x1, wipe.y2 - wipe.y1)
        else ctx.clearRect(0, 0, width, height)
        for (var i = 0; i < effects.length; i++) Weapons.drawFx(ctx, effects[i])
        lastBox = now
      }
    }

    Timer {
      id: fxTick
      interval: 16
      repeat: true
      running: root.opened && fxLayer.effects.length > 0
      onTriggered: {
        fxLayer.effects = Weapons.stepFx(fxLayer.effects, interval / 1000)
        fxLayer.requestPaint()
      }
    }

    // The live colony, drawn on top of the tunnels it has chewed.
    Canvas {
      id: bugs
      anchors.fill: parent
      visible: root.termites.length > 0
      property var lastBox: null

      function unionBox() {
        var out = null
        for (var i = 0; i < root.termites.length; i++) {
          var t = root.termites[i]
          var b = { x1: t.x - 16, y1: t.y - 16, x2: t.x + 16, y2: t.y + 16 }
          if (!out) { out = b; continue }
          out.x1 = Math.min(out.x1, b.x1); out.y1 = Math.min(out.y1, b.y1)
          out.x2 = Math.max(out.x2, b.x2); out.y2 = Math.max(out.y2, b.y2)
        }
        return out
      }

      onPaint: {
        var ctx = getContext("2d")
        var now = unionBox()
        var wipe = now
        if (lastBox) {
          wipe = now ? {
            x1: Math.min(now.x1, lastBox.x1), y1: Math.min(now.y1, lastBox.y1),
            x2: Math.max(now.x2, lastBox.x2), y2: Math.max(now.y2, lastBox.y2)
          } : lastBox
        }
        if (wipe) ctx.clearRect(wipe.x1, wipe.y1, wipe.x2 - wipe.x1, wipe.y2 - wipe.y1)
        else ctx.clearRect(0, 0, width, height)
        for (var i = 0; i < root.termites.length; i++) {
          var t = root.termites[i]
          Icons.drawBug(ctx, t.x, t.y, 15, t.a)
        }
        lastBox = now
      }
    }

    // Everything that is not the menu is a swing of whatever you're holding.
    MouseArea {
      id: field
      anchors.fill: parent
      hoverEnabled: true
      acceptedButtons: Qt.LeftButton | Qt.RightButton | Qt.MiddleButton
      cursorShape: root.menuOpen ? Qt.ArrowCursor : Qt.BlankCursor

      onPressed: function (mouse) {
        keys.forceActiveFocus()
        if (mouse.button === Qt.RightButton) {
          root.menuOpen = !root.menuOpen
          root.playSound("menu")
          return
        }
        if (root.menuOpen) { root.menuOpen = false; return }
        root.beginFire(mouse.x, mouse.y)
      }

      onPositionChanged: function (mouse) {
        if (root.menuOpen) return
        if (pressed && root.weapon.mode === "drag") root.dragTo(mouse.x, mouse.y)
        else { root.lastX = mouse.x; root.lastY = mouse.y }
      }

      onReleased: root.endFire()
      onCanceled: root.endFire()
    }

    // --- the weapon in your hand ---------------------------------------------

    property real recoil: 0

    Canvas {
      id: cursorLayer
      readonly property int iconSize: 54
      // Where in the icon's box the pointer actually is — the head of the
      // hammer, the muzzle of the gun — so the hit lands where you aim.
      readonly property var hotspots: ({
        hammer: [0.74, 0.20], chainsaw: [0.95, 0.35], gun: [0.85, 0.42],
        flame: [0.95, 0.38], paint: [0.80, 0.45], phaser: [0.83, 0.42],
        stamp: [0.48, 0.72], termites: [0.50, 0.50], wash: [0.78, 0.18]
      })
      readonly property var hotspot: hotspots[root.weapon.key] || [0.5, 0.5]

      width: iconSize
      height: iconSize
      visible: root.opened && !root.menuOpen && field.containsMouse
      x: field.mouseX - hotspot[0] * iconSize
      y: field.mouseY - hotspot[1] * iconSize

      transform: Rotation {
        origin.x: cursorLayer.hotspot[0] * cursorLayer.iconSize
        origin.y: cursorLayer.hotspot[1] * cursorLayer.iconSize
        angle: -22 * win.recoil
      }

      onPaint: {
        var ctx = getContext("2d")
        ctx.clearRect(0, 0, width, height)
        Icons.drawIcon(ctx, root.weapon.key, 0, 0, iconSize)
      }
      Component.onCompleted: requestPaint()
    }

    NumberAnimation {
      id: recoilAnim
      target: win
      property: "recoil"
      from: 1
      to: 0
      duration: 190
      easing.type: Easing.OutQuad
    }

    // --- the menu ------------------------------------------------------------

    Rectangle {
      id: card
      visible: root.menuOpen
      anchors.centerIn: parent
      width: grid.width + Style.spacing.panelPadding * 2
      height: header.height + grid.height + footer.height
        + Style.spacing.panelPadding * 2 + Style.spacing.panelGap * 2
      radius: Style.cornerRadius
      color: Color.menu.background
      border.width: Math.max(1, Style.space(2))
      border.color: Color.menu.border

      // Clicks on the card must not fall through to the destruction field —
      // but the right button still means "back", as the footer promises.
      MouseArea {
        anchors.fill: parent
        acceptedButtons: Qt.AllButtons
        onPressed: function (mouse) {
          if (mouse.button === Qt.RightButton) {
            root.menuOpen = false
            root.playSound("menu")
          }
        }
      }

      Text {
        id: header
        anchors { top: parent.top; left: parent.left; right: parent.right
                  topMargin: Style.spacing.panelPadding }
        horizontalAlignment: Text.AlignHCenter
        text: "OMAGEDDON"
        color: Color.menu.text
        font.family: "monospace"
        font.bold: true
        font.letterSpacing: 2
        font.pixelSize: Style.font.title
      }

      Grid {
        id: grid
        anchors { top: header.bottom; topMargin: Style.spacing.panelGap
                  horizontalCenter: parent.horizontalCenter }
        columns: 3
        spacing: Style.space(6)

        Repeater {
          model: 9

          Rectangle {
            id: tile
            required property int index
            readonly property var spec: Weapons.weaponAt(index)
            readonly property bool active: root.weaponIndex === index

            width: Style.space(148)
            height: Style.space(112)
            radius: Style.cornerRadius
            color: tileMouse.containsMouse || active
              ? Color.menu.selectedBackground : "transparent"
            border.width: active ? Math.max(1, Style.space(1)) : 0
            border.color: Color.menu.selectedBorder.a > 0
              ? Color.menu.selectedBorder : Color.menu.text

            Canvas {
              id: art
              width: Style.space(58)
              height: width
              anchors { horizontalCenter: parent.horizontalCenter
                        top: parent.top; topMargin: Style.space(12) }
              onPaint: {
                var ctx = getContext("2d")
                ctx.clearRect(0, 0, width, height)
                Icons.drawIcon(ctx, tile.spec.key, 0, 0, width)
              }
              Component.onCompleted: requestPaint()
            }

            Text {
              anchors { horizontalCenter: parent.horizontalCenter
                        bottom: parent.bottom; bottomMargin: Style.space(12) }
              text: (tile.index + 1) + ": " + tile.spec.name
              color: tileMouse.containsMouse || tile.active
                ? Color.menu.selectedText : Color.menu.text
              font.family: "monospace"
              font.bold: true
              font.pixelSize: Style.font.body
            }

            MouseArea {
              id: tileMouse
              anchors.fill: parent
              hoverEnabled: true
              acceptedButtons: Qt.LeftButton
              cursorShape: Qt.PointingHandCursor
              onClicked: root.selectWeapon(tile.index)
            }
          }
        }
      }

      Column {
        id: footer
        anchors { top: grid.bottom; topMargin: Style.spacing.panelGap
                  left: parent.left; right: parent.right }
        spacing: Style.space(4)

        Rectangle {
          width: parent.width - Style.spacing.panelPadding * 2
          x: Style.spacing.panelPadding
          height: Math.max(1, Style.space(1))
          color: Color.menu.border
          opacity: 0.5
        }

        Text {
          width: parent.width
          horizontalAlignment: Text.AlignHCenter
          text: "right button = back        Esc = quit"
          color: Color.menu.selectedText
          font.family: "monospace"
          font.bold: true
          font.pixelSize: Style.font.body
        }

        Text {
          width: parent.width
          horizontalAlignment: Text.AlignHCenter
          text: "1-9 switch weapon    R = repair everything    M = mute"
          color: Color.menu.text
          opacity: 0.65
          font.family: "monospace"
          font.pixelSize: Style.font.caption
        }
      }
    }

    // --- heads-up ------------------------------------------------------------

    Rectangle {
      id: hud
      function flash(message) {
        hudText.text = message
        hud.opacity = 1
        hudTimer.restart()
      }

      anchors { horizontalCenter: parent.horizontalCenter
                bottom: parent.bottom; bottomMargin: Style.space(48) }
      width: hudText.width + Style.spacing.rowPaddingX * 2
      height: hudText.height + Style.spacing.controlPaddingY * 2
      radius: height / 2
      color: Color.menu.background
      border.width: 1
      border.color: Color.menu.border
      opacity: 0
      visible: opacity > 0.01 && !root.menuOpen
      Behavior on opacity { NumberAnimation { duration: 350 } }

      Text {
        id: hudText
        anchors.centerIn: parent
        color: Color.menu.text
        font.family: "monospace"
        font.pixelSize: Style.font.body
      }

      Timer {
        id: hudTimer
        interval: 1600
        onTriggered: hud.opacity = 0
      }
    }

    // --- keys ----------------------------------------------------------------

    Item {
      id: keys
      anchors.fill: parent
      focus: true
      Keys.priority: Keys.BeforeItem
      Keys.onPressed: function (event) {
        if (event.key === Qt.Key_Escape) {
          root.dismiss()
          event.accepted = true
          return
        }
        if (event.text >= "1" && event.text <= "9") {
          root.selectWeapon(parseInt(event.text) - 1)
          event.accepted = true
          return
        }
        if (event.key === Qt.Key_R) {
          root.repairAll()
          event.accepted = true
          return
        }
        if (event.key === Qt.Key_M) {
          root.toggleMute()
          event.accepted = true
          return
        }
        if (event.key === Qt.Key_Space || event.key === Qt.Key_Tab
            || event.key === Qt.Key_Menu) {
          root.menuOpen = !root.menuOpen
          event.accepted = true
          return
        }
        if (event.key === Qt.Key_Left || event.key === Qt.Key_Right) {
          var step = event.key === Qt.Key_Right ? 1 : -1
          root.selectWeapon((root.weaponIndex + step + 9) % 9)
          event.accepted = true
        }
      }
    }
  }

  function kick() {
    recoilAnim.restart()
  }

  onOpenedChanged: {
    if (opened) Qt.callLater(function () { keys.forceActiveFocus() })
    updateAmbience()
  }
  onWeaponIndexChanged: cursorLayer.requestPaint()
}
