// compressor.test.ts
//
// Purpose: Unit and round-trip tests for the compressor effect
//
// This module:
// - Verifies gain reduction above threshold and unity gain below it
// - Verifies beat-synced ducking and recovery
// - Verifies base64 and JSON round-trips and decode/re-encode stability for songs without the effect
// - Verifies the generated effects source routes samples through the compressor

import { describe, test, expect } from "bun:test";
import { CompressorDsp } from "../synth/compressor";
import { buildEffectsSource } from "../synth/synthesis/effects";
import { Config, EffectType } from "../synth/synth-config";
import { createTestSong } from "./test-helpers";

const sampleRate = 48000;

function settledGain(dsp: CompressorDsp, level: number, samples: number): number {
	let out = 0;
	for (let i = 0; i < samples; i++) out = dsp.process(level);
	return out / level;
}

describe("CompressorDsp level mode", () => {
	test("reduces gain for signal above threshold", () => {
		const dsp = new CompressorDsp();
		dsp.configure(16, 4, 0, 4, false, sampleRate);
		const gain = settledGain(dsp, 0.9, sampleRate / 4);
		expect(gain).toBeLessThan(0.7);
		expect(gain).toBeGreaterThan(0);
	});

	test("leaves signal below threshold untouched", () => {
		const dsp = new CompressorDsp();
		dsp.configure(8, 4, 0, 4, false, sampleRate);
		expect(settledGain(dsp, 0.05, sampleRate / 4)).toBe(1);
	});

	test("higher ratio reduces gain further", () => {
		const low = new CompressorDsp();
		const high = new CompressorDsp();
		low.configure(16, 2, 0, 4, false, sampleRate);
		high.configure(16, 9, 0, 4, false, sampleRate);
		expect(settledGain(high, 0.9, sampleRate / 4)).toBeLessThan(
			settledGain(low, 0.9, sampleRate / 4),
		);
	});

	test("ratio index 0 never reduces gain", () => {
		const dsp = new CompressorDsp();
		dsp.configure(31, 0, 0, 4, false, sampleRate);
		expect(settledGain(dsp, 0.9, sampleRate / 4)).toBeCloseTo(1, 10);
	});

	test("gain recovers after loud signal ends", () => {
		const dsp = new CompressorDsp();
		dsp.configure(16, 6, 0, 0, false, sampleRate);
		settledGain(dsp, 0.9, sampleRate / 4);
		const reduced = dsp.lastGain;
		settledGain(dsp, 0.001, sampleRate);
		expect(dsp.lastGain).toBeGreaterThan(reduced);
		expect(dsp.lastGain).toBe(1);
	});
});

describe("CompressorDsp sync mode", () => {
	test("is unity before any trigger", () => {
		const dsp = new CompressorDsp();
		dsp.configure(12, 8, 2, 8, true, sampleRate);
		expect(dsp.process(0.5)).toBe(0.5);
	});

	test("ducks after trigger and recovers over release time", () => {
		const dsp = new CompressorDsp();
		dsp.configure(12, 8, 2, 8, true, sampleRate);
		dsp.trigger();
		let minGain = 1;
		for (let i = 0; i < sampleRate / 20; i++) {
			dsp.process(0.5);
			minGain = Math.min(minGain, dsp.lastGain);
		}
		expect(minGain).toBeLessThan(0.3);
		for (let i = 0; i < sampleRate * 2; i++) dsp.process(0.5);
		expect(dsp.lastGain).toBe(1);
	});

	test("ducks regardless of input level", () => {
		const dsp = new CompressorDsp();
		dsp.configure(31, 8, 2, 8, true, sampleRate);
		dsp.trigger();
		for (let i = 0; i < 1000; i++) dsp.process(0.01);
		expect(dsp.lastGain).toBeLessThan(1);
	});
});

describe("compressor effects source", () => {
	test("omits compressor code when disabled", () => {
		const src = buildEffectsSource(false, false, false, false, false, false, false, false, false, false, false, false);
		expect(src).not.toContain("compressor");
	});

	test("routes samples through the compressor when enabled", () => {
		const src = buildEffectsSource(false, false, false, false, false, false, false, false, false, false, false, true);
		expect(src).toContain("compressor.process(sample)");
		expect(src).toContain("compressor.sanitize()");
	});
});

describe("compressor config", () => {
	test("effect name and order entries exist", () => {
		expect(Config.effectNames[EffectType.compressor]).toBe("compressor");
		expect(Config.effectOrder).toContain(EffectType.compressor);
	});

	test("compressor sits one bit past the 18-bit effects bitfield", () => {
		expect(EffectType.compressor).toBe(18);
		expect(EffectType.length).toBe(19);
	});
});

