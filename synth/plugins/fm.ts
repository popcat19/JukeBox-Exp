// fm.ts
//
// Purpose: FM synthesis plugin — bridges from socket InstrumentModule
//
// This module:
// - Bridges fmModule as a SynthPlugin for backward compat
// - Preserves algorithm-dependent compiled function caching

import type { Instrument } from "../instruments";
import fmModule from "../modules/fm/module";
import { registerModuleAsPlugin } from "../socket/bridge";
import { Config, InstrumentType } from "../synth-config";
import { buildFmSource } from "../synthesis/fm";
import type { PluginHost } from "./host";

const cache: Map<string, Function> = new Map();

function getSynthFunction(instrument: Instrument, synth: PluginHost): Function {
	const fingerprint: string = `${instrument.algorithm}_${instrument.feedbackType}`;
	if (!cache.has(fingerprint)) {
		const source: string = buildFmSource(instrument);
		cache.set(fingerprint, new Function("Config", "Synth", source)(Config, synth));
	}
	return cache.get(fingerprint)!;
}

registerModuleAsPlugin(fmModule, InstrumentType.fm, ["fm"], {
	getSynthFunction,
	initialize: (instrument: Instrument) => {
		instrument.chord = 3;
		instrument.algorithm = 0;
		instrument.feedbackType = 0;
		instrument.feedbackAmplitude = 0;
		for (let i = 0; i < instrument.operators.length; i++) {
			instrument.operators[i].reset(i);
		}
	},
});
