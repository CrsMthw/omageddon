#!/usr/bin/env python3
"""Synthesises the plugin's sound effects into ../sounds/.

Nothing is sampled, so there is nothing to license and nothing to attribute —
the same reason the weapons and their damage are drawn in code rather than
shipped as images. Re-run it after editing to regenerate the set:

    python3 tools/make-sounds.py

Everything is mono 22.05 kHz 16-bit, which is plenty for short retro effects
and keeps the whole set well under a megabyte.
"""

import math
import os
import random
import struct
import wave

SR = 22050
random.seed(7)          # reproducible builds; the noise is always the same noise

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "sounds")


# --- building blocks --------------------------------------------------------

def noise(n):
    return [random.uniform(-1.0, 1.0) for _ in range(n)]


def sweep(n, f0, f1, kind="sine"):
    """A frequency glide. Phase is integrated, so there are no clicks."""
    out, phase = [], 0.0
    for i in range(n):
        t = i / (n - 1) if n > 1 else 0.0
        f = f0 * (f1 / f0) ** t
        phase += f / SR
        phase %= 1.0
        if kind == "saw":
            out.append(2.0 * phase - 1.0)
        elif kind == "square":
            out.append(1.0 if phase < 0.5 else -1.0)
        else:
            out.append(math.sin(2.0 * math.pi * phase))
    return out


def osc(n, f, kind="sine"):
    return sweep(n, f, f, kind)


def lowpass(x, cutoff):
    dt = 1.0 / SR
    rc = 1.0 / (2.0 * math.pi * cutoff)
    a = dt / (rc + dt)
    out, prev = [0.0] * len(x), 0.0
    for i, v in enumerate(x):
        prev += a * (v - prev)
        out[i] = prev
    return out


def highpass(x, cutoff):
    dt = 1.0 / SR
    rc = 1.0 / (2.0 * math.pi * cutoff)
    a = rc / (rc + dt)
    out, px, py = [0.0] * len(x), 0.0, 0.0
    for i, v in enumerate(x):
        py = a * (py + v - px)
        px = v
        out[i] = py
    return out


def svf(x, freq, q=3.0, mode="bp"):
    """State-variable filter. `freq` may be a per-sample list, which is what
    gives the phaser and the spray their moving-resonance character."""
    low = band = 0.0
    out = [0.0] * len(x)
    for i, v in enumerate(x):
        f = freq[i] if isinstance(freq, list) else freq
        f = 2.0 * math.sin(math.pi * min(f, SR * 0.45) / SR)
        high = v - low - (1.0 / q) * band
        band += f * high
        low += f * band
        out[i] = {"lp": low, "bp": band, "hp": high}[mode]
    return out


def decay(n, tau):
    return [math.exp(-i / (tau * SR)) for i in range(n)]


def ar(n, attack, release):
    a = max(1, int(attack * SR))
    return [(i / a if i < a else math.exp(-(i - a) / (release * SR)))
            for i in range(n)]


def apply(sig, env):
    return [s * e for s, e in zip(sig, env)]


def mix(*parts):
    n = max(len(p) for p in parts)
    out = [0.0] * n
    for p in parts:
        for i, v in enumerate(p):
            out[i] += v
    return out


def edges(sig, ms=3.0):
    """Fade the very start and end so overlapping one-shots never click."""
    k = max(1, int(ms * SR / 1000.0))
    out = list(sig)
    for i in range(min(k, len(out))):
        out[i] *= i / k
        out[-1 - i] *= i / k
    return out


def seamless(sig, xf_ms=110):
    """Turn a signal of length n + crossfade into a loop of length n.

    The tail is what naturally follows the last sample, so fading it back over
    the head makes the wrap-around continuous — no tick every time the loop
    repeats, which is the whole difficulty with a looping noise bed."""
    xf = max(1, int(xf_ms * SR / 1000.0))
    n = len(sig) - xf
    out = sig[:n]
    for i in range(xf):
        w = i / xf
        out[i] = out[i] * w + sig[n + i] * (1.0 - w)
    return out


def write(name, sig, peak=0.8):
    m = max(1e-9, max(abs(v) for v in sig))
    scale = peak / m
    frames = bytearray()
    for v in sig:
        s = math.tanh(v * scale * 1.3) / math.tanh(1.3)
        frames += struct.pack("<h", int(max(-1.0, min(1.0, s)) * 32767))
    path = os.path.join(OUT, name + ".wav")
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(bytes(frames))
    print("%-14s %5.2f s  %6d bytes" % (name, len(sig) / SR, os.path.getsize(path)))


