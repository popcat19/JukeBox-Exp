# TESTING

Purpose: Conventions and cross-references for the test suite (bun:test).

Designed for an AI-driven codebase. Every convention reduces ambiguity
for an LLM generating or modifying tests.

## Finding the test for a source module

Use the cross-reference table below. If no test file is listed, the
module has no dedicated test coverage. Add a test file when modifying
an uncovered module.

### tooling/

| Source | Test file | Scope |
|--------|-----------|-------|
| `scripts/check-import-boundaries.ts` | `tests/import-boundaries.test.ts` | boundary rules per context pair, baselined and resolved violations, cycle growth, new cycles, and shrink notice |
| `scripts/check-lint-baseline.mjs` | `tests/lint-baseline.test.ts` | unchanged, added, moved, removed, and malformed warning baselines |

### synth/

| Source | Test file | Scope |
|--------|-----------|-------|
| `synth/util.ts` | `tests/synth-utilities.test.ts` | clamp, validateRange, fittingPowerOfTwo, fade conversion |
| `synth/synth-config.ts` | `tests/synth-utilities.test.ts` | performIntegral, getPulseWidthRatio, getArpeggioPitchIndex, effects helpers, EffectType, Config |
| `synth/synth-config.ts` | `tests/song-document-integration.test.ts` | hasEffect, effectsIncludeTransition, effectsIncludeChord |
| `synth/synth-math.ts` | `tests/synth-math.test.ts` | getLFOAmplitude, computeChordExpression, operatorAmplitudeCurve, adjacentNotesHaveMatchingPitches, volume conversion |
| `synth/synth-shared.ts` | `tests/synth-shared.test.ts` | instrumentVolumeToVolumeMult, noteSizeToVolumeMult |
| `synth/compressor.ts` | `tests/compressor.test.ts` | gain reduction, sync ducking, serialization round-trip |
| `synth/dsp-utils.ts` | `tests/dsp-utils.test.ts` | applyFilters, sanitizeDelayLine, findRandomZeroCrossing |
| `synth/filtering.ts` | `tests/filtering.test.ts` | FilterCoefficients, FrequencyResponse, DynamicBiquadFilter, warp functions |
| `synth/notes.ts` | `tests/notes.test.ts` | Note, Pattern, makeNotePin |
| `editor/changes/notes.ts` | `tests/note-mutation-fuzz.test.ts` | ChangeNoteLength, ChangePinTime, ChangePitchBend |
| `synth/song.ts` | `tests/song-serialization.test.ts` | toBase64String, fromBase64String, failure resilience |
| `synth/synth-deserialize.ts` | `tests/song-data-recovery.test.ts` | typed corruption failures, bounded modulator and target repairs, stale index rejection |
| `synth/song.ts` | `tests/song-round-trip.test.ts` | round-trip encode/decode, modified song, toJsonObject/fromJsonObject |
| `synth/song.ts` | `tests/song-document-integration.test.ts` | hasEffect, effects bitmask round-trip |
| `synth/song.ts` | `tests/plugin-round-trip.test.ts` | per-type instrument encode→decode |
| `synth/instruments/` | `tests/synth-math.test.ts` | Instrument usage in operatorAmplitudeCurve |
| `synth/serialization.ts` | `tests/song-serialization.test.ts` | base64CharCodeToInt, base64IntToCharCode, getNeededBits |
| `synth/formats/jukebox-exp.ts` | `tests/barrel-exports.test.ts` | fromJukeboxExpJson, toJukeboxExpJson (indirect) |
| `synth/index.ts` (barrel) | `tests/barrel-exports.test.ts` | All synth re-exports |
| `synth/plugins/` | `tests/barrel-exports.test.ts` | Plugin registry barrel |
| `synth/synthesis/` | `tests/barrel-exports.test.ts` | Synthesis source builders barrel |
| `synth/synthesis/chip.ts` | `tests/synthesis.test.ts` | buildChipSource, buildLoopableChipSource |
| `synth/synthesis/drum.ts` | `tests/synthesis.test.ts` | buildDrumSource |
| `synth/synthesis/effects.ts` | `tests/synthesis.test.ts` | buildEffectsSource |
| `synth/synthesis/fm.ts` | `tests/synthesis.test.ts` | buildFmSource |
| `synth/synthesis/fm6.ts` | `tests/synthesis.test.ts` | buildFm6Source |
| `synth/synthesis/harmonics.ts` | `tests/synthesis.test.ts` | buildHarmonicsSource |
| `synth/synthesis/noise.ts` | `tests/synthesis.test.ts` | buildNoiseSource |
| `synth/synthesis/picked-string.ts` | `tests/synthesis.test.ts` | buildPickedStringSource |
| `synth/synthesis/pulse.ts` | `tests/synthesis.test.ts` | buildPulseWidthSource |
| `synth/synthesis/spectrum.ts` | `tests/synthesis.test.ts` | buildSpectrumSource |
| `synth/synthesis/supersaw.ts` | `tests/synthesis.test.ts` | buildSupersawSource |
| `synth/config/` | `tests/barrel-exports.test.ts` | Config, types, utils barrel |
| `synth/formats/` | `tests/barrel-exports.test.ts` | JukeboxExp + legacy compat barrel |
| `synth/synth.ts` | `tests/synth-contract.test.ts` | Public API surface after extraction (sanitizeFilters delegation, removed legacy fields) |
| `synth/tone.ts` | `tests/tone.test.ts` | Constructor, reset, state defaults |
| `synth/channels.ts` | `tests/channels.test.ts` | Channel defaults, array initialization |
| `synth/channel-state.ts` | `tests/channels.test.ts` | ChannelState defaults, audio buffer sizing |
| `synth/deque.ts` | `tests/deque.test.ts` | FIFO/LIFO order, capacity expansion, index get/set/remove, empty errors |
| `shared/fft.ts` | `tests/fft.test.ts` | scaleElementsByFactor, discreteFourierTransform, fastFourierTransform, forwardRealFourierTransform, inverseRealFourierTransform |
| `synth/waves.ts` | `tests/waves.test.ts` | SpectrumWave constructor/reset/hash, SpectrumWaveState getCustomWave caching |
| `synth/envelope-computer.ts` | `tests/envelope-computer.test.ts` | Constructor, reset, clearEnvelopes, computeEnvelope static (none, twang, lfo, decay, blip, linear, fall, punch, inverse, bounds), computePitchEnvelope, getLowpassCutoffDecayVolumeCompensation |
| `synth/picked-string.ts` | `tests/picked-string.test.ts` | Constructor, reset, coefficient defaults |
| `synth/instrument-state.ts` | `tests/instrument-state.test.ts` | Constructor, tone pool defaults, flag defaults, type/unison/effect defaults |
| `synth/song-utilities.ts` | `tests/song-utilities.test.ts` | envelopeFromLegacyIndex, isProperUrl, restoreChipWaveListToDefault, clearSamples |
| `synth/mod-state.ts` | `tests/mod-state.test.ts` | init, setModValue/getModValue, isModActive/isAnyModActive, unset, forceHoldMods, advanceNextToValues, initModFilters |

