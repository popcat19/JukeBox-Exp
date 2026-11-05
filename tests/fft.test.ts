// fft.test.ts
//
// Purpose: Unit tests for FFT module — Fourier transform functions
//
// This module:
// - Verifies scaleElementsByFactor on plain arrays and typed arrays
// - Verifies discreteFourierTransform against edge cases
// - Verifies fastFourierTransform round-trip property
// - Verifies forward/inverse real FFT round-trip invariance

import { describe, test, expect } from "bun:test";
import {
	scaleElementsByFactor,
	discreteFourierTransform,
	fastFourierTransform,
	forwardRealFourierTransform,
	inverseRealFourierTransform,
} from "../shared/fft";

describe("scaleElementsByFactor", () => {
	test("scales all elements by given factor", () => {
		const arr = [1, 2, 3, 4];
		scaleElementsByFactor(arr, 2);
		expect(arr).toEqual([2, 4, 6, 8]);
	});

	test("works on Float32Array", () => {
		const arr = new Float32Array([1, 2, 3]);
		scaleElementsByFactor(arr, 0.5);
		expect(Array.from(arr)).toEqual([0.5, 1, 1.5]);
	});

	test("factor of 1 is identity", () => {
		const arr = [5, -3, 0, 8];
		scaleElementsByFactor(arr, 1);
		expect(arr).toEqual([5, -3, 0, 8]);
	});

	test("factor of 0 zeros all elements", () => {
		const arr = [1, 2, 3, 4, 5];
		scaleElementsByFactor(arr, 0);
		expect(arr).toEqual([0, 0, 0, 0, 0]);
	});
});

describe("discreteFourierTransform", () => {
	test("DC-only input: only bin[0] is non-zero", () => {
		const real = [1, 1, 1, 1];
		const imag = [0, 0, 0, 0];
		const [realOut, imagOut] = discreteFourierTransform(real, imag);
		// DC bin: sum of real = 4
		expect(realOut[0]).toBeCloseTo(4, 5);
		for (let i = 1; i < 4; i++) {
			expect(realOut[i]).toBeCloseTo(0, 5);
			expect(imagOut[i]).toBeCloseTo(0, 5);
		}
	});

	test("throws on mismatched array lengths", () => {
		expect(() => discreteFourierTransform([1, 2], [1])).toThrow("same length");
	});

	test("single element", () => {
		const [r, i] = discreteFourierTransform([5], [0]);
		expect(r[0]).toBe(5);
		expect(i[0]).toBe(0);
	});
});

describe("fastFourierTransform", () => {
	test("FFT of DC signal preserves DC in real, zeros in imag", () => {
		const real = new Float64Array([1, 1, 1, 1]);
		const imag = new Float64Array([0, 0, 0, 0]);
		fastFourierTransform(real, imag);
		expect(real[0]).toBeCloseTo(4, 5);
		for (let i = 1; i < 4; i++) {
			expect(real[i]).toBeCloseTo(0, 5);
		}
		for (let i = 0; i < 4; i++) {
			expect(imag[i]).toBeCloseTo(0, 5);
		}
	});

	test("throws if length < 4", () => {
		expect(() => fastFourierTransform([1], [0])).toThrow("at least 4");
	});

	test("throws if not power of 2", () => {
		expect(() => fastFourierTransform([1, 2, 3], [0, 0, 0])).toThrow("power of 2");
	});

	test("throws if arrays differ in length", () => {
		expect(() => fastFourierTransform([1, 2, 3, 4], [0, 0, 0])).toThrow("same length");
	});

	test("forward then inverse recovers original (modulo scaling)", () => {
		const n = 16;
		const real = new Float64Array(n);
		const imag = new Float64Array(n);
		for (let i = 0; i < n; i++) real[i] = Math.sin((2 * Math.PI * i) / n) + 0.5 * Math.cos((4 * Math.PI * i) / n);

		const original = new Float64Array(real);

		fastFourierTransform(real, imag);
		fastFourierTransform(imag, real);

		// Two FFTs recover original scaled by N
		scaleElementsByFactor(real, 1 / n);
		for (let i = 0; i < n; i++) {
			expect(real[i]).toBeCloseTo(original[i], 2);
		}
	});
});

describe("forwardRealFourierTransform / inverseRealFourierTransform", () => {
	test("throws if length < 4", () => {
		expect(() => forwardRealFourierTransform([1])).toThrow("at least 4");
		expect(() => inverseRealFourierTransform([1], 2)).toThrow("at least 4");
	});

	test("forward then inverse recovers original", () => {
		const n = 1024;
		const input = new Float64Array(n);
		for (let i = 0; i < n; i++) {
			input[i] = Math.sin((2 * Math.PI * 3 * i) / n) + 0.3 * Math.cos((2 * Math.PI * 7 * i) / n);
		}
		const original = new Float64Array(input);

		forwardRealFourierTransform(input);
		inverseRealFourierTransform(input, n);

		// Inverse includes a final factor of N scaling from the two transforms
		scaleElementsByFactor(input, 1 / n);
		for (let i = 0; i < n; i++) {
			expect(input[i]).toBeCloseTo(original[i], 1);
		}
	});

	test("DC signal survives forward+inverse", () => {
		const n = 8;
		const input = new Float64Array([1, 1, 1, 1, 1, 1, 1, 1]);
		forwardRealFourierTransform(input);
		inverseRealFourierTransform(input, n);
		scaleElementsByFactor(input, 1 / n);
		for (let i = 0; i < n; i++) {
			expect(input[i]).toBeCloseTo(1, 5);
		}
	});
});
