# Upstream Mapping

Structural differences between upstream (`~/JukeBox_TypeScript`, [JukeeBox/JukeBox_TypeScript](https://github.com/JukeeBox/JukeBox_TypeScript)) and this fork. Use this to translate upstream diffs into fork paths.

## `editor/changes/`

Upstream has a single `editor/changes.ts`. This fork splits it into modules under `editor/changes/`:

| Upstream content | Fork path |
|---|---|
| Song-level changes (`ChangeTempo`, `ChangeOctaveCount`, `ChangeVolume`, `ChangePan`, etc.) | `editor/changes/song.ts` |
| Instrument changes (`ChangePreset`, `ChangeChipWave`, etc.) | `editor/changes/instruments.ts` |
| Note/pattern changes (`ChangeNoteAdded`, `ChangeTranspose`, etc.) | `editor/changes/notes.ts` |
| Filter changes (`ChangeEQFilterType`, etc.) | `editor/changes/filters.ts` |
| Slider changes (`ChangeEchoDelay`, `ChangeReverb`, etc.) | `editor/changes/sliders.ts` |
| Utilities (`generateScaleMap`, `discardInvalidPatternInstruments`) | `editor/changes/util.ts` |
| Exports | `editor/changes/index.ts` (barrel) |

## `editor/` extractions from `SongEditor.ts`

Upstream has a monolithic `editor/SongEditor.ts`. The fork extracts UI components, renderers, core logic, and I/O into subdirectories:

| Fork directory | Extracted from | Content |
|---|---|---|
| `editor/components/` | `editor/SongEditor.ts` | UI components (PatternEditor, Piano, TrackEditor, etc.) |
| `editor/renderers/` | `editor/SongEditor.ts` | State-to-DOM sync functions (renderLayout, renderEffects, renderInstrumentValues, etc.) |
| `editor/renderers/instrument-visibility.ts` | `editor/SongEditor.ts` | Instrument show/hide toggling |
| `editor/core/` | `editor/SongEditor.ts` + `editor/changes.ts` | ChangeDispatcher, KeyboardHandler, PromptManager, ModSliderRegistry |
| `editor/io/` | `editor/Midi.ts`, `editor/MidiInput.ts`, `editor/SongRecovery.ts` | MIDI I/O and song recovery (moved from editor root) |
| `editor/rendering/custom-chip-canvas.ts` | `editor/SongEditor.ts` | `CustomChipCanvas` class for waveform editing |
| `editor/rendering/custom-algorithm-canvas.ts` | `editor/SongEditor.ts` | `CustomAlgorithmCanvas` class for FM algorithm editing |

## `editor/` extractions from other upstream files

| Fork file | Extracted from | Content |
|---|---|---|
| `editor/rendering/themes/*.ts` | `editor/ColorConfig.ts` | Theme CSS definitions split into one file per theme |
| `editor/config/preset-categories.ts` | `editor/EditorConfig.ts` | Preset instrument categories and `Preset`/`PresetCategory` interfaces |
| `editor/core/preferences.ts` | `editor/Preferences.ts` | User preference settings |
| `editor/core/selection.ts` | `editor/Selection.ts` | Note and bar selection state (upstream: `SongEditor.ts` inline) |
| `editor/core/change.ts` | `editor/changes.ts` (top) | Base `Change` and `ChangeGroup` classes |
| `editor/core/change-notifier.ts` | `editor/ChangeNotifier.ts` | Change notification/pub-sub |
| `editor/core/song-performance.ts` | `editor/SongPerformance.ts` | Song playback performance state |
| `editor/core/player-animator.ts` | `editor/SongEditor.ts` | Player animation frame scheduling |

## `editor/ui/`

Upstream has `ArrayBufferReader.ts`, `ArrayBufferWriter.ts`, `HTMLWrapper.ts`, `Layout.ts` at `editor/` root. The fork moves them to `editor/ui/`:

| Upstream | Fork |
|---|---|
| `editor/ArrayBufferReader.ts` | `editor/ui/array-buffer-reader.ts` |
| `editor/ArrayBufferWriter.ts` | `editor/ui/array-buffer-writer.ts` |
| `editor/HTMLWrapper.ts` | `editor/ui/html-wrapper.ts` |
| `editor/Layout.ts` | `editor/ui/layout.ts` |

## `editor/prompts/`

Upstream has 25 `*Prompt.ts` files directly in `editor/`. The fork moves them to `editor/prompts/` with kebab-case names:

| Upstream | Fork |
|---|---|
| `editor/ExportPrompt.ts` | `editor/prompts/export-prompt.ts` |
| `editor/TipPrompt.ts` | `editor/prompts/tip-prompt.ts` |
| `editor/*Prompt.ts` (all) | `editor/prompts/*-prompt.ts` |

Fork-only prompts (not in upstream): `base-prompt.ts`, `channel-volume-visualizer-prompt.ts`, `euclidgen-rhythm-prompt.ts`, `input-helpers.ts`, `keyboard-shortcuts-prompt.ts`, `octave-count-prompt.ts`, `preset-selector-prompt.ts`, `recording-setup-prompt.ts`, `sample-loading-status-prompt.ts`, `visual-loop-controls-prompt.ts`.

## `synth/`

Upstream has a single `synth/synth.ts`. This fork splits it into modules:

| Upstream content | Fork path |
|---|---|
| `Song` class, serialization/deserialization | `synth/song.ts` |
| `SongTagCode`, `base64IntToCharCode`, `BitFieldReader/Writer` | `synth/serialization.ts` |
| `Instrument` class | `synth/instruments.ts` |
| `Note`, `Pattern`, `Channel` classes | `synth/channels.ts`, `synth/notes.ts` |
| Spectrum, harmonics, granular waveform classes | `synth/waves.ts` |
| Shared utilities (`clamp`, etc.) | `synth/util.ts` |
| Re-exports | `synth/index.ts` |
| `Config`, `InstrumentType`, enums, chip wave/noise presets | `synth/synth-config.ts` |
| Synthesis engine (remaining after extraction) | `synth/synth.ts` (reduced from upstream) |
| `PickedString` class (extracted from synth.ts) | `synth/picked-string.ts` |
| `EnvelopeComputer` class (extracted from synth.ts) | `synth/envelope-computer.ts` |
| `Tone` class (extracted from synth.ts) | `synth/tone.ts` |
| `InstrumentState` class (extracted from synth.ts) | `synth/instrument-state.ts` |
| `ChannelState` class (extracted from synth.ts) | `synth/channel-state.ts` |
| Shared filter coefficients and volume utilities | `synth/synth-shared.ts` |
| Shared with upstream (unchanged) | `synth/deque.ts`, `shared/fft.ts`, `synth/filtering.ts` |

## `synth/` fork-only additions

These modules don't exist in upstream, they replace switch-case logic in `synth/synth.ts`:

| Fork path | Content |
|---|---|
| `synth/plugins/` | Plugin registry: one file per instrument type (`fm.ts`, `chip.ts`, `pulse.ts`, `noise.ts`, `harmonics.ts`, `spectrum.ts`, `drumset.ts`, `picked-string.ts`, `supersaw.ts`, `mod.ts`) |
| `synth/plugins/registry.ts` | Plugin registration and lookup |
| `synth/plugins/interfaces.ts` | Plugin interface definitions |
| `synth/plugins/capabilities.ts` | Instrument capability flags |
| `synth/plugins/effects.ts` | Shared effects computation |
| `synth/synthesis/` | Synthesis source string builders per instrument type (mirrors plugin names) |
| `synth/song-serialization.ts` | Song string serialization helpers (extracted from `synth/song.ts`) |
| `synth/song-utilities.ts` | Song utility functions (extracted from `synth/song.ts`) |

## `player/`

Upstream has `player/main.ts` (monolithic). The fork extracts UI components:

| Upstream content | Fork path |
|---|---|
| Player controls (play, pause, volume) | `player/player-controls.ts` |
| Keyboard input handling | `player/player-keyboard.ts` |
| Timeline/position bar | `player/player-timeline.ts` |
| Core UI wiring | `player/player-ui.ts` |
| Entry point (remaining) | `player/main.ts` |
| Re-exports | `player/index.ts` |

## 1:1 mapping (no structural change)

- `shared/events.ts` (upstream: `global/Events.ts`)
- `shared/oscilloscope.ts` (upstream: `global/Oscilloscope.ts`)

## Fork-only additions

- `editor/song-custom-samples.ts`, custom sample management (extracted from `SongEditor.ts`)

## Renamed files (kebab-case)

All fork files use kebab-case. Key upstream-to-fork name translations:

| Upstream name | Fork name |
|---|---|
| `SynthConfig.ts` | `synth/synth-config.ts` |
| `SongEditor.ts` | `editor/song-editor.ts` |
| `SongDocument.ts` | `editor/song-document.ts` |
| `ColorConfig.ts` | `editor/rendering/color-config.ts` |
| `EditorConfig.ts` | `editor/config/editor-config.ts` |
| `Change.ts` | `editor/core/change.ts` |
| `ChangeNotifier.ts` | `editor/core/change-notifier.ts` |
| `Selection.ts` | `editor/core/selection.ts` |
| `Preferences.ts` | `editor/core/preferences.ts` |
| `SongPerformance.ts` | `editor/core/song-performance.ts` |
| `KeyboardLayout.ts` | `editor/config/keyboard-layout.ts` |
| `Midi.ts` | `editor/io/midi.ts` |
| `MidiInput.ts` | `editor/io/midi-input.ts` |
| `SongRecovery.ts` | `editor/io/song-recovery.ts` |
| `ArrayBufferReader.ts` | `editor/ui/array-buffer-reader.ts` |
| `ArrayBufferWriter.ts` | `editor/ui/array-buffer-writer.ts` |
| `HTMLWrapper.ts` | `editor/ui/html-wrapper.ts` |
| `Layout.ts` | `editor/ui/layout.ts` |
| `style.ts` | `editor/rendering/style.ts` |
| `Deque.ts` | `synth/deque.ts` |
| `FFT.ts` | `shared/fft.ts` |
| `filtering.ts` | `synth/filtering.ts` |
| `global/Events.ts` | `shared/events.ts` |
| `global/Oscilloscope.ts` | `shared/oscilloscope.ts` |
| All `*Prompt.ts` files | `editor/prompts/*-prompt.ts` (kebab-case) |
| All component files | `editor/components/*-*.ts` (kebab-case) |

## Quick reference

When reading an upstream diff:

1. `editor/changes.ts` → determine concern (song/instrument/note/filter/slider) → corresponding `editor/changes/*.ts`
2. `editor/SongEditor.ts` → component? → `editor/components/`, renderer? → `editor/renderers/`, core logic? → `editor/core/`
3. `synth/synth.ts` → `Song` class → `synth/song.ts`, serialization → `synth/serialization.ts`, instruments → `synth/instruments.ts`
4. PascalCase filenames → convert to kebab-case (see table above)
5. `global/*.ts` → `shared/*.ts`
6. `player/main.ts` → determine concern (controls/keyboard/timeline/UI) → corresponding `player/*.ts`
7. Top-level `editor/*.ts` (excluding `SongEditor.ts`, `SongDocument.ts`, `main.ts`) → likely `editor/ui/`, `editor/io/`, or `editor/core/`
8. Everything else → same path (with kebab-case name)

For direct local comparison: `diff -rq ~/JukeBox_TypeScript/editor ./editor`.
