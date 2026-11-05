// chip.ts
//
// Purpose: Chip wave synthesis plugin — bridges from socket InstrumentModule
//
// This module:
// - Bridges chipModule as a SynthPlugin for backward compat
// - Preserves per-unison-voice function caching (normal + loopable)
// - Registers both InstrumentType.chip and InstrumentType.customChipWave

import { InstrumentState } from "../instrument-state";
import type { Instrument } from "../instruments";
import chipModule from "../modules/chip/module";
import customChipWaveModule from "../modules/custom-chip-wave/module";
import { registerModuleAsPlugin } from "../socket/bridge";
import { Config, effectsIncludeDistortion, InstrumentType } from "../synth-config";
import { buildChipSource, buildLoopableChipSource } from "../synthesis/chip";
import type { Tone } from "../tone";
import { getPluginHost, type PluginHost, PluginHostInstance } from "./host";

const chipFunctionCache: Function[] = [];
const loopableChipFunctionCache: Function[] = Array(Config.unisonVoicesMax + 1).fill(undefined);

function chipSynth(
	synth: PluginHostInstance,
	bufferIndex: number,
	roundedSamplesPerTick: number,
	tone: Tone,
	instrumentState: InstrumentState,
): void {
	const voiceCount: number = Math.max(2, instrumentState.unisonVoices);
	let chipFunction: Function = chipFunctionCache[instrumentState.unisonVoices];
	if (chipFunction === undefined) {
		const chipSource: string = buildChipSource(voiceCount);
		chipFunction = new Function("Config", "Synth", "effectsIncludeDistortion", chipSource)(
			Config,
			getPluginHost(),
			effectsIncludeDistortion,
		);
		chipFunctionCache[instrumentState.unisonVoices] = chipFunction;
	}
	chipFunction(synth, bufferIndex, roundedSamplesPerTick, tone, instrumentState);
}

function loopableChipSynth(
	synth: PluginHostInstance,
	bufferIndex: number,
	roundedSamplesPerTick: number,
	tone: Tone,
	instrumentState: InstrumentState,
): void {
	const voiceCount: number = Math.max(2, instrumentState.unisonVoices);
	let chipFunction: Function = loopableChipFunctionCache[instrumentState.unisonVoices];
	if (chipFunction === undefined) {
		const chipSource: string = buildLoopableChipSource(voiceCount);
		chipFunction = new Function("Config", "Synth", "effectsIncludeDistortion", chipSource)(
			Config,
			getPluginHost(),
			effectsIncludeDistortion,
		);
		loopableChipFunctionCache[instrumentState.unisonVoices] = chipFunction;
	}
	chipFunction(synth, bufferIndex, roundedSamplesPerTick, tone, instrumentState);
}

function getSynthFunction(instrument: Instrument, _synth: PluginHost): Function {
	if (instrument.isUsingAdvancedLoopControls) {
		return loopableChipSynth;
	}
	return chipSynth;
}

registerModuleAsPlugin(chipModule, InstrumentType.chip, ["waveSelect", "loopControls"], {
	getSynthFunction,
	initialize: (instrument: Instrument) => {
		instrument.chord = Config.chords.dictionary.arpeggio.index;
	},
});

registerModuleAsPlugin(customChipWaveModule, InstrumentType.customChipWave, ["customWave"], {
	getSynthFunction,
	initialize: (instrument: Instrument) => {
		instrument.chord = Config.chords.dictionary.arpeggio.index;
		instrument.chipWave = 2;
		for (let i = 0; i < 64; i++) {
			instrument.customChipWave[i] = 24 - Math.floor(i * (48 / 64));
		}
	},
});