describe("compressor serialization", () => {
	test("base64 round-trip preserves compressor settings", () => {
		const song = createTestSong();
		const instr = song.channels[0].instruments[0];
		instr.effects |= 1 << EffectType.compressor;
		instr.compressorThreshold = 21;
		instr.compressorRatio = 9;
		instr.compressorAttack = 3;
		instr.compressorRelease = 14;
		instr.compressorSync = 2;
		const encoded = song.toBase64String();

		const decoded = createTestSong();
		decoded.fromBase64String(encoded);
		const out = decoded.channels[0].instruments[0];

		expect(out.effects).toBe(instr.effects);
		expect(out.compressorThreshold).toBe(21);
		expect(out.compressorRatio).toBe(9);
		expect(out.compressorAttack).toBe(3);
		expect(out.compressorRelease).toBe(14);
		expect(out.compressorSync).toBe(2);
		expect(decoded.toBase64String()).toBe(encoded);
	});

	test("compressor coexists with all 18 legacy effect bits", () => {
		const song = createTestSong();
		const instr = song.channels[0].instruments[0];
		instr.effects = (1 << EffectType.compressor) | 0x3ffff;
		const decoded = createTestSong();
		decoded.fromBase64String(song.toBase64String());
		expect(decoded.channels[0].instruments[0].effects).toBe(instr.effects);
	});

	test("songs without compressor re-encode identically", () => {
		const song = createTestSong();
		song.channels[0].instruments[0].effects = 0x3ffff;
		const encoded = song.toBase64String();
		const decoded = createTestSong();
		decoded.fromBase64String(encoded);
		expect(decoded.channels[0].instruments[0].effects).toBe(0x3ffff);
		expect(decoded.toBase64String()).toBe(encoded);

		const plainEncoded = createTestSong().toBase64String();
		const plainDecoded = createTestSong();
		plainDecoded.fromBase64String(plainEncoded);
		expect(plainDecoded.toBase64String()).toBe(plainEncoded);
	});

	test("disabling compressor restores the original encoding", () => {
		const song = createTestSong();
		const baseline = song.toBase64String();
		const instr = song.channels[0].instruments[0];
		instr.effects |= 1 << EffectType.compressor;
		expect(song.toBase64String()).not.toBe(baseline);
		instr.effects &= ~(1 << EffectType.compressor);
		expect(song.toBase64String()).toBe(baseline);
	});

	test("maximum slider values survive base64 decode", () => {
		const song = createTestSong();
		const instr = song.channels[0].instruments[0];
		instr.effects |= 1 << EffectType.compressor;
		instr.compressorThreshold = Config.compressorThresholdRange - 1;
		instr.compressorRatio = Config.compressorRatios.length - 1;
		instr.compressorAttack = Config.compressorAttackRange - 1;
		instr.compressorRelease = Config.compressorReleaseRange - 1;
		instr.compressorSync = Config.compressorSyncBeats.length - 1;
		const decoded = createTestSong();
		decoded.fromBase64String(song.toBase64String());
		const out = decoded.channels[0].instruments[0];
		expect(out.compressorThreshold).toBe(Config.compressorThresholdRange - 1);
		expect(out.compressorRatio).toBe(Config.compressorRatios.length - 1);
		expect(out.compressorAttack).toBe(Config.compressorAttackRange - 1);
		expect(out.compressorRelease).toBe(Config.compressorReleaseRange - 1);
		expect(out.compressorSync).toBe(Config.compressorSyncBeats.length - 1);
	});

	test("JSON round-trip preserves compressor settings", () => {
		const song = createTestSong();
		const instr = song.channels[0].instruments[0];
		instr.effects |= 1 << EffectType.compressor;
		instr.compressorThreshold = 7;
		instr.compressorRatio = 5;
		instr.compressorAttack = 1;
		instr.compressorRelease = 12;
		instr.compressorSync = 3;
		const decoded = createTestSong();
		decoded.fromJsonObject(song.toJsonObject());
		const out = decoded.channels[0].instruments[0];
		expect((out.effects >> EffectType.compressor) & 1).toBe(1);
		expect(out.compressorThreshold).toBe(7);
		expect(out.compressorRatio).toBe(5);
		expect(out.compressorAttack).toBe(1);
		expect(out.compressorRelease).toBe(12);
		expect(out.compressorSync).toBe(3);
	});
});
