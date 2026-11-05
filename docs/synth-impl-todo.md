# Synth Implementation Todo

Purpose: Track gaps between current synth capabilities and modern
production-quality sound. Gaps identified 2026-07-06 during NG-preset
finetuning review. Revisit after each phase of work.

Priority legend: P0 = ship blocker for convincing instrument tones,
P1 = large quality jump, P2 = polish / niche.

---

## P0 — Heavy lifts

### 1. Convolution reverb

Load real impulse responses (church hall, plate, spring, room) and
convolve with the output signal. Single biggest quality upgrade for
algorithmic synthesis — puts FM/picked-string tones in a real space.

**Current:** FDN with Hadamard matrix. Good algorithmic verb but not
a real space.

**Approach:** Partitioned convolution (OLS or WOLA) for browser
real-time. Well-documented technique. IR files packaged as assets
or loaded from URL.

**Effort:** moderate (~1 week). FFT infrastructure in `shared/fft.ts`
is a starting point but needs partitioned real-time convolution.

**Files touched:** `synth/synthesis/effects.ts` (new effect block),
`synth/synth-effects.ts` (dispatch), `synth/config/enums.ts` (EffectType),
instrument serialization, editor UI for IR selection.

### 2. Proper sampler engine

Current: custom samples loaded as chip waves. No key zones, no velocity
layers, no round-robin, no independent ADSR per zone. Pitch playback
is linear — no per-note root key or sample rate metadata.

**What soundfonts need:** per-note sample assignment, velocity splits,
key zones, loop points with crossfade, per-sample ADSR override.

**Approach:** New InstrumentType (e.g. `sampler`) or extend chip-wave
system with zone maps. Use existing `decodeAudioData` infrastructure.

**Effort:** heavy (~2-3 weeks). New instrument type touches plugin
system, capabilities, synthesis dispatch, serialization, editor UI.

**Files touched:** `synth/instruments/`, `synth/plugins/`, `synth/synthesis/`,
`synth/config/`, `synth/synth-serialize.ts`, editor prompts.

### 3. Multiband processing

Split output into low/mid/high bands, process independently
(compression, EQ, saturation), recombine. Essential for:

- keeping lows warm and mono without mud
- adding air to highs without harshness
- de-essing mids

**Current:** single-band compressor at song level. Per-instrument EQ is
serial biquads, no band splitting.

**Approach:** 3-band Linkwitz-Riley crossover + per-band dynamics.
~200 lines of DSP at core, bigger refactor to fit in effects chain.

**Effort:** moderate (~1 week for core, +editor UI).

**Files touched:** `synth/synthesis/effects.ts`, `synth/post-processing.ts`,
`synth/config/enums.ts` (new EnvelopeComputeIndex entries for band params),
editor UI.

---

## P1 — Moderate impact, lower effort

### 4. Saturation variety

Current: one waveshaper curve (arctan-style). Missing: tape (soft clip +
pre-emphasis), tube (asymmetric clip), transformer (low-end saturation),
diode (harsh clip).

Each is a different waveshaping function + optional pre/post filter.
Drop-in replacement for the distortion block.

**Effort:** easy (~2-3 days). Add `saturationType` param to existing
distortion effect.

**Files touched:** `synth/synthesis/effects.ts` (modify distortion section),
editor UI for saturation type dropdown.

### 5. Transient shaper

Attack/release envelope follower on amplitude. Makes picked-string plucks
snappier, drums punchier. Independent attack/release knobs.

**Effort:** trivial (~1 day). pure amplitude processing, no delay lines.

**Files touched:** `synth/synthesis/effects.ts`, `synth/config/enums.ts`.

### 6. Stereo imaging (mid/side)

Current: only per-channel pan. No stereo width, no mid/side EQ, no
stereo enhancement.

Add M/S matrix encoder/decoder + width parameter + optional M/S EQ.

**Effort:** easy (~1-2 days). M/S matrix is sum/difference.

**Files touched:** `synth/synthesis/effects.ts`, editor UI.

### 7. Spectral shaping / EQ matching

Compute target frequency envelope from a reference sample (e.g. extracted
from a SoundFont). Apply spectral tilt + notch filters to FM output to
match the target.

FFT infrastructure already exists in `shared/fft.ts`.

**Effort:** moderate (~3-4 days). Analysis is offline (per-preset during
finetuning), filtering is real-time biquads.

**Files touched:** `shared/fft.ts` (may need extension), preset finetuning
workflow scripts, `synth/synthesis/effects.ts`.

### 8. Formant filter bank

3-4 parallel bandpass filters at fixed vowel formant frequencies
(A: 800+1200+2500 Hz, E: 500+1800+2500 Hz, etc.). Critical for
choir/voice presets.

**Effort:** moderate (~2-3 days). Static filter bank, no real-time
formant tracking needed for preset use.

**Files touched:** `synth/synthesis/effects.ts`, editor UI for
vowel select.

### 9. Parallel FX routing

Current: serial effects chain only. No dry/wet blend on most effects
(reverb has a TODO comment about missing wet/dry). No send/return bus.

Add per-effect wet/dry. Add optional parallel blend
(distorted parallel with dry, not serial).

**Effort:** easy (~1 day for wet/dry). Moderate (~1 week for send/return).

**Files touched:** `synth/synthesis/effects.ts`, instrument serialization,
editor UI.

---

## P2 — Polish / niche

### 10. Dynamic EQ

Frequency-dependent compression. De-essing (cut above ~5 kHz on loud
sibilants), low-frequency ducking.

Effort: moderate (~3 days). Requires envelope follower + frequency-
split threshold.

### 11. Exciter / harmonic enhancer

Add subtle even-harmonic saturation to highs. Makes dull tones
brighter without harshness. Common in modern mastering.

Effort: easy (~1 day). Parallel saturation with highpass filter
on the saturating path.

### 12. Sidechain / ducking

Envelope follower from one channel to control gain of another.
Kick → bass ducking.

Effort: moderate (~3-4 days). Cross-channel state management is the
hard part in the current architecture.

---

## Not-done-because (design constraints)

These are intentionally out of scope unless the project changes direction:

| Feature | Reason |
|---------|--------|
| True SoundFont (.sf2) playback | .sf2 is a complex container format. Implementing a parser is a separate project. Sample extraction + spectral matching is more practical. |
| VST/AU plugin hosting | Browser context. Not possible without WASM sandboxing and a VST bridge. |
| Real-time audio input | AudioWorklet supports it, but editor focus is composition not live processing. |
| MIDI out to external gear | Low priority for an in-browser sketching tool. |
| Polyphonic aftertouch | MIDI spec detail, no current MIDI input support that would use it. |

---

## Measurement

For each implemented feature, verify:

1. **No new NaN/denormal paths** in hot loops (sanitize with epsilon check).
2. **Effect signature bitmask** updated in `synth-effects.ts` (max 7 bits
   currently, room for growth).
3. **URL hash compatibility** — old songs without the new effect must
   deserialize without error.
4. **Cache invalidation** in `synth/plugins/effects.ts` cache array.
5. **Test:** existing synthesis tests pass (`bun test`).
6. **Test:** new effect has a basic unit test in `tests/`.
