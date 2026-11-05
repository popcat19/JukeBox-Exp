// comb-flanger.test.ts
//
// Purpose: Unit and round-trip tests for the comb/flanger effect
//
// This module:
// - Verifies the feedback comb peaks at the delay periodicity and mix 0 is bit-exact passthrough
// - Verifies LFO depth modulates the delay and parameter mappings stay in range
// - Verifies base64 and JSON round-trips for the new effect
// - Verifies songs built from the pre-existing effect set decode and re-encode byte-identically

import { describe, test, expect } from "bun:test";
import { CombFlangerDsp, combDelayMs, combFeedbackAmount } from "../synth/comb-flanger";
import { buildEffectsSource } from "../synth/synthesis/effects";
import { Config, EffectType } from "../synth/synth-config";
import { buildLegacySongs, legacyGolden } from "./fixtures/legacy-effect-songs";
import { createTestSong } from "./test-helpers";

const sampleRate = 48000;

function impulseResponse(dsp: CombFlangerDsp, length: number): Float32Array {
	const out = new Float32Array(length);
	for (let i = 0; i < length; i++) out[i] = dsp.process(i === 0 ? 1 : 0);
	return out;
}

function lastIndexWhere(values: Float32Array, predicate: (v: number) => boolean): number {
	let last = -1;
	for (let i = 0; i < values.length; i++) if (predicate(values[i])) last = i;
	return last;
}

describe("CombFlangerDsp feedback comb", () => {
	test("impulse response peaks at multiples of the delay period", () => {
		const dsp = new CombFlangerDsp();
		dsp.configure(14, 12, 15, 0, 0, sampleRate);
		const period = dsp.delaySamples;
		const response = impulseResponse(dsp, Math.ceil(period * 6));

		let previousPeak = Infinity;
		let firstPeak = 0;
		for (let k = 1; k <= 4; k++) {
			const expected = k * period;
			let bestIndex = Math.round(expected);
			for (let i = Math.floor(expected) - 1; i <= Math.ceil(expected) + 1; i++) {
				if (Math.abs(response[i]) > Math.abs(response[bestIndex])) bestIndex = i;
			}
			expect(Math.abs(bestIndex - expected)).toBeLessThan(1.01);
			const peak = Math.abs(response[bestIndex]);
			expect(peak).toBeGreaterThan(0);
			expect(peak).toBeLessThan(previousPeak);
			if (k === 1) firstPeak = peak;
			previousPeak = peak;
		}

		for (let i = 1; i < response.length; i++) {
			const distance = Math.abs(i / period - Math.round(i / period)) * period;
			if (distance > 3) expect(Math.abs(response[i])).toBeLessThan(firstPeak * 0.05);
		}
	});

	test("integer delay places exact echoes decaying by the feedback factor", () => {
		const dsp = new CombFlangerDsp();
		dsp.configure(14, 12, 15, 0, 0, sampleRate);
		const feedback = combFeedbackAmount(12);
		const wetGain = Math.sqrt(1 - feedback * feedback);
		const response = impulseResponse(dsp, Math.ceil(dsp.delaySamples * 3));
		expect(response[0]).toBeCloseTo(wetGain, 6);
		const first = Math.max(...Array.from(response.slice(1), Math.abs));
		expect(first).toBeCloseTo(wetGain * feedback, 1);
	});

	test("higher feedback rings longer", () => {
		const low = new CombFlangerDsp();
		const high = new CombFlangerDsp();
		low.configure(10, 4, 15, 0, 0, sampleRate);
		high.configure(10, 14, 15, 0, 0, sampleRate);
		const length = sampleRate / 4;
		const lastLow = lastIndexWhere(impulseResponse(low, length), (v) => Math.abs(v) > 1e-3);
		const lastHigh = lastIndexWhere(impulseResponse(high, length), (v) => Math.abs(v) > 1e-3);
		expect(lastHigh).toBeGreaterThan(lastLow);
	});

	test("feedback comb boosts a tone at 1000 / delay Hz over an off-peak tone", () => {
		const delayIndex = 14;
		const peakHz = 1000 / combDelayMs(delayIndex);
		const measure = (hz: number): number => {
			const dsp = new CombFlangerDsp();
			dsp.configure(delayIndex, 13, 15, 0, 0, sampleRate);
			let energy = 0;
			for (let i = 0; i < sampleRate / 2; i++) {
				const out = dsp.process(Math.sin((2 * Math.PI * hz * i) / sampleRate));
				if (i > sampleRate / 4) energy += out * out;
			}
			return energy;
		};
		expect(measure(peakHz)).toBeGreaterThan(measure(peakHz * 1.5) * 4);
	});
});

