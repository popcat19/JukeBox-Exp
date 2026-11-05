// effects.ts
//
// Purpose: Post-processing effects — NOT registered as SynthPlugin
//
// This module:
// - Wraps effects cache + buildEffectsSource
// - Exported directly for use in synth.ts channel-level loop
// - Different calling convention than per-instrument plugins

import { Config } from "../synth-config";
import { buildEffectsSource } from "../synthesis/effects";
import type { PluginHost } from "./host";

const cache: Function[] = Array(1 << 13).fill(undefined);

export function getEffectsSynthFunction(
	usesDistortion: boolean,
	usesBitcrusher: boolean,
	usesEqFilter: boolean,
	usesPanning: boolean,
	usesChorus: boolean,
	usesEcho: boolean,
	usesReverb: boolean,
	usesGranular: boolean,
	usesRingModulation: boolean,
	usesPhaser: boolean,
	usesInvertWave: boolean,
	usesCompressor: boolean,
	usesCombFlanger: boolean,
	signature: number,
	synth: PluginHost,
): Function {
	let fn: Function = cache[signature];
	if (fn === undefined) {
		const source: string = buildEffectsSource(
			usesDistortion,
			usesBitcrusher,
			usesEqFilter,
			usesPanning,
			usesChorus,
			usesEcho,
			usesReverb,
			usesGranular,
			usesRingModulation,
			usesPhaser,
			usesInvertWave,
			usesCompressor,
			usesCombFlanger,
		);
		fn = new Function("Config", "Synth", source)(Config, synth);
		cache[signature] = fn;
	}
	return fn;
}
