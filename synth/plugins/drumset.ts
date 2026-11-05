// drumset.ts
//
// Purpose: Drumset synthesis plugin — bridges from socket InstrumentModule
//
// This module:
// - Bridges drumsetModule as a SynthPlugin for backward compat
// - Preserves per-unison-voice function caching with InstrumentState arg

import { InstrumentState } from "../instrument-state";
import type { Instrument } from "../instruments";
import drumsetModule from "../modules/drumset/module";
import { registerModuleAsPlugin } from "../socket/bridge";
import { Config, InstrumentType } from "../synth-config";
import { buildDrumSource } from "../synthesis/drum";
import type { Tone } from "../tone";
import { SpectrumWave } from "../waves";
import { getPluginHost, type PluginHost, PluginHostInstance } from "./host";

const functionCache: Function[] = [];

function drumsetSynth(
	synth: PluginHostInstance,
	bufferIndex: number,
	runLength: number,
	tone: Tone,
	instrumentState: InstrumentState,
): void {
	const voiceCount: number = Math.max(2, instrumentState.unisonVoices);
	let fn: Function = functionCache[instrumentState.unisonVoices];
	if (fn === undefined) {
		const source: string = buildDrumSource(voiceCount);
		fn = new Function("Config", "Synth", "InstrumentState", source)(
			Config,
			getPluginHost(),
			InstrumentState,
		);
		functionCache[instrumentState.unisonVoices] = fn;
	}
	fn(synth, bufferIndex, runLength, tone, instrumentState);
}

registerModuleAsPlugin(drumsetModule, InstrumentType.drumset, ["drumset"], {
	getSynthFunction: (_instrument: Instrument, _synth: PluginHost) => drumsetSynth,
	initialize: (instrument: Instrument) => {
		instrument.chord = Config.chords.dictionary.simultaneous.index;
		for (let i = 0; i < Config.drumCount; i++) {
			instrument.drumsetEnvelopes[i] = Config.envelopes.dictionary["twang 2"].index;
			if (instrument.drumsetSpectrumWaves[i] === undefined) {
				instrument.drumsetSpectrumWaves[i] = new SpectrumWave(true);
			}
			instrument.drumsetSpectrumWaves[i].reset(true);
		}
	},
});
