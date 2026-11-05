// opl3.ts
//
// Purpose: OPL3 synthesis plugin — bridges from socket InstrumentModule
//
// This module:
// - Bridges opl3Module as a SynthPlugin for backward compat
// - Preserves algorithm-dependent compiled function caching

import type { Instrument } from "../instruments";
import opl3Module from "../modules/opl3/module";
import { registerModuleAsPlugin } from "../socket/bridge";
import { Config, InstrumentType } from "../synth-config";
import { buildOpl3Source } from "../synthesis/opl3";
import type { PluginHost } from "./host";

const cache: Map<string, Function> = new Map();

function getSynthFunction(instrument: Instrument, synth: PluginHost): Function {
	const fingerprint: string = `${instrument.opl3Algorithm ?? 0}_${instrument.feedbackAmplitude}`;
	if (!cache.has(fingerprint)) {
		const source: string = buildOpl3Source(instrument);
		cache.set(fingerprint, new Function("Config", "Synth", source)(Config, synth));
	}
	return cache.get(fingerprint)!;
}

registerModuleAsPlugin(opl3Module, InstrumentType.opl3, ["fm", "opl3"], {
	getSynthFunction,
	initialize: (instrument: Instrument) => {
		instrument.chord = 3;
		instrument.opl3Algorithm = 0;
		instrument.feedbackAmplitude = 0;
		for (let i = 0; i < 4; i++) {
			instrument.operators[i].reset(i);
		}
	},
});