| `synth/instruments/filter-control-point.ts` | `tests/filter-control-point.test.ts` | Hz conversion roundtrip, linear gain, volume compensation for low-pass/high-pass/peak |
| `synth/synth-shared.ts` | `tests/synth-shared.test.ts` | instrumentVolumeToVolumeMult and noteSizeToVolumeMult edge cases (zero, max, monotonicity) |
| `synth/post-processing.ts` | `tests/post-processing.test.ts` | sanitizeFilters — overflow reset, epsilon clamping, empty array, normal value preservation |
| `synth/synth-effects.ts` | `tests/synth-effects.test.ts` | Module import and export shape |

| `synth/audio-worklet-processor.ts` | `tests/audio-worklet-processor.test.ts` | Syntax validation via Function(), brace/paren/bracket balance, regression guard for stray closing braces in embedded JS |

**Recently added test coverage:**

| Source | Test file | Scope |
|--------|-----------|-------|
| `synth/config/enums.ts` | `tests/enums.test.ts` | Enum value constants |
| `synth/config/instrument-registry.ts` | `tests/instrument-registry.test.ts` | Registration, name↔id, duplicates |
| `synth/config/synth-math-utils.ts` | `tests/synth-math-utils.test.ts` | getPulseWidthRatio, getDrumWave, getArpeggioPitchIndex, calculateRingModHertz |
| `synth/instruments/envelope-settings.ts` | `tests/envelope-settings.test.ts` | Serialization, tremolo2→LFO migration |
| `synth/instruments/filter-settings.ts` | `tests/filter-settings.test.ts` | Control points, morph, lerp |
| `synth/instruments/custom-algorithm.ts` | `tests/custom-algorithm.test.ts` | Constructor, set, copy, fromPreset |
| `synth/instruments/custom-feedback.ts` | `tests/custom-feedback.test.ts` | Constructor, set, copy, fromPreset, reset bugfix |
| `synth/song-serialization-shared.ts` | `tests/song-serialization-shared.test.ts` | ENV_* constants, version ranges, VARIANT |
| `synth/deserialize/decode-variant.ts` | `tests/decode-variant.test.ts` | Variant detection, version validation, compatibility booleans (beforeTwo..beforeNine, forceSimpleFilter) |
| `synth/deserialize/load-custom-samples.ts` | `tests/load-custom-samples.test.ts` | Pipe-split extraction, %7C encoding, null handler safety |

