# synth/plugins context

- `index.ts`, Plugin registry barrel, side-effect imports register all plugins
- `registry.ts`, Plugin registry mapping InstrumentType → SynthPlugin
- `interfaces.ts`, Plugin interface types for the synth plugin registry
- `host.ts`, Holder for the PluginHost injected by synth.ts at module load
- `fm.ts`, FM synthesis plugin wrapping buildFmSource + dynamic compilation
- `fm6.ts`, 6-operator FM synthesis plugin
- `chip.ts`, Chip wave synthesis plugin (handles normal, loopable, and custom chip wave)
- `pulse.ts`, Pulse width modulation synthesis plugin
- `supersaw.ts`, Supersaw synthesis plugin
- `harmonics.ts`, Harmonics synthesis plugin, wraps private static via bridge
- `noise.ts`, Noise synthesis plugin
- `spectrum.ts`, Spectrum synthesis plugin
- `picked-string.ts`, Picked string synthesis plugin
- `drumset.ts`, Drumset synthesis plugin
- `mod.ts`, Modulator channel synthesis plugin
- `effects.ts`, Post-processing effects, NOT registered as SynthPlugin
