# shared/ context

Purpose: Shared kernel — code no single domain owns but multiple domains use.

## Root Files

- `color-config.ts`, Manages color theme definitions and CSS variable resolution for the editor
- `color-utils.ts`, Pure color conversion utilities (hex ↔ HSL ↔ OKLCH) with alpha, gamut clamping, and hex parsing
- `events.ts`, Provides a simple publish-subscribe event system for cross-module communication
- `fft.ts`, Implements real-valued Fourier transform and frequency analysis utilities
- `pmd-adapter.ts`, Maps PMD-generated Base16 palettes to JukeBox-Exp CSS custom properties
- `pmd-hue.ts`, Defines pure local-clock hue, modulo, signed-offset, and minute-boundary policies
- `player-theme-sync.ts`, Defines validated same-origin messages for live embedded player theme updates
- `spectrum.ts`, Renders real-time audio as a smooth bezier-curve spectrum analyzer
- `timeline-surface.ts`, Defines the minimal element and synth fields needed to render a song timeline and playhead

## Subdirectories

- `pmd/`, PMD (Palette Meta-Designer) color system utilities
- `themes/`, 58 color theme definitions as CSS variable maps
- `styles/`, Shared design token stylesheets eliminated duplicate CSS between editor and player