# --- the effects ------------------------------------------------------------

def hammer():
    n = int(0.30 * SR)
    nz = noise(n)
    thump = apply(sweep(n, 150, 42), decay(n, 0.055))
    crack = apply(svf(nz, 2100, 2.2, "bp"), decay(n, 0.011))
    body = apply(lowpass(nz, 700), decay(n, 0.085))
    return mix([v * 1.0 for v in thump], [v * 0.6 for v in crack],
               [v * 0.45 for v in body])


def gun():
    n = int(0.16 * SR)
    nz = noise(n)
    click = apply(highpass(nz, 3000), decay(n, 0.006))
    body = apply(lowpass(nz, 1400), decay(n, 0.030))
    thump = apply(sweep(n, 190, 60), decay(n, 0.035))
    return mix([v * 0.7 for v in click], [v * 0.85 for v in body],
               [v * 0.6 for v in thump])


def chainsaw():
    # Short and even, because it is retriggered continuously while cutting:
    # a hard attack would turn a drag into a machine gun.
    n = int(0.16 * SR)
    engine = mix([v * 0.6 for v in osc(n, 96, "saw")],
                 [v * 0.4 for v in osc(n, 48, "saw")],
                 [v * 0.2 for v in osc(n, 143, "saw")])
    teeth = [0.55 + 0.45 * (1.0 if math.sin(2 * math.pi * 27 * i / SR) > -0.2 else 0.35)
             for i in range(n)]
    bite = apply(svf(noise(n), 1700, 1.6, "bp"), teeth)
    return edges(mix(apply(lowpass(engine, 2600), teeth), [v * 0.35 for v in bite]), 4.0)


def flame_loop():
    """The gas jet: a continuous whoosh that runs for as long as the trigger
    is held. Pressure wobbles a little so it breathes instead of hissing flat."""
    total = int(1.30 * SR)
    nz = noise(total)
    track = [640 + 260 * math.sin(2 * math.pi * 3.1 * i / SR)
             + 120 * math.sin(2 * math.pi * 7.7 * i / SR)
             + 70 * math.sin(2 * math.pi * 19.0 * i / SR) for i in range(total)]
    jet = svf(nz, track, 1.05, "bp")
    hiss = highpass(nz, 3000)
    breathe = [0.82 + 0.18 * math.sin(2 * math.pi * 2.3 * i / SR) for i in range(total)]
    body = mix(apply(jet, breathe), [v * 0.34 for v in hiss])
    return seamless(body)


def ember_loop():
    """What a burning patch sounds like once the gas is off: a low roar with
    sparse crackle over it. Volume follows how much is actually alight."""
    total = int(2.60 * SR)
    nz = noise(total)
    bed = apply(lowpass(nz, 260),
                [0.7 + 0.3 * math.sin(2 * math.pi * 1.7 * i / SR) for i in range(total)])
    crackle = [0.0] * total
    i = int(0.02 * SR)
    while i < total:
        length = int(random.uniform(0.004, 0.012) * SR)
        pop = apply(svf(noise(length), random.uniform(900, 2400), 3.0, "bp"),
                    decay(length, 0.004))
        gain = random.uniform(0.3, 1.0)
        for j, v in enumerate(pop):
            if i + j < total:
                crackle[i + j] += v * gain
        i += int(random.uniform(0.03, 0.16) * SR)
    return seamless(mix([v * 0.75 for v in bed], [v * 0.9 for v in crackle]))


