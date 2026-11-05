// host.ts
//
// Purpose: Holder for the PluginHost injected by synth.ts at module load
//
// This module:
// - Defines PluginHost, the narrow view of Synth that plugins depend on instead of importing synth.ts
// - Stores the Synth class as a PluginHost so plugins avoid importing synth.ts
// - Throws if a plugin reads the host before synth.ts has registered it

export type PluginHostInstance = object;

export interface PluginHost {
	runModSynth(
		synth: PluginHostInstance,
		bufferIndex: number,
		roundedSamplesPerTick: number,
		tone: any,
		instrument: any,
	): void;
}

let host: PluginHost | undefined;

export function setPluginHost(value: PluginHost): void {
	host = value;
}

export function getPluginHost(): PluginHost {
	if (host === undefined) {
		throw new Error("PluginHost not set; synth.ts must be loaded before plugin synthesis runs");
	}
	return host;
}
