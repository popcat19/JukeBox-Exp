// utils.ts
//
// Purpose: Pure utility functions with no dependency on the Config class
//
// This module:
// - Data structure helpers (toNameMap, rawChipToIntegrated)
// - Wave math (performIntegral, performIntegralOld)
// - Effect bitmask checks (hasEffect, 18+ effect helpers)

/*!
Copyright (c) 2012-2022 John Nesky and contributing authors

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
of the Software, and to permit persons to whom the Software is furnished to do
so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

import { EffectType } from "./enums";
import type { BeepBoxOption, ChipWave, Dictionary, DictionaryArray } from "./types";

export function performIntegral(wave: { length: number; [index: number]: number }): Float32Array {
	// Perform the integral on the wave. The synth function will perform the derivative to get the original wave back but with antialiasing.
	let cumulative: number = 0.0;
	const newWave: Float32Array = new Float32Array(wave.length);
	for (let i: number = 0; i < wave.length; i++) {
		newWave[i] = cumulative;
		cumulative += wave[i];
	}

	return newWave;
}

export function centerWave(wave: Array<number>): Float32Array {
	let sum: number = 0.0;
	for (let i: number = 0; i < wave.length; i++) sum += wave[i];
	const average: number = sum / wave.length;
	for (let i: number = 0; i < wave.length; i++) wave[i] -= average;
	performIntegral(wave);
	// Duplicate first sample at end for easier interpolation.
	wave.push(0);
	return new Float32Array(wave);
}

export function centerAndNormalizeWave(wave: Array<number>): Float32Array {
	let magn: number = 0.0;

	centerWave(wave);

	// Going to length-1 because an extra 0 sample is added on the end as part of centerWave, which shouldn't impact magnitude calculation.
	for (let i: number = 0; i < wave.length - 1; i++) {
		magn += Math.abs(wave[i]);
	}
	const magnAvg: number = magn / (wave.length - 1);

	for (let i: number = 0; i < wave.length - 1; i++) {
		wave[i] = wave[i] / magnAvg;
	}

	return new Float32Array(wave);
}

export function performIntegralOld(wave: { length: number; [index: number]: number }): void {
	// Old ver used in harmonics/picked string instruments, manipulates wave in place.
	let cumulative: number = 0.0;
	for (let i: number = 0; i < wave.length; i++) {
		const temp = wave[i];
		wave[i] = cumulative;
		cumulative += temp;
	}
}

// Pardon the messy type casting. This allows accessing array members by numerical index or string name.
export function toNameMap<T extends BeepBoxOption>(
	array: Array<Pick<T, Exclude<keyof T, "index">>>,
): DictionaryArray<T> {
	const dictionary: Dictionary<T> = {};
	for (let i: number = 0; i < array.length; i++) {
		const value: any = array[i];
		value.index = i;
		dictionary[value.name] = <T>value;
	}
	const result: DictionaryArray<T> = <DictionaryArray<T>>(<any>array);
	result.dictionary = dictionary;
	return result;
}

export function rawChipToIntegrated(raw: DictionaryArray<ChipWave>): DictionaryArray<ChipWave> {
	const newArray: Array<ChipWave> = new Array<ChipWave>(raw.length);
	const dictionary: Dictionary<ChipWave> = {};
	for (let i: number = 0; i < newArray.length; i++) {
		newArray[i] = Object.assign([], raw[i]);
		const value: any = newArray[i];
		value.index = i;
		dictionary[value.name] = <ChipWave>value;
	}
	for (const key in dictionary) {
		dictionary[key].samples = performIntegral(dictionary[key].samples);
	}
	const result: DictionaryArray<ChipWave> = <DictionaryArray<ChipWave>>(<any>newArray);
	result.dictionary = dictionary;
	return result;
}

export function hasEffect(effects: number, effectType: EffectType): boolean {
	return (effects & (1 << effectType)) !== 0;
}

export function effectsIncludeTransition(effects: number): boolean {
	return hasEffect(effects, EffectType.transition);
}
export function effectsIncludeChord(effects: number): boolean {
	return hasEffect(effects, EffectType.chord);
}
export function effectsIncludePitchShift(effects: number): boolean {
	return hasEffect(effects, EffectType.pitchShift);
}
export function effectsIncludeDetune(effects: number): boolean {
	return hasEffect(effects, EffectType.detune);
}
export function effectsIncludeVibrato(effects: number): boolean {
	return hasEffect(effects, EffectType.vibrato);
}
export function effectsIncludeNoteFilter(effects: number): boolean {
	return hasEffect(effects, EffectType.noteFilter);
}
export function effectsIncludeDistortion(effects: number): boolean {
	return hasEffect(effects, EffectType.distortion);
}
export function effectsIncludeBitcrusher(effects: number): boolean {
	return hasEffect(effects, EffectType.bitcrusher);
}
export function effectsIncludePanning(effects: number): boolean {
	return hasEffect(effects, EffectType.panning);
}
export function effectsIncludeChorus(effects: number): boolean {
	return hasEffect(effects, EffectType.chorus);
}
export function effectsIncludeEcho(effects: number): boolean {
	return hasEffect(effects, EffectType.echo);
}
export function effectsIncludeReverb(effects: number): boolean {
	return hasEffect(effects, EffectType.reverb);
}
export function effectsIncludeRingModulation(effects: number): boolean {
	return hasEffect(effects, EffectType.ringModulation);
}
export function effectsIncludeGranular(effects: number): boolean {
	return hasEffect(effects, EffectType.granular);
}
export function effectsIncludeNoteRange(effects: number): boolean {
	return hasEffect(effects, EffectType.noteRange);
}
export function effectsIncludeOctaveShift(effects: number): boolean {
	return hasEffect(effects, EffectType.octaveShift);
}
export function effectsIncludePhaser(effects: number): boolean {
	return hasEffect(effects, EffectType.phaser);
}
export function effectsIncludeInvertWave(effects: number): boolean {
	return hasEffect(effects, EffectType.invertWave);
}
export function effectsIncludeCompressor(effects: number): boolean {
	return hasEffect(effects, EffectType.compressor);
}