describe("CombFlangerDsp mix and modulation", () => {
	test("mix 0 is bit-exact passthrough for any other settings", () => {
		const dsp = new CombFlangerDsp();
		dsp.configure(20, 15, 0, 9, 15, sampleRate);
		let seed = 12345;
		for (let i = 0; i < 5000; i++) {
			seed = (seed * 1664525 + 1013904223) >>> 0;
			const input = (seed / 0xffffffff) * 2 - 1;
			expect(Object.is(dsp.process(input), input)).toBe(true);
		}
	});

	test("mix 0 keeps the delay line primed so raising mix has history", () => {
		const dsp = new CombFlangerDsp();
		dsp.configure(10, 10, 0, 0, 0, sampleRate);
		for (let i = 0; i < 2000; i++) dsp.process(Math.sin(i * 0.1));
		dsp.configure(10, 10, 15, 0, 0, sampleRate);
		expect(dsp.process(0)).not.toBe(0);
	});

	test("depth sweeps the effective delay while depth 0 holds it fixed", () => {
		const steady = new CombFlangerDsp();
		const swept = new CombFlangerDsp();
		steady.configure(14, 10, 15, 8, 0, sampleRate);
		swept.configure(14, 10, 15, 8, 12, sampleRate);
		const length = sampleRate / 2;
		const a = impulseResponse(steady, length);
		const b = impulseResponse(swept, length);
		const lateEchoA = a.slice(Math.floor(steady.delaySamples * 8));
		const lateEchoB = b.slice(Math.floor(steady.delaySamples * 8));
		let differing = 0;
		for (let i = 0; i < lateEchoA.length; i++) if (lateEchoA[i] !== lateEchoB[i]) differing++;
		expect(differing).toBeGreaterThan(0);
		expect(swept.phase).toBeGreaterThan(0);
		expect(steady.phase).toBe(0);
	});

	test("output stays finite at maximum feedback and depth", () => {
		const dsp = new CombFlangerDsp();
		dsp.configure(
			Config.combDelayRange - 1,
			Config.combFeedbackRange - 1,
			Config.combMixRange - 1,
			Config.combRateRange - 1,
			Config.combDepthRange - 1,
			sampleRate,
		);
		let peak = 0;
		for (let i = 0; i < sampleRate; i++) {
			const out = dsp.process(i % 100 < 50 ? 0.5 : -0.5);
			expect(Number.isFinite(out)).toBe(true);
			peak = Math.max(peak, Math.abs(out));
		}
		expect(peak).toBeLessThan(40);
	});

	test("reset clears history and phase", () => {
		const dsp = new CombFlangerDsp();
		dsp.configure(14, 12, 15, 8, 8, sampleRate);
		for (let i = 0; i < 3000; i++) dsp.process(Math.sin(i));
		dsp.reset();
		expect(dsp.phase).toBe(0);
		expect(dsp.process(0)).toBe(0);
	});
});

describe("comb flanger effects source", () => {
	const flags = (comb: boolean): boolean[] => [
		...Array(11).fill(false),
		false,
		comb,
	];

	test("omits comb code when disabled", () => {
		const src = buildEffectsSource(...(flags(false) as Parameters<typeof buildEffectsSource>));
		expect(src).not.toContain("combFlanger");
	});

	test("routes samples through the comb when enabled", () => {
		const src = buildEffectsSource(...(flags(true) as Parameters<typeof buildEffectsSource>));
		expect(src).toContain("combFlanger.process(sample)");
	});
});

describe("comb flanger config", () => {
	test("effect name and order entries exist", () => {
		expect(Config.effectNames[EffectType.combFlanger]).toBe("comb flanger");
		expect(Config.effectOrder).toContain(EffectType.combFlanger);
	});

	test("comb flanger sits at bit 19 and EffectType.length is 20", () => {
		expect(EffectType.compressor).toBe(18);
		expect(EffectType.combFlanger).toBe(19);
		expect(EffectType.length).toBe(20);
	});
});