**Untested synth modules:** `config/sample-loader.ts` (barrel verified), `synth-deserialize.ts` (remaining switch body), `synth-serialize.ts`, `config/config-class.ts`, `audio-backend.ts`

**Instrument type round-trips (tested):** chip, fm, noise, spectrum, drumset,
harmonics, pwm, pickedString, supersaw, customChipWave, mod, fm6op.
All 12 types verified via encode→decode→type-preservation.

### editor/

| Source | Test file | Scope |
|--------|-----------|-------|
| `editor/input/inventory.ts` | `tests/input-inventory.test.ts` | InputBinding, inputBindings |
| `editor/core/application-router.ts`, `editor/song-editor.ts` | `tests/application-router.test.ts` | Global funnel convergence, unavailable and denied route results, synchronous guards, production wiring, immutable context, ordered import file delivery |
| `editor/core/preferences.ts` | `tests/navigator-contracts.test.ts`, `tests/pmd-hue.test.ts` | Navigator collapse persistence, PMD realtime default/persistence, and legacy migration |
| `editor/navigator/route-hints.ts`, `editor/navigator/navigator-shell.ts`, `editor/rendering/styles/prompt-navigator.ts` | `tests/navigator-route-hints.test.ts` | Fixed-width base-26 codes, visible route eligibility, transient focus lifecycle, typing, activation, ARIA, and PMD pills |
| `editor/core/pmd-realtime-hue.ts` | `tests/pmd-hue.test.ts` | Page-global singleton scheduling, document/window wake refresh, atomic restore, forced-dark transitions, persistence, and cleanup |
| `editor/song-editor.ts`, `editor/core/theme-raster-redraw.ts`, `editor/prompts/channel-volume-visualizer-prompt.ts`, `editor/prompts/visual-loop-controls-prompt.ts` | `tests/theme-raster-redraw.test.ts` | Behavioral theme redraw, weak owner pruning, prompt repaint, and idempotent cleanup |
| `editor/navigator/command-registry.ts` | `tests/command-registry.test.ts` | Stable metadata, fuzzy ranking, Navigator routing, argument validation, and one-based bar conversion |
| `editor/prompts/import-prompt.ts` | `tests/import-prompt-external-delivery.test.ts` | External file validation, transport restoration, completion ordering, cleanup invalidation, and latest-operation generation safety |
| `editor/prompts/instrument-import-prompt.ts` | `tests/instrument-import-completion.test.ts` | Successful import completion through bound Navigator close authority |
| `editor/prompts/theme-prompt.ts`, `editor/prompts/palette-prompt.ts`, `editor/prompts/custom-theme-prompt.ts` | `tests/visual-prompt-dirty-rollback.test.ts` | Dirty denial and confirmed rollback of theme, PMD, storage, CSS preview, and editor image state |
| `editor/prompts/limiter-prompt.ts`, `editor/rendering/styles/prompt-limiter.ts` | `tests/limiter-prompt.test.ts` | Slider mappings, live output sync, reset/rollback/commit, play, lifecycle cleanup, accessibility, hierarchy, and narrow no-overflow CSS contracts |
| `editor/components/command-palette.ts`, `editor/core/keyboard-handler.ts`, `editor/core/menu-handler.ts` | `tests/command-palette.test.ts` | Compact DOM, editor-state-preserving Escape cancellation, two-stage prompt Escape, slash guards, Ctrl+X editable Cut preservation, note-cut regression, and canonical route convergence |
| `editor/core/prompt-manager.ts`, `editor/core/popout-document-sync.ts`, `editor/navigator/contracts.ts`, `editor/navigator/route-identity.ts`, `editor/navigator/route-catalog.ts`, `editor/navigator/ownership.ts`, `editor/navigator/navigator-runtime.ts`, `editor/navigator/navigator-route-host.ts`, `editor/navigator/prompt-pane-owner.ts`, `editor/navigator/native-panes.ts`, `editor/navigator/*-pane.ts`, `editor/navigator/navigator-detached-host.ts`, `editor/prompts/prompt.ts`, `editor/prompts/export-prompt.ts`, `editor/prompts/add-samples-prompt.ts`, `editor/rendering/styles/prompt-navigator.ts`, `editor/rendering/styles/navigator-panes.ts`, `editor/rendering/styles/prompt-export.ts` | `tests/navigator-contracts.test.ts` | Lifecycle, capability availability, grouped search, per-section collapse, PMD disabled opacity, dirty denial, detach transfer, and stale generation safety |
| `editor/components/pattern-editor.ts` | `tests/pattern-editor-contract.test.ts` | Stale canvas path guard, SVG/canvas y-center alignment |
| `editor/components/loop-editor.ts` | `tests/loop-editor-contract.test.ts` | CSS class for disabled state, no inline opacity conflict |
| `editor/ui/index.ts` (barrel) | `tests/barrel-exports.test.ts` | buildOptions, numberInput, Slider, Layout, createDiv, etc. |
| `editor/ui/states.ts` | `tests/ui-states.test.ts` | Token values, surface CSS, source-grep proofs for refactored buttons |
| `editor/ui/buttons/action-button.ts` | `tests/action-button.test.ts` | Optional canonical PMD surfaces, role metadata, interaction hooks, idempotent decoration, and generic caller preservation |
| `editor/ui/surfaces.ts` | `tests/ui-states.test.ts` | primarySurface/secondarySurface/ghostSurface role outputs |
| `editor/ui/interactions.ts` | `tests/interactions-behavior.test.ts` | Behavioral: classList adds, style custom props, dataset writes, native disabled property writes, tagged style injection dedupe |
| `editor/ui/base/input.ts` | `tests/input-wheel-support.test.ts` | Numeric wheel preference, finite deltas/values, bounds, passive registration, exact events, and page-scroll isolation |
| `editor/ui/interactions.ts` (source-grep) | `tests/ui-states.test.ts` | CSS rule content (incl. pmd-disabled), helper exports, DisableableElement union coverage |
| `editor/ui/rows/selectable-row.ts`, `editor/rendering/styles/shared-ui.ts` | `tests/navigator-contracts.test.ts` | Shared search and selectable-row structure, PMD outline feedback, and active state reuse |
| `editor/components/mute-editor.ts` | `tests/ui-states.test.ts` | Source-grep: single-branch loop enter handler, leave reuses _updateLoopButton |
| `editor/prompts/channel-volume-visualizer-prompt.ts` | `tests/ui-states.test.ts` | Source-grep: single-branch loop enter handler, leave reuses _updateLoopButton |
| `editor/prompts/add-samples-prompt.ts`, `editor/prompts/instrument-browser-prompt.ts`, `editor/prompts/channel-volume-visualizer-prompt.ts`, `editor/prompts/limiter-prompt.ts` | `tests/stress-pane-lifecycle.test.ts` | Deferred-work ownership, cleanup cancellation, stale callback guards, live Limiter rendering, and repeated lifecycle ledgers |
| `editor/song-editor.ts` | `tests/loop-editor-contract.test.ts` | Focus-steal listeners for buttons/selects |
| `editor/song-document.ts`, `editor/core/selection.ts`, `editor/song-editor.ts` | `tests/song-document-contract.test.ts` | Issue #21 position persistence ordering, redo-preserving navigation, history-state application, and playback channel controls refresh; retained while issue #44 lifecycle coverage changes |
| `editor/changes/song.ts`, `editor/core/history-manager.ts`, `editor/io/song-recovery.ts` | `tests/song-data-recovery.test.ts` | atomic song replacement, history event coalescing, defensive recovery and quarantine records |
| `editor/song-editor.ts` | `tests/dom-hooks.test.ts` | Source literal `"beepboxEditor"` and `"promptContainer"` class declarations |
| `editor/main.ts` | `tests/dom-hooks.test.ts` | Source literal `"beepboxEditorContainer"` getElementById mount point |
| `editor/ui/style.ts` | `tests/dom-hooks.test.ts` | Source literal `"prompt noSelection"` promptFrame class |
| `editor/core/prompt-manager.ts` | `tests/dom-hooks.test.ts` | classList.add literals: entering, exiting, focused, refocus |
| `editor/core/prompt-drag.ts`, `editor/core/prompt-manager.ts` | `tests/prompt-drag.test.ts` | Whole-surface dragging, interactive exclusions, clamping, listener cleanup, and production wiring |
| `editor/core/prompt-dock.ts` | `tests/dom-hooks.test.ts` | classList.add("docked") lifecycle hook |
| `editor/core/prompt-popout.ts` | `tests/dom-hooks.test.ts` | dataset.popout set and data-popout removeAttribute |
| `editor/ui/interactions.ts` | `tests/dom-hooks.test.ts` | dataset.pmdRole assignment literals |
| `editor/rendering/style.ts` | `tests/dom-hooks.test.ts` | classList.add("obtrusive-scrollbars") hook |
| `editor/rendering/styles/*.ts` (16 modules) | `tests/editor-selector-scope.test.ts` | Selector scoping guard: all class selectors root under .beepboxEditor or are baseline-allowed page-level exceptions |
| `editor/song-editor.ts` | `tests/dom-hooks.test.ts` | Grid layout class literals: pattern-area, song-settings-area, instrument-settings-area, trackAndMuteContainer |
| `editor/components/bar-scroll-bar.ts` | `tests/dom-hooks.test.ts` | Source literal `"barScrollBar"` class declaration |
| `editor/components/track-editor.ts` | `tests/dom-hooks.test.ts` | Source literal `"noSelection"` class declaration |
| `editor/components/harmonics-editor.ts`, `editor/components/spectrum-editor.ts`, `editor/prompts/custom-filter-prompt.ts` | `tests/prompt-shell-contract.test.ts` | Standard prompt titlebar and button-row structure |
| `editor/components/filter-editor.ts`, `editor/components/harmonics-editor.ts`, `editor/components/spectrum-editor.ts` | `tests/svg-editor-rect-contract.test.ts` | Fresh SVG geometry on press, release invalidation, and safe hover recapture |
| `editor/components/harmonics-editor.ts`, `editor/components/spectrum-editor.ts`, `editor/prompts/custom-chip-prompt.ts`, `editor/prompts/custom-filter-prompt.ts`, `editor/prompts/limiter-prompt.ts` | `tests/svg-prompt-transaction-contract.test.ts` | Idempotent discard on close and cleanup, opening-state restoration, save-before-close ordering, fixed 64-block custom chip geometry, malformed wave handling, and listener cleanup |
| `player/player-ui.ts` | `tests/dom-hooks.test.ts` | Player root and element class literals: pm-player, pm-player-spectrum, pm-player-play-btn, pm-player-timeline, pm-player-playhead, pm-player-control-bar, pm-player-viz-container, body append |

