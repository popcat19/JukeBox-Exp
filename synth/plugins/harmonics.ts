// harmonics.ts
//
// Purpose: Harmonics synthesis plugin — bridges from socket InstrumentModule
//
// This module:
// - Bridges harmonicsModule as a SynthPlugin for backward compat
// - Preserves per-unison-voice function caching

import { InstrumentState } from "../instrument-state";
import type { Instrument } from "../instruments";
import harmonicsModule from "../modules/harmonics/module";
import { registerModuleAsPlugin } from "../socket/bridge";
import { Config, InstrumentType } from "../synth-config";
import { buildHarmonicsSource } from "../synthesis/harmonics";
import type { Tone } from "../tone";
import { getPluginHost, type PluginHost, PluginHostInstance } from "./host";

const functionCache: Function[] = [];

function harmonicsSynth(
	synth: PluginHostInstance,
	bufferIndex: number,
	roundedSamplesPerTick: number,
	tone: Tone,
	instrumentState: InstrumentState,
): void {
	const voiceCount: number = Math.max(2, instrumentState.unisonVoices);
	let fn: Function = functionCache[instrumentState.unisonVoices];
	if (fn === undefined) {
		const source: string = buildHarmonicsSource(voiceCount);
		fn = new Function("Config", "Synth", source)(Config, getPluginHost());
		functionCache[instrumentState.unisonVoices] = fn;
	}
	fn(synth, bufferIndex, roundedSamplesPerTick, tone, instrumentState);
}

registerModuleAsPlugin(harmonicsModule, InstrumentType.harmonics, ["harmonics"], {
	getSynthFunction: (_instrument: Instrument, _synth: PluginHost) => harmonicsSynth,
	initialize: (instrument: Instrument) => {
		instrument.chord = Config.chords.dictionary.simultaneous.index;
		instrument.harmonicsWave.reset();
	},
});