describe("comb flanger serialization", () => {
	test("base64 round-trip preserves comb settings", () => {
		const song = createTestSong();
		const instr = song.channels[0].instruments[0];
		instr.effects |= 1 << EffectType.combFlanger;
		instr.combDelay = 21;
		instr.combFeedback = 11;
		instr.combMix = 13;
		instr.combRate = 6;
		instr.combDepth = 9;
		const encoded = song.toBase64String();

		const decoded = createTestSong();
		decoded.fromBase64String(encoded);
		const out = decoded.channels[0].instruments[0];

		expect(out.effects).toBe(instr.effects);
		expect(out.combDelay).toBe(21);
		expect(out.combFeedback).toBe(11);
		expect(out.combMix).toBe(13);
		expect(out.combRate).toBe(6);
		expect(out.combDepth).toBe(9);
		expect(decoded.toBase64String()).toBe(encoded);
	});

	test("comb coexists with compressor and all 18 legacy effect bits", () => {
		const song = createTestSong();
		const instr = song.channels[0].instruments[0];
		instr.effects =
			(1 << EffectType.combFlanger) | (1 << EffectType.compressor) | 0x3ffff;
		instr.combMix = 15;
		const decoded = createTestSong();
		decoded.fromBase64String(song.toBase64String());
		const out = decoded.channels[0].instruments[0];
		expect(out.effects).toBe(instr.effects);
		expect(out.combMix).toBe(15);
	});

	test("maximum slider values survive base64 decode", () => {
		const song = createTestSong();
		const instr = song.channels[0].instruments[0];
		instr.effects |= 1 << EffectType.combFlanger;
		instr.combDelay = Config.combDelayRange - 1;
		instr.combFeedback = Config.combFeedbackRange - 1;
		instr.combMix = Config.combMixRange - 1;
		instr.combRate = Config.combRateRange - 1;
		instr.combDepth = Config.combDepthRange - 1;
		const decoded = createTestSong();
		decoded.fromBase64String(song.toBase64String());
		const out = decoded.channels[0].instruments[0];
		expect(out.combDelay).toBe(Config.combDelayRange - 1);
		expect(out.combFeedback).toBe(Config.combFeedbackRange - 1);
		expect(out.combMix).toBe(Config.combMixRange - 1);
		expect(out.combRate).toBe(Config.combRateRange - 1);
		expect(out.combDepth).toBe(Config.combDepthRange - 1);
	});

	test("JSON round-trip preserves comb settings", () => {
		const song = createTestSong();
		const instr = song.channels[0].instruments[0];
		instr.effects |= 1 << EffectType.combFlanger;
		instr.combDelay = 7;
		instr.combFeedback = 5;
		instr.combMix = 12;
		instr.combRate = 1;
		instr.combDepth = 14;
		const decoded = createTestSong();
		decoded.fromJsonObject(song.toJsonObject());
		const out = decoded.channels[0].instruments[0];
		expect((out.effects >> EffectType.combFlanger) & 1).toBe(1);
		expect(out.combDelay).toBe(7);
		expect(out.combFeedback).toBe(5);
		expect(out.combMix).toBe(12);
		expect(out.combRate).toBe(1);
		expect(out.combDepth).toBe(14);
	});

	test("disabling comb restores the original encoding", () => {
		const song = createTestSong();
		const baseline = song.toBase64String();
		const instr = song.channels[0].instruments[0];
		instr.effects |= 1 << EffectType.combFlanger;
		expect(song.toBase64String()).not.toBe(baseline);
		instr.effects &= ~(1 << EffectType.combFlanger);
		expect(song.toBase64String()).toBe(baseline);
	});
});

describe("legacy songs stay byte-identical", () => {
	test("fixture set covers every legacy effect bit", () => {
		expect(Object.keys(legacyGolden).sort()).toEqual(Object.keys(buildLegacySongs()).sort());
		expect(Object.keys(legacyGolden).length).toBeGreaterThanOrEqual(19);
	});

	for (const [name, song] of Object.entries(buildLegacySongs())) {
		test(`${name} encodes to the pre-comb golden string`, () => {
			expect(song.toBase64String()).toBe(legacyGolden[name]);
		});

		test(`${name} decodes and re-encodes to the same string`, () => {
			const decoded = createTestSong();
			decoded.fromBase64String(legacyGolden[name]);
			expect(decoded.toBase64String()).toBe(legacyGolden[name]);
		});
	}
});