def water_loop():
    """The sponge: running water with bubbles in it, for as long as you scrub.

    A bubble is a short tone that rises in pitch — the resonance climbs as the
    bubble shrinks — so the bubbly part is built from little upward chirps
    rather than from noise, which only ever gives you hiss."""
    total = int(2.60 * SR)
    nz = noise(total)

    # The flow: broad, wet, gently varying.
    track = [1500 + 550 * math.sin(2 * math.pi * 2.3 * i / SR)
             + 260 * math.sin(2 * math.pi * 5.9 * i / SR) for i in range(total)]
    flow = svf(nz, track, 0.85, "bp")
    body = apply(lowpass(nz, 700),
                 [0.75 + 0.25 * math.sin(2 * math.pi * 1.3 * i / SR) for i in range(total)])
    fizz = highpass(nz, 5200)

    bubbles = [0.0] * total
    i = 0
    while i < total:
        dur = random.uniform(0.012, 0.038)
        bn = int(dur * SR)
        f0 = random.uniform(340, 1500)
        pop = apply(sweep(bn, f0, f0 * random.uniform(1.4, 2.1)),
                    [math.sin(math.pi * (j / bn)) ** 0.8 * math.exp(-j / (dur * 0.45 * SR))
                     for j in range(bn)])
        gain = random.uniform(0.25, 0.85)
        for j, v in enumerate(pop):
            if i + j < total:
                bubbles[i + j] += v * gain
        i += int(random.uniform(0.020, 0.075) * SR)

    return seamless(mix([v * 0.85 for v in flow], [v * 0.45 for v in body],
                        [v * 0.30 for v in fizz], [v * 0.7 for v in bubbles]))


def cricket_loop():
    """Chirps for as long as a colony is on screen. Two crickets, offset and
    slightly apart in pitch, so it reads as an infestation rather than a beep.

    The chirps are placed on an exact grid inside the loop with silence at both
    ends, so the wrap needs no crossfade at all."""
    total = int(3.0 * SR)
    out = [0.0] * total

    def chirp(freq, pulses=4):
        buf = []
        for _ in range(pulses):
            n = int(0.017 * SR)
            tone = osc(n, freq)
            env = [math.sin(math.pi * (i / n)) ** 1.4 for i in range(n)]
            buzz = [0.62 + 0.38 * math.sin(2 * math.pi * 235 * i / SR) for i in range(n)]
            buf += [t * e * b for t, e, b in zip(tone, env, buzz)]
            buf += [0.0] * int(0.013 * SR)
        return buf

    def lay(buf, at, gain):
        start = int(at * SR)
        for j, v in enumerate(buf):
            if start + j < total:
                out[start + j] += v * gain

    for k in range(6):                       # one chirp every half second
        lay(chirp(4600), 0.5 * k + 0.04, 0.9)
    for k in range(5):                       # the second cricket, answering
        lay(chirp(5250, 3), 0.5 * k + 0.29, 0.45)
    return out


