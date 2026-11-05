// fm6.ts
//
// Purpose: 6-operator FM synthesis plugin — bridges from socket InstrumentModule
//
// This module:
// - Bridges fm6Module as a SynthPlugin for backward compat
// - Preserves algorithm-dependent compiled function caching

import type { Instrument } from "../instruments";
import fm6Module from "../modules/fm6/module";
import { registerModuleAsPlugin } from "../socket/bridge";
import { Config, InstrumentType } from "../synth-config";
import { buildFm6Source } from "../synthesis/fm6";
import type { PluginHost } from "./host";

const cache: Map<string, Function> = new Map();

function getSynthFunction(instrument: Instrument, synth: PluginHost): Function {
	const fingerprint: string = `${instrument.customAlgorithm.name}_${instrument.customFeedbackType.name}`;
	if (!cache.has(fingerprint)) {
		const source: string = buildFm6Source(instrument);
		cache.set(fingerprint, new Function("Config", "Synth", source)(Config, synth));
	}
	return cache.get(fingerprint)!;
}

registerModuleAsPlugin(fm6Module, InstrumentType.fm6op, ["fm", "fm6"], {
	getSynthFunction,
	initialize: (instrument: Instrument) => {
		instrument.chord = 3;
		instrument.algorithm6Op = 1;
		instrument.feedbackType6Op = 1;
		instrument.customAlgorithm.fromPreset(1);
		instrument.feedbackAmplitude = 0;
		for (let i = 0; i < instrument.operators.length; i++) {
			instrument.operators[i].reset(i);
		}
	},
});
