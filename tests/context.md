# tests/ context

Purpose: bun:test test files covering editor, synth, and shared modules.

## Files

- `test-helpers.ts`, Shared test fixtures (Song factories, assertion helpers)
- `TESTING.md`, Conventions doc + source-to-test cross-reference table
- `application-router.test.ts`, Behavioral and structural tests for all-scope Navigator routing, funnel convergence, immutable context, and ordered import delivery
- `command-palette.test.ts`, Behavioral tests for rendering, state-preserving Escape, prompt Escape order, slash guards, and menu/key route convergence
- `command-registry.test.ts`, Behavioral tests for shared command metadata, fuzzy ranking, routing, and one-based bar conversion
- `barrel-exports.test.ts`, Barrel re-export contract tests for synth, editor/ui, shared
- `interactions-behavior.test.ts`, Behavioral tests for editor/ui/interactions.ts using a hand-rolled DOM mock (classList adds/removes, style custom props, dataset writes, native disabled property writes, setDisabled helper, tagged style injection dedupe)
- `input-wheel-support.test.ts`, Behavioral numeric wheel tests for preference, bounds, validity, passive registration, exact events, and page-scroll isolation
- `ui-states.test.ts`, Contract tests for the PMD state/surface/interaction token layer (states.ts, surfaces.ts, interactions.ts) plus source-grep proofs for refactored buttons and loop-button migrations
- `frame-scheduler.test.ts`, Unit tests for FrameScheduler callbacks, flush dedupe, and ChangeNotifier frame flush
- `debug-tools.test.ts`, Tests for __jukebox__ debug utilities
- `compressor.test.ts`, Unit and round-trip tests for the compressor effect (gain reduction, sync ducking, base64 and JSON serialization)
- `dsp-utils.test.ts`, Unit tests for pure DSP utility functions (applyFilters, sanitizeDelayLine, findRandomZeroCrossing)
- `filtering.test.ts`, Unit tests for digital filter coefficient computation and frequency response
- `input-inventory.test.ts`, Unit tests for input binding inventory and concern modules
- `navigator-contracts.test.ts`, Behavioral tests for canonical identity, native extraction, attached theme preview/cancellation, detached theme sync, shell layout, cleanup, ownership, and host transfer
- `navigator-route-hints.test.ts`, Pure base-26 route codes plus hidden, attached, detached, filtering, activation, accessibility, and cleanup behavior
- `import-prompt-external-delivery.test.ts`, ImportPrompt external file validation, transport restoration, completion ordering, and operation-generation races
- `instrument-import-completion.test.ts`, Instrument import completion through bound Navigator close authority
- `visual-prompt-dirty-rollback.test.ts`, Visual prompt dirty denial and confirmed preview rollback
- `navigator-dock.test.ts`, Shared PromptDock edge snap, padding, undock, cleanup, mobile fallback, and prompt regression behavior
- `stress-pane-lifecycle.test.ts`, Behavioral fake-frame lifecycle coverage for Navigator stress panes and LimiterPrompt cleanup
- `notes.test.ts`, Unit tests for note and pattern data structures
- `note-mutation-fuzz.test.ts`, Randomized invariant checks for note pin mutations
- `pattern-editor-contract.test.ts`, Structural contract tests for pattern-editor.ts rendering invariants (stale canvas path, SVG/canvas y-center alignment)
- `loop-editor-contract.test.ts`, Structural contract tests for loop-editor.ts UI invariants (CSS class for disabled state, no inline opacity conflict) and song-editor.ts focus-steal listeners (mouseup blur buttons, keydown intercept Space on button/select)
- `limiter-prompt.test.ts`, Behavioral, accessibility, transaction, lifecycle, and responsive CSS contracts for LimiterPrompt
- `pmd-hue.test.ts`, Pure hue migration plus page-global scheduling, wake events, atomic restore, forced-dark persistence, and cleanup
- `theme-raster-redraw.test.ts`, Behavioral retained spectrum resize/recolor plus weak editor and prompt raster lifecycle coverage
- `import-boundaries.test.ts`, Contract tests for cross-context import rules and import-cycle ratchet
- `lint-baseline.test.ts`, Contract tests for exact lint warning fingerprint drift detection
- `song-document-contract.test.ts`, Structural contracts for position persistence during record, redo-preserving navigation, and history-state application
- `song-data-recovery.test.ts`, Corruption repair, atomic replacement, defensive recovery parsing, and duplicate history event coverage
- `song-document-integration.test.ts`, Integration tests for Sprint 1 refactorings and song serialization
- `plugin-round-trip.test.ts`, Per-plugin-type instrument round-trip encode/decode tests
- `song-round-trip.test.ts`, Integration tests for song serialization round-trip encode/decode
- `song-serialization.test.ts`, Unit tests for song serialization API and failure resilience
- `synthesis.test.ts`, Unit tests for synthesis source string builders (chip, drum, effects, FM, FM6, harmonics, noise, picked-string, pulse, spectrum, supersaw)
- `synth-contract.test.ts`, Systematic contract tests for extraction safety: generated-source drift (Category A), host interface snapshot rot (Category B), cross-field contamination (Category C), barrel export erosion (Category D)
- `deque.test.ts`, Unit tests for Deque<T> — FIFO/LIFO order, capacity expansion, index get/set/remove, empty errors
- `fft.test.ts`, Unit tests for FFT module — scaleElementsByFactor, discreteFourierTransform, fastFourierTransform, forward/inverse real FFT round-trip
- `tone.test.ts`, Unit tests for Tone — constructor, reset, state defaults
- `channels.test.ts`, Unit tests for Channel and ChannelState — defaults, arrays, audio buffer sizing
- `waves.test.ts`, Unit tests for waves module — SpectrumWave constructor/reset/hash, SpectrumWaveState caching
- `envelope-computer.test.ts`, Unit tests for EnvelopeComputer — constructor, reset, computeEnvelope static (all envelope types), computePitchEnvelope, getLowpassCutoffDecayVolumeCompensation
- `picked-string.test.ts`, Unit tests for PickedString — constructor, reset, coefficient defaults
- `instrument-state.test.ts`, Unit tests for InstrumentState — constructor, tone pools, flag defaults, type/unison/effect defaults
- `mod-state.test.ts`, Unit tests for SynthModState — init, setModValue/getModValue, isModActive/isAnyModActive, unset, forceHoldMods, advanceNextToValues, initModFilters
- `song-utilities.test.ts`, Unit tests for song-utilities — envelopeFromLegacyIndex, isProperUrl, restoreChipWaveListToDefault, clearSamples
- `synth-shared.test.ts`, Unit tests for synth-shared — instrumentVolumeToVolumeMult edge cases (zero, max, monotonic), noteSizeToVolumeMult edge cases (zero, max, monotonic)
- `post-processing.test.ts`, Unit tests for PostProcessingState — sanitizeFilters overflow reset, epsilon clamping, empty array, normal value preservation, large negative values
- `filter-control-point.test.ts`, Unit tests for FilterControlPoint — Hz conversion roundtrip, linear gain, volume compensation for low-pass/high-pass/peak, unknown type error
- `synth-effects.test.ts`, Unit tests for synth-effects — module import and export shape
- `enums.test.ts`, Unit tests for synth config enumeration type constants
- `instrument-registry.test.ts`, Unit tests for dynamic instrument type registration
- `synth-math-utils.test.ts`, Unit tests for Config-dependent utility functions (getPulseWidthRatio, getDrumWave, getArpeggioPitchIndex, calculateRingModHertz)
- `envelope-settings.test.ts`, Unit tests for EnvelopeSettings — serialization and tremolo2→LFO migration
- `filter-settings.test.ts`, Unit tests for FilterSettings — control points, morph, lerp
- `song-serialization-shared.test.ts`, Unit tests for shared serialization constants and version ranges
- `custom-algorithm.test.ts`, Unit tests for CustomAlgorithm — FM operator routing
- `custom-feedback.test.ts`, Unit tests for CustomFeedBack — FM feedback routing
- `css-var-contract.test.ts`, Contract tests for CSS custom property registration, theme variable declarations, ColorConfig fallback coverage, required var set stability, theme registry wiring, per-theme :root presence
- `style-inject.test.ts`, Behavioral tests for tagged global style injection deduplication
- `style-slots.test.ts`, Guard that hardcoded injectGlobalStyles slot ids stay unique and accounted for
- `dom-hooks.test.ts`, Static source-read guards for editor, prompt, and player DOM hook literals (mount, shell, grid layout, lifecycle, popout, PMD role, scrollbars, player root and element classes)
- `player-ui-styles.test.ts`, Contract tests for player CSS builder and player UI body-root append contract
- `prompt-shell-contract.test.ts`, Structural contracts for harmonics, spectrum, and custom filter prompt titlebars and button rows
- `prompt-drag.test.ts`, Behavioral tests for whole-surface prompt dragging, exclusions, clamping, cleanup, and PromptManager wiring
- `svg-editor-rect-contract.test.ts`, Regression contracts for fresh graph editor geometry on press and cache invalidation on release
- `svg-prompt-transaction-contract.test.ts`, Transaction contracts for discard restoration, save-before-close ordering, fixed 64-block custom chip geometry, malformed wave handling, and listener cleanup
- `editor-selector-scope.test.ts`, Selector scoping guard: editor CSS class selectors must root under .beepboxEditor or be baseline-allowed page-level exceptions
- `website-html-contract.test.ts`, Guard that 20 migrated website HTML pages keep semantic landmarks and reject inline style=, inline event handlers, and inline <style> blocks

## Source-to-test cross-reference

See `TESTING.md` for the full cross-reference table mapping source modules
to their test files, including modules with no test coverage.