def squirt(seed):
    """Color-thrower: a pressurised squirt, then the wet splat where it lands.

    The trap here is the splat. A sine sweeping downward in pitch is exactly
    how you build a tom drum, so any tonal low sweep turns this into a drum
    hit. Everything below is noise driven through resonant filters instead —
    the "gloop" is a resonance moving down, not a pitch moving down — and the
    whole thing is high-passed so there is no drum body left to hear."""
    random.seed(seed)
    n = int(0.40 * SR)
    out = [0.0] * n

    def lay(buf, at, gain):
        start = int(at * SR)
        for j, v in enumerate(buf):
            if start + j < n:
                out[start + j] += v * gain

    # The squirt, built the way the glass shatter is: as a scatter of many
    # tiny events rather than as filtered noise. A stream leaving a nozzle
    # breaks into droplets, and that is what you actually hear — a few dozen
    # overlapping little impacts. Filtered noise can be shaped to *sweep* like
    # a squirt but never to be grainy like one, which is why every smooth
    # version of this sounded like a zip.
    jet_dur = 0.135
    jn = int(jet_dur * SR)

    def droplet(freq, dur, rise):
        dn = max(2, int(dur * SR))
        return [v * math.exp(-j / (dur * 0.30 * SR))
                for j, v in enumerate(sweep(dn, freq, freq * rise))]

    # Density is the whole trick, and it is easy to get wrong in the obvious
    # direction: at ~700 droplets a second they overlap three deep and average
    # straight back into smooth noise. Sparse enough to hear individual spits
    # is what makes it read as liquid.
    density = random.uniform(95, 150)       # droplets per second at full pressure
    spread = random.uniform(0.9, 1.15)
    t = 0.0
    while t < jet_dur:
        fall = t / jet_dur
        # Pressure drops: the stream thins out and the droplets get bigger
        # and lower as it goes.
        freq = random.uniform(1300, 5400) * spread * (1.0 - 0.42 * fall)
        dur = random.uniform(0.006, 0.015) * (1.0 + 0.8 * fall)
        gain = random.uniform(0.45, 1.0) * (1.0 - 0.5 * fall)
        lay(droplet(freq, dur, random.uniform(1.15, 1.8)), t, gain)
        rate = density * (1.0 - 0.55 * fall)
        t += random.expovariate(rate)       # clustered, never metronomic

    # A thin bed of turbulence under the droplets, to glue them into a stream
    # rather than a rattle. Deliberately quiet — the grain is the point.
    bed_track = [3000 * (0.45 ** (i / jn)) for i in range(jn)]
    bed = apply(svf(noise(jn), bed_track, 1.6, "bp"),
                [min(1.0, i / (0.004 * SR)) * math.exp(-max(0.0, i - 0.02 * SR)
                 / (0.07 * SR)) for i in range(jn)])
    # This gain is the knob that decides how the squirt reads. The bed fills
    # the silence between droplets, so raising it smooths the whole thing back
    # into the hiss this was trying to escape: at 0.17 the grain is already
    # masked, at 0.0 the droplets are bare and it rattles. Low, not absent.
    lay(bed, 0.0, 0.07)
    lay(apply(highpass(noise(jn), 4200),
              [math.exp(-i / (0.03 * SR)) for i in range(jn)]), 0.0, 0.05)

    # The splat: a hard transient, then a resonance sliding down through wet
    # paint, then the sticky spatter afterwards.
    hit = 0.145
    tn = int(0.012 * SR)
    lay(apply(highpass(noise(tn), 900), decay(tn, 0.0022)), hit, 1.0)

    bn = int(0.16 * SR)
    top = random.uniform(1500, 2100)
    slide = [top * ((random.uniform(0.16, 0.24)) ** (i / bn)) for i in range(bn)]
    body = apply(svf(noise(bn), slide, 7.0, "bp"), decay(bn, 0.042))
    lay(body, hit, 1.0)

    spatter = apply(highpass(noise(bn), 3200), decay(bn, 0.055))
    lay(spatter, hit + 0.006, 0.30)

    # A few stray droplets landing after the main hit.
    for _ in range(random.randint(3, 6)):
        dn = int(random.uniform(0.006, 0.016) * SR)
        drop = apply(svf(noise(dn), random.uniform(1800, 4200), 6.0, "bp"),
                     decay(dn, 0.004))
        lay(drop, hit + random.uniform(0.03, 0.20), random.uniform(0.12, 0.34))

    # Nothing below this is paint — it is drum, and it is what made the old
    # version sound like a tom.
    return edges(highpass(out, 240), 3.0)


def glass(seed):
    """Hammer: the impact, then a window coming down.

    Glass is a cloud of short inharmonic resonances at scattered pitches, so
    it is built as a few dozen little rings rather than as filtered noise.
    Density thins out over time, which is what makes it read as shards
    settling instead of a single crash."""
    random.seed(seed)
    n = int(0.80 * SR)
    out = [0.0] * n

    def lay(buf, at, gain):
        start = int(at * SR)
        for j, v in enumerate(buf):
            if start + j < n:
                out[start + j] += v * gain

    # The blow itself — brief, and deliberately light on low end.
    tn = int(0.05 * SR)
    lay(apply(highpass(noise(tn), 700), decay(tn, 0.006)), 0.0, 1.0)
    lay(apply(sweep(tn, 320, 120), decay(tn, 0.018)), 0.0, 0.30)

    # The break: a dense burst of glass grit right at the impact.
    gn = int(0.22 * SR)
    grit = apply(svf(noise(gn), 3200, 1.1, "bp"), decay(gn, 0.045))
    lay(grit, 0.004, 0.55)

    # Shards. Each is a ring with an inharmonic partner an odd interval up,
    # which is the whole difference between glass and a bell.
    def shard(freq, dur):
        sn = int(dur * SR)
        low = osc(sn, freq)
        high = osc(sn, freq * random.uniform(2.4, 3.4))
        env = decay(sn, dur * 0.3)
        return [(0.72 * a + 0.28 * b) * e for a, b, e in zip(low, high, env)]

    for _ in range(random.randint(46, 62)):
        # Cubed random clusters the shards near the impact and lets a few
        # stragglers tinkle down late.
        at = 0.60 * (random.random() ** 3)
        freq = random.uniform(1300, 7200)
        dur = random.uniform(0.02, 0.11)
        gain = random.uniform(0.08, 0.34) * (1.0 - at / 0.9)
        lay(shard(freq, dur), 0.006 + at, gain)

    return edges(highpass(out, 260), 3.0)


