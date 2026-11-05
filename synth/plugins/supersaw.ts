// supersaw.ts
//
// Purpose: Supersaw plugin registration via InstrumentModule bridge
//
// This module:
// - Imports the InstrumentModule from synth/modules/supersaw/
// - Registers it via the socket bridge to both old and new registries
// - Keeps cached function compilation for performance

import type { Instrument } from "../instruments";
import supersawModule from "../modules/supersaw/module";
import { registerModuleAsPlugin } from "../socket/bridge";
import { Config, InstrumentType } from "../synth-config";
import { buildSupersawSource } from "../synthesis/supersaw";
import { getPluginHost, type PluginHost, PluginHostInstance } from "./host";

const functionCache: Function[] = Array(1).fill(undefined);

function supersawSynth(
	synth: PluginHostInstance,
	bufferIndex: number,
	runLength: number,
	tone: any,
	instrumentState: any,
): void {
	const voiceCount: number = Config.supersawVoiceCount | 0;
	let fn: Function = functionCache[0];
	if (fn === undefined) {
		const source: string = buildSupersawSource(voiceCount);
		fn = new Function("Config", "Synth", source)(Config, getPluginHost());
		functionCache[0] = fn;
	}
	fn(synth, bufferIndex, runLength, tone, instrumentState);
}

function bridgedGetSynthFunction(_instrument: Instrument, _synth: PluginHost): Function {
	return supersawSynth;
}

// Register via bridge: new socket registry + old plugin registry
registerModuleAsPlugin(supersawModule, InstrumentType.supersaw, ["supersaw", "pulseWidth"], {
	getSynthFunction: bridgedGetSynthFunction,
});