**Untested editor modules:** All `editor/core/`, `editor/changes/`,
`editor/prompts/` (except channel-volume-visualizer above), `editor/renderers/`,
`editor/rendering/`, `editor/io/`, `editor/config/`,
`editor/ui/*` subdirectories (except states/surfaces/interactions/barrel), `editor/main.ts`,
`editor/song-custom-samples.ts`.

### player/

| Source | Test file | Scope |
|--------|-----------|-------|
| `player/player-ui.ts`, `player/main.ts`, `shared/player-theme-sync.ts` | `tests/player-ui-styles.test.ts` | Player CSS/DOM contracts and validated live parent-theme synchronization |

### website/

| Source | Test file | Scope |
|--------|-----------|-------|
| 20 migrated HTML pages | `tests/website-html-contract.test.ts` | No inline style=, no inline event handlers, no inline <style> blocks, semantic landmarks (<main>, header/nav/footer) present |

### shared/

| Source | Test file | Scope |
|--------|-----------|-------|
| `shared/pmd-hue.ts` | `tests/pmd-hue.test.ts` | Local clock mapping, arithmetic modulo, storage clamping, signed offsets, and next-minute delay |
| `shared/color-utils.ts` | `tests/shared-utilities.test.ts` | parseCssColor, hslToRgb, oklchToHex, formatColorForTab, hexToRgb, rgbToHex, etc. |
| `shared/pmd/color.ts` | `tests/shared-utilities.test.ts` | safeOklchToRgb, oklchToRgb |
| `shared/color-config.ts` | `tests/shared-utilities.test.ts` | colorConfig (indirect through color utils) |
| `shared/events.ts` | `tests/barrel-exports.test.ts` | events (indirect) |
| `shared/pmd/color.ts` | `tests/shared-utilities.test.ts` | safeOklchToRgb, oklchToRgb |
| `shared/color-config.ts` | `tests/shared-utilities.test.ts` | colorConfig (indirect through color utils) |
| `shared/color-config.ts` | `tests/css-var-contract.test.ts` | fallback defaults cover all requiredThemeCssVars |
| `shared/events.ts` | `tests/barrel-exports.test.ts` | events (indirect) |
| `shared/styles/css-var-contract.ts` | `tests/css-var-contract.test.ts` | known CSS custom properties, source references, theme declarations, ColorConfig fallback coverage for required theme variables, required var set stability, theme registry wiring, per-theme :root presence |
| `shared/styles/inject.ts` | `tests/style-inject.test.ts` | tagged global style injection and same-id deduplication |
| `shared/styles/inject.ts` | `tests/style-slots.test.ts` | hardcoded slot id uniqueness and known-set guard |
| `shared/spectrum.ts` | `tests/theme-raster-redraw.test.ts` | Retained particle geometry, post-reset colors, DPR resize repaint, and idempotent disposal |

