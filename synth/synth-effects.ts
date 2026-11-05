// synth-effects.ts
//
// Purpose: Effects processing dispatch — determines which effects are active
// and invokes the cached generated effects function
//
// This module:
// - Checks instrumentState effect flags (distortion, bitcrusher, compressor, comb flanger, EQ, panning, etc.)
// - Builds a bitmask signature for cache lookup
// - Delegates to getEffectsSynthFunction which returns a cached compiled function

import type { InstrumentState } from "./instrument-state";
import { getEffectsSynthFunction } from "./plugins/effects";
import { Synth } from "./synth";
import {
	effectsIncludeBitcrusher,
	effectsIncludeChorus,
	effectsIncludeCombFlanger,
	effectsIncludeCompressor,
	effectsIncludeDistortion,
	effectsIncludeEcho,
	effectsIncludeGranular,
	effectsIncludeInvertWave,
	effectsIncludePanning,
	effectsIncludePhaser,
	effectsIncludeReverb,
	effectsIncludeRingModulation,
} from "./synth-config";

export function effectsSynth(
	synth: Synth,
	outputDataL: Float32Array,
	outputDataR: Float32Array,
	bufferIndex: number,
	runLength: number,
	instrumentState: InstrumentState,
): void {
	const usesDistortion: boolean = effectsIncludeDistortion(instrumentState.effects);
	const usesBitcrusher: boolean = effectsIncludeBitcrusher(instrumentState.effects);
	const usesEqFilter: boolean = instrumentState.eqFilterCount > 0;
	const usesPanning: boolean = effectsIncludePanning(instrumentState.effects);
	const usesChorus: boolean = effectsIncludeChorus(instrumentState.effects);
	const usesEcho: boolean = effectsIncludeEcho(instrumentState.effects);
	const usesReverb: boolean = effectsIncludeReverb(instrumentState.effects);
	const usesGranular: boolean = effectsIncludeGranular(instrumentState.effects);
	const usesRingModulation: boolean = effectsIncludeRingModulation(instrumentState.effects);
	const usesPhaser: boolean = effectsIncludePhaser(instrumentState.effects);
	const usesInvertWave: boolean =
		effectsIncludeInvertWave(instrumentState.effects) && instrumentState.invertWave;
	const usesCompressor: boolean = effectsIncludeCompressor(instrumentState.effects);
	const usesCombFlanger: boolean = effectsIncludeCombFlanger(instrumentState.effects);
	let signature: number = 0;
	if (usesDistortion) signature = signature | 1;
	signature = signature << 1;
	if (usesBitcrusher) signature = signature | 1;
	signature = signature << 1;
	if (usesEqFilter) signature = signature | 1;
	signature = signature << 1;
	if (usesPanning) signature = signature | 1;
	signature = signature << 1;
	if (usesChorus) signature = signature | 1;
	signature = signature << 1;
	if (usesEcho) signature = signature | 1;
	signature = signature << 1;
	if (usesReverb) signature = signature | 1;
	signature = signature << 1;
	if (usesGranular) signature = signature | 1;
	signature = signature << 1;
	if (usesRingModulation) signature = signature | 1;
	signature = signature << 1;
	if (usesPhaser) signature = signature | 1;
	signature = signature << 1;
	if (usesInvertWave) signature = signature | 1;
	signature = signature << 1;
	if (usesCompressor) signature = signature | 1;
	signature = signature << 1;
	if (usesCombFlanger) signature = signature | 1;

	const ef: Function = getEffectsSynthFunction(
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
		signature,
		Synth,
	);

	ef(synth, outputDataL, outputDataR, bufferIndex, runLength, instrumentState);
}
