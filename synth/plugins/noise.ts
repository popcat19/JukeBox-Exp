// noise.ts
//
// Purpose: Noise synthesis plugin — bridges from socket InstrumentModule
//
// This module:
// - Bridges noiseModule as a SynthPlugin for backward compat
// - Preserves per-unison-voice function caching

import { InstrumentState } from "../instrument-state";
import type { Instrument } from "../instruments";
import noiseModule from "../modules/noise/module";
import { registerModuleAsPlugin } from "../socket/bridge";
import { Config, InstrumentType } from "../synth-config";
import { buildNoiseSource } from "../synthesis/noise";
import type { Tone } from "../tone";
import { getPluginHost, type PluginHost, PluginHostInstance } from "./host";

const functionCache: Function[] = [];

function noiseSynth(
	synth: PluginHostInstance,
	bufferIndex: number,
	runLength: number,
	tone: Tone,
	instrumentState: InstrumentState,
): void {
	const voiceCount: number = Math.max(2, instrumentState.unisonVoices);
	let fn: Function = functionCache[instrumentState.unisonVoices];
	if (fn === undefined) {
		const source: string = buildNoiseSource(voiceCount);
		fn = new Function("Config", "Synth", source)(Config, getPluginHost());
		functionCache[instrumentState.unisonVoices] = fn;
	}
	fn(synth, bufferIndex, runLength, tone, instrumentState);
}

registerModuleAsPlugin(noiseModule, InstrumentType.noise, ["noiseSelect"], {
	getSynthFunction: (_instrument: Instrument, _synth: PluginHost) => noiseSynth,
	initialize: (instrument: Instrument) => {
		instrument.chipNoise = 1;
		instrument.chord = Config.chords.dictionary.arpeggio.index;
	},
});
