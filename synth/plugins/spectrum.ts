// spectrum.ts
//
// Purpose: Spectrum synthesis plugin — bridges from socket InstrumentModule
//
// This module:
// - Bridges spectrumModule as a SynthPlugin for backward compat
// - Preserves per-unison-voice function caching

import { InstrumentState } from "../instrument-state";
import type { Instrument } from "../instruments";
import spectrumModule from "../modules/spectrum/module";
import { registerModuleAsPlugin } from "../socket/bridge";
import { Config, InstrumentType } from "../synth-config";
import { buildSpectrumSource } from "../synthesis/spectrum";
import type { Tone } from "../tone";
import { getPluginHost, type PluginHost, PluginHostInstance } from "./host";

const functionCache: Function[] = [];

function spectrumSynth(
	synth: PluginHostInstance,
	bufferIndex: number,
	runLength: number,
	tone: Tone,
	instrumentState: InstrumentState,
): void {
	const voiceCount: number = Math.max(2, instrumentState.unisonVoices);
	let fn: Function = functionCache[instrumentState.unisonVoices];
	if (fn === undefined) {
		const source: string = buildSpectrumSource(voiceCount);
		fn = new Function("Config", "Synth", source)(Config, getPluginHost());
		functionCache[instrumentState.unisonVoices] = fn;
	}
	fn(synth, bufferIndex, runLength, tone, instrumentState);
}

registerModuleAsPlugin(spectrumModule, InstrumentType.spectrum, ["spectrum"], {
	getSynthFunction: (_instrument: Instrument, _synth: PluginHost) => spectrumSynth,
	initialize: (instrument: Instrument) => {
		instrument.chord = Config.chords.dictionary.simultaneous.index;
		instrument.spectrumWave.reset(true);
	},
});