## Test structure: every file

```
// <filename>.test.ts
//
// Purpose: <one-line intent>
//
// This module:
// - <verb-led scope item>

import { describe, test, expect } from "bun:test";
// imports from source modules: prefer direct paths over barrels for unit tests
// use barrel imports only for barrel-contract tests (tests/barrel-exports.test.ts)

describe("<group name>", () => {
  test("<does what>", () => {
    expect(actual).toBe(expected);  // concrete value, not "is defined"
  });
});
```

### Assertion rules

- Every `test()` must contain at least one `expect()` that would fail if
  the code under test has a real bug. No bare "didn't crash" tests.
- No `toBeDefined()` or `toBeTruthy()` — use `typeof`, `.length`, or
  concrete value comparison instead.
- After a bare `not.toThrow()`, add a follow-up state assertion that
  verifies the operation produced correct output.
- No `toBe(true)` / `toBe(false)` — use `toBeTrue()` / `toBeFalse()`.
- Property-based invariants over magic constants where possible
  (monotonic sequence, round-trip idempotence, range bounds).

### Import conventions

- Unit tests: import directly from the source file
  (`../synth/synth-math`). Avoid barrel paths for unit tests.
- Barrel contract tests: import from the barrel (`../synth`).
  These go in `tests/barrel-exports.test.ts` only.
- Shared helpers: import from `./test-helpers`.

### When to add a test

- Adding a new source module: add a test file in `tests/` following
  the naming convention `<module-name>.test.ts`.
- Fixing a bug: add a regression test that would have caught the bug
  before fixing.
- Refactoring: verify existing tests pass before the change. If no
  tests exist, add a round-trip test for the refactored path.
- Modifying an untested module (unmarked in the table above): add
  coverage as part of the change — one test per public function at minimum.

### Running tests

```
bun test                     # all tests
bun test --filter "getLFO"   # run tests matching "getLFO"
```

Always run `bun test && bun run typecheck:all` before committing.

## Adding a new test file

1. Create `tests/<module-name>.test.ts`
2. Add the Purpose header (see structure section above)
3. Add describe/test blocks matching the source module's exports
4. Import from `./test-helpers` for Song/Instrument factories
5. Update `tests/context.md` with the new file entry
6. Add a row to this file's cross-reference table
