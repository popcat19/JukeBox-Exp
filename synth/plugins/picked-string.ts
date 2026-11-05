// picked-string.ts
//
// Purpose: Picked string synthesis plugin — bridges from socket InstrumentModule
//
// This module:
// - Bridges pickedStringModule as a SynthPlugin for backward compat
// - Preserves per-unison-voice function caching

import { InstrumentState } from "../instrument-state";
import type { Instrument } from "../instruments";
import pickedStringModule from "../modules/picked-string/module";
import { registerModuleAsPlugin } from "../socket/bridge";
import { Config, InstrumentType } from "../synth-config";
import { buildPickedStringSource } from "../synthesis/picked-string";
import type { Tone } from "../tone";
import { getPluginHost, type PluginHost, PluginHostInstance } from "./host";

const functionCache: Function[] = Array(3).fill(undefined);

function pickedStringSynth(
	synth: PluginHostInstance,
	bufferIndex: number,
	roundedSamplesPerTick: number,
	tone: Tone,
	instrumentState: InstrumentState,
): void {
	const voiceCount: number = instrumentState.unisonVoices;
	let fn: Function = functionCache[voiceCount];
	if (fn === undefined) {
		const source: string = buildPickedStringSource(voiceCount);
		fn = new Function("Config", "Synth", source)(Config, getPluginHost());
		functionCache[voiceCount] = fn;
	}
	fn(synth, bufferIndex, roundedSamplesPerTick, tone, instrumentState);
}

registerModuleAsPlugin(
	pickedStringModule,
	InstrumentType.pickedString,
	["harmonics", "stringSustain"],
	{
		getSynthFunction: (_instrument: Instrument, _synth: PluginHost) => pickedStringSynth,
		initialize: (instrument: Instrument) => {
			instrument.chord = Config.chords.dictionary.strum.index;
			instrument.harmonicsWave.reset();
		},
	},
);
