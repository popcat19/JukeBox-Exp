// mod.ts
//
// Purpose: Modulator channel plugin — bridges from socket InstrumentModule
//
// This module:
// - Bridges modModule as a SynthPlugin for backward compat
// - Uses synth.runModSynth directly (no DSP code generation)

import type { Instrument } from "../instruments";
import modModule from "../modules/mod/module";
import { registerModuleAsPlugin } from "../socket/bridge";
import { Config, InstrumentType } from "../synth-config";
import type { PluginHost } from "./host";

registerModuleAsPlugin(modModule, InstrumentType.mod, [], {
	getSynthFunction: (_instrument: Instrument, synth: PluginHost) => synth.runModSynth,
	initialize: (instrument: Instrument) => {
		instrument.transition = 0;
		instrument.vibrato = 0;
		instrument.interval = 0;
		instrument.effects = 0;
		instrument.chord = 0;
		instrument.modChannels = [];
		instrument.modInstruments = [];
		instrument.modulators = [];
		for (let mod = 0; mod < Config.modCount; mod++) {
			instrument.modChannels.push(-2);
			instrument.modInstruments.push(0);
			instrument.modulators.push(Config.modulators.dictionary.none.index);
			instrument.invalidModulators[mod] = false;
			instrument.modFilterTypes[mod] = 0;
			instrument.modEnvelopeNumbers[mod] = 0;
		}
	},
});
