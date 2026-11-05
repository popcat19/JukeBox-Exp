// comb-flanger.ts
//
// Purpose: Per-instrument feedback comb filter with LFO-modulated delay for flanging
//
// This module:
// - Defines CombFlangerDsp, a stateful per-sample feedback comb processor
// - Converts slider indices to delay time, feedback, mix, LFO rate, and LFO depth
// - Passes the input through bit-exactly when mix is zero

import { Config } from "./synth-config";

export function combDelayMs(delayIndex: number): number {
	return Config.combDelayBaseMs * Config.combDelayGrowth ** delayIndex;
}

export function combRateHz(rateIndex: number): number {
	return Config.combRateBaseHz * Config.combRateGrowth ** rateIndex;
}

export function combFeedbackAmount(feedbackIndex: number): number {
	return (feedbackIndex / (Config.combFeedbackRange - 1)) * Config.combFeedbackMax;
}

export function combMixAmount(mixIndex: number): number {
	return mixIndex / (Config.combMixRange - 1);
}

export function combDepthAmount(depthIndex: number): number {
	return (depthIndex / (Config.combDepthRange - 1)) * Config.combDepthMax;
}

function fittingPowerOfTwo(value: number): number {
	let size: number = 1;
	while (size < value) size <<= 1;
	return size;
}

export class CombFlangerDsp {
	public phase: number = 0.0;

	private _buffer: Float32Array = new Float32Array(0);
	private _mask: number = 0;
	private _writePos: number = 0;
	private _baseDelaySamples: number = 1.0;
	private _depth: number = 0.0;
	private _phaseDelta: number = 0.0;
	private _feedback: number = 0.0;
	private _wetGain: number = 0.0;
	private _mix: number = 0.0;

	public configure(
		delayIndex: number,
		feedbackIndex: number,
		mixIndex: number,
		rateIndex: number,
		depthIndex: number,
		samplesPerSecond: number,
	): void {
		const maxDelayMs: number =
			combDelayMs(Config.combDelayRange - 1) * (1.0 + Config.combDepthMax);
		const needed: number = fittingPowerOfTwo(
			Math.ceil(maxDelayMs * 0.001 * samplesPerSecond) + 2,
		);
		if (this._buffer.length < needed) {
			this._buffer = new Float32Array(needed);
			this._mask = needed - 1;
			this._writePos = 0;
		}
		this._baseDelaySamples = combDelayMs(delayIndex) * 0.001 * samplesPerSecond;
		this._depth = combDepthAmount(depthIndex);
		this._phaseDelta = combRateHz(rateIndex) / samplesPerSecond;
		this._feedback = combFeedbackAmount(feedbackIndex);
		this._wetGain = Math.sqrt(1.0 - this._feedback * this._feedback);
		this._mix = combMixAmount(mixIndex);
	}

	public get delaySamples(): number {
		return this._baseDelaySamples;
	}

	public process(sample: number): number {
		const buffer: Float32Array = this._buffer;
		const mask: number = this._mask;
		const writePos: number = this._writePos;

		let delay: number = this._baseDelaySamples;
		if (this._depth > 0.0) {
			delay *= 1.0 + this._depth * Math.sin(this.phase * 6.283185307179586);
			this.phase += this._phaseDelta;
			this.phase -= this.phase | 0;
		}
		if (delay < 1.0) delay = 1.0;

		const readPos: number = writePos - delay;
		const readIndex: number = Math.floor(readPos);
		const fraction: number = readPos - readIndex;
		const tapA: number = buffer[readIndex & mask];
		const tapB: number = buffer[(readIndex + 1) & mask];
		const delayed: number = tapA + (tapB - tapA) * fraction;

		let wet: number = sample + this._feedback * delayed;
		if (!Number.isFinite(wet) || Math.abs(wet) < 1.0e-24) wet = 0.0;
		buffer[writePos] = wet;
		this._writePos = (writePos + 1) & mask;

		if (this._mix === 0.0) return sample;
		return sample + (wet * this._wetGain - sample) * this._mix;
	}

	public reset(): void {
		this._buffer.fill(0.0);
		this._writePos = 0;
		this.phase = 0.0;
	}
}