def paint():
    n = int(0.22 * SR)
    blop = apply(sweep(n, 520, 105), decay(n, 0.045))
    splat = apply(svf(noise(n), 1500, 1.3, "bp"), decay(n, 0.028))
    return mix([v * 0.85 for v in blop], [v * 0.55 for v in splat])


def phaser():
    n = int(0.45 * SR)
    track = [2600 * (0.09 ** (i / n)) * (1.0 + 0.10 * math.sin(2 * math.pi * 34 * i / SR))
             for i in range(n)]
    core, phase = [], 0.0
    for i in range(n):
        phase += track[i] / SR
        phase %= 1.0
        core.append(0.65 * math.sin(2 * math.pi * phase)
                    + 0.35 * (1.0 if phase < 0.5 else -1.0))
    ring = svf(noise(n), track, 6.0, "bp")
    return mix(apply(core, ar(n, 0.004, 0.16)),
               [v * 0.45 for v in apply(ring, decay(n, 0.09))])


def stamp():
    n = int(0.24 * SR)
    nz = noise(n)
    clack = apply(svf(nz, 1200, 2.6, "bp"), decay(n, 0.014))
    thud = apply(sweep(n, 210, 70), decay(n, 0.05))
    paper = apply(highpass(nz, 4000), decay(n, 0.025))
    return mix([v * 0.7 for v in clack], [v * 0.9 for v in thud],
               [v * 0.3 for v in paper])


def termites():
    # A scatter of tiny bites — irregular on purpose, so a loop of it never
    # settles into a rhythm.
    n = int(0.55 * SR)
    out = [0.0] * n
    i = 0
    while i < n:
        length = int(random.uniform(0.0015, 0.004) * SR)
        env = decay(length, 0.0016)
        chunk = apply(highpass(noise(length), 2400), env)
        gain = random.uniform(0.35, 1.0)
        for j, v in enumerate(chunk):
            if i + j < n:
                out[i + j] += v * gain
        i += int(random.uniform(0.010, 0.032) * SR)
    scrape = apply(svf(noise(n), 3400, 1.2, "bp"), ar(n, 0.02, 0.3))
    return edges(mix(out, [v * 0.18 for v in scrape]), 5.0)


def wash():
    n = int(0.40 * SR)
    nz = noise(n)
    track = [4200 * (0.42 ** (i / n)) for i in range(n)]
    spray = svf(nz, track, 1.5, "bp")
    fizz = highpass(nz, 5000)
    env = ar(n, 0.035, 0.16)
    return edges(mix(apply(spray, env), [v * 0.4 for v in apply(fizz, env)]), 5.0)


def menu():
    a = int(0.030 * SR)
    b = int(0.045 * SR)
    first = apply(osc(a, 760, "square"), decay(a, 0.020))
    second = apply(osc(b, 1180, "square"), decay(b, 0.028))
    return edges([v * 0.8 for v in first] + [v * 0.7 for v in second], 2.0)


# Peaks are balanced by how often each one fires: the machine gun and the
# chain-saw retrigger many times a second and have to sit well under the
# one-shot weapons or they dominate everything.
EFFECTS = [
    ("hammer", lambda: glass(3), 0.90),
    ("hammer2", lambda: glass(19), 0.90),
    ("hammer3", lambda: glass(53), 0.90),
    ("gun", gun, 0.45),
    ("chainsaw", chainsaw, 0.42),
    ("flame_loop", flame_loop, 0.42),
    ("ember_loop", ember_loop, 0.40),
    ("cricket_loop", cricket_loop, 0.46),
    ("water_loop", water_loop, 0.46),
    ("paint", lambda: squirt(11), 0.72),
    ("paint2", lambda: squirt(29), 0.72),
    ("paint3", lambda: squirt(47), 0.72),
    ("phaser", phaser, 0.72),
    ("stamp", stamp, 0.82),
    ("termites", termites, 0.55),
    ("wash", wash, 0.55),
    ("menu", menu, 0.50),
]

if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for name, fn, peak in EFFECTS:
        write(name, fn(), peak)
