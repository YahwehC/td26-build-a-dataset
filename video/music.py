"""Soft music bed for the demo film, synthesised here (no samples): warm pad chords + a light plucked arpeggio
at 96 BPM, ducked under the voiceover using the cue sheet. Writes out/music.wav (48 kHz stereo).
Run after voice.py: python video/music.py"""
import json, pathlib, wave

import numpy as np

HERE = pathlib.Path(__file__).parent
OUT = HERE / "out"
SR = 48000
cues = json.loads((OUT / "cues.json").read_text(encoding="utf-8"))
total = cues["total"]
n = int(total * SR)
t = np.arange(n) / SR
BPM = 96
beat = 60 / BPM
bar = beat * 4


def midi(m):
    return 440.0 * 2 ** ((m - 69) / 12)


# I - vi - IV - V in C major, voiced warm and low
CHORDS = [[48, 55, 64, 67, 71], [45, 52, 60, 64, 67], [41, 48, 57, 60, 64], [43, 50, 59, 62, 67]]
pad = np.zeros(n)
pluck = np.zeros(n)
rng = np.random.default_rng(7)
for b in range(int(total / bar) + 1):
    ch = CHORDS[b % 4]
    s0, s1 = int(b * bar * SR), min(n, int((b + 1) * bar * SR + 0.6 * SR))
    if s0 >= n:
        break
    tt = t[s0:s1] - b * bar
    env = np.minimum(1, tt / 0.8) * np.exp(-np.maximum(0, tt - bar) * 3)
    for m in ch:
        f = midi(m)
        pad[s0:s1] += env * (np.sin(2 * np.pi * f * tt) + 0.25 * np.sin(2 * np.pi * 2 * f * tt + 0.3)) / len(ch)
    # arpeggio: 8th notes over the chord, an octave up
    for k in range(8):
        m = ch[[1, 2, 3, 4, 3, 2, 3, 4][k]] + 12
        a0 = int((b * bar + k * beat / 2) * SR)
        a1 = min(n, a0 + int(0.9 * SR))
        if a0 >= n:
            break
        ta = t[a0:a1] - t[a0]
        f = midi(m)
        tone = np.sin(2 * np.pi * f * ta) + 0.35 * np.sin(2 * np.pi * 2 * f * ta) + 0.12 * np.sin(2 * np.pi * 3 * f * ta)
        pluck[a0:a1] += tone * np.exp(-ta * 6.5) * (0.75 + 0.25 * rng.random())

mix = 0.55 * pad + 0.22 * pluck
# fade in/out
mix *= np.minimum(1, t / 1.5) * np.minimum(1, (total - t) / 2.5)
# duck under the voice (smooth gain: 1.0 in gaps, 0.45 while someone speaks)
gate = np.zeros(n)
for c in cues["cues"]:
    gate[int(c["start"] * SR):int(c["end"] * SR)] = 1
k = int(0.25 * SR)
cs = np.concatenate([[0], np.cumsum(gate)])          # moving average via cumulative sum (fast)
lo = np.clip(np.arange(n) - k // 2, 0, n); hi = np.clip(np.arange(n) + k // 2, 0, n)
gate = (cs[hi] - cs[lo]) / k
mix *= 1 - 0.55 * gate
mix = mix / np.max(np.abs(mix)) * 10 ** (-20 / 20)   # peak -20 dBFS: a bed under the voice
# light stereo width
left = mix + 0.08 * np.roll(pluck, 480) * 10 ** (-20 / 20)
right = mix - 0.08 * np.roll(pluck, 480) * 10 ** (-20 / 20)
st = np.stack([left, right], 1)
st = np.clip(st, -1, 1)
with wave.open(str(OUT / "music.wav"), "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((st * 32767).astype("<i2").tobytes())
print("music.wav", f"{total:.1f} s")
