# synth/render — Audio rendering pipeline

## Purpose

Pure-function synth rendering extracted from `Synth` for the AudioWorklet thread. All modules avoid DOM, AudioContext, and mutable Song state.

## Files

| File | Purpose |
|------|---------|
| `compute-tone.ts` | Pure `computeToneSnapshot()` — standalone substitute for `Synth.computeTone()`. Reads `SongSnapshot` + `ToneRenderEnv`, writes `Tone` fields. No Synth reference. |
| `snapshot.ts` | `SongSnapshot` — frozen copy of song data for worklet consumption. Builder/writer pattern. |
| `render-core.ts` | Render utilities extracted from Synth: `playTone()`, `allocTone()`, `releaseTone()`, `freeReleasedTone()`, `getSamplesPerTick()`. |
| `worklet-messages.ts` | Structured-clone-safe message types for main-thread ↔ worklet protocol: `WorkletToneCommand`, init/tick/stop/reset/ready/tick-complete messages. |
| `worklet.ts` | `AudioWorkletProcessor` entry point. Maintains Tone pool, deserializes tick commands, calls `computeToneSnapshot()` + worklet-native synth dispatch. |
| `worklet-synth.ts` | Worklet-native instrument synth functions (chip, pulse, noise, spectrum, harmonics, FM, supersaw, drumset). Each reads Tone fields and writes to a temp accumulation buffer. No Synth class reference. |

## Protocol flow

1. Main thread sends `MSG_INIT` with `SongSnapshot`
2. Worklet replies `MSG_READY`
3. Per tick: main thread sends `MSG_TICK` with `WorkletToneCommand[]`
4. Worklet `process()`: deserializes commands, runs `computeToneSnapshot()`, renders samples via worklet synth dispatch, signals `MSG_TICK_COMPLETE`

## Phase 5 scope

- Worklet-native synth dispatch covers all instrument types except: picked-string, custom-chip-loopable, 6-op FM
- Effects (echo, reverb, chorus, phaser, granular, distortion, bitcrusher, compressor, comb flanger) are handled on main thread only
- Mod values are serialized in full from `Synth.modState`
- Main-thread rendering is skipped when worklet active
