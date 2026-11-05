// compressor.ts
//
// Purpose: Per-instrument compressor DSP with an optional beat-synced ducking mode
//
// This module:
// - Defines CompressorDsp, a stateful per-sample gain processor
// - Converts slider indices to threshold, ratio, attack, and release values
// - Provides a triggered duck envelope used for tempo-synced pumping

import { Config } from "./synth-config";

export function compressorThresholdLinear(thresholdIndex: number): number {
	const db: number = -thresholdIndex * Config.compressorThresholdStepDb;
	return 10 ** (db / 20);
}

export function compressorAttackMs(attackIndex: number): number {
	return 0.1 * 1.6 ** attackIndex;
}

export function compressorReleaseMs(releaseIndex: number): number {
	return 20 * 1.3 ** releaseIndex;
}

function smoothingCoefficient(milliseconds: number, samplesPerSecond: number): number {
	return 1 - Math.exp(-1 / Math.max(1, milliseconds * 0.001 * samplesPerSecond));
}

export class CompressorDsp {
	public envelope: number = 0.0;
	public duck: number = 0.0;
	public lastSyncSlot: number = -1;
	public lastGain: number = 1.0;

	private _threshold: number = 1.0;
	private _slope: number = 0.0;
	private _attackCoef: number = 1.0;
	private _releaseCoef: number = 1.0;
	private _duckAttackStep: number = 1.0;
	private _duckReleaseStep: number = 1.0;
	private _duckDepth: number = 0.0;
	private _synced: boolean = false;
	private _ducking: boolean = false;

	public configure(
		thresholdIndex: number,
		ratioIndex: number,
		attackIndex: number,
		releaseIndex: number,
		synced: boolean,
		samplesPerSecond: number,
	): void {
		const ratio: number =
			Config.compressorRatios[
				Math.max(0, Math.min(Config.compressorRatios.length - 1, ratioIndex))
			];
		const attackMs: number = compressorAttackMs(attackIndex);
		const releaseMs: number = compressorReleaseMs(releaseIndex);
		this._threshold = compressorThresholdLinear(thresholdIndex);
		this._slope = 1.0 / ratio - 1.0;
		this._attackCoef = smoothingCoefficient(attackMs, samplesPerSecond);
		this._releaseCoef = smoothingCoefficient(releaseMs, samplesPerSecond);
		this._duckAttackStep = 1.0 / Math.max(1, attackMs * 0.001 * samplesPerSecond);
		this._duckReleaseStep = 1.0 / Math.max(1, releaseMs * 0.001 * samplesPerSecond);
		this._duckDepth = 1.0 - 1.0 / ratio;
		this._synced = synced;
	}

	public get synced(): boolean {
		return this._synced;
	}

	public trigger(): void {
		this._ducking = true;
	}

	public process(sample: number): number {
		let gain: number;
		if (this._synced) {
			if (this._ducking) {
				this.duck += this._duckAttackStep;
				if (this.duck >= 1.0) {
					this.duck = 1.0;
					this._ducking = false;
				}
			} else if (this.duck > 0.0) {
				this.duck = Math.max(0.0, this.duck - this._duckReleaseStep);
			}
			gain = 1.0 - this._duckDepth * this.duck;
		} else {
			const level: number = Math.abs(sample);
			const coef: number = level > this.envelope ? this._attackCoef : this._releaseCoef;
			this.envelope += (level - this.envelope) * coef;
			gain =
				this.envelope > this._threshold
					? (this.envelope / this._threshold) ** this._slope
					: 1.0;
		}
		this.lastGain = gain;
		return sample * gain;
	}

	public sanitize(): void {
		if (!Number.isFinite(this.envelope) || this.envelope < 1.0e-24) this.envelope = 0.0;
		if (!Number.isFinite(this.duck)) this.duck = 0.0;
	}

	public reset(): void {
		this.envelope = 0.0;
		this.duck = 0.0;
		this.lastSyncSlot = -1;
		this.lastGain = 1.0;
		this._ducking = false;
	}
}
