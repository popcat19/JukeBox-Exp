// Waves
//
// Purpose: Generates custom waveform data for spectrum, harmonics, and granular synthesis
//
// This module:
// - Computes spectrum and harmonics waveforms via inverse Fourier transform
// - Manages wave hash caching for dirty-check optimization
// - Implements grain envelope and delay logic for granular synthesis

import { inverseRealFourierTransform, scaleElementsByFactor } from "../shared/fft";
import {
	Config,
	drawNoiseSpectrum,
	getDrumWave,
	InstrumentType,
	performIntegralOld,
} from "./synth-config";
import { fittingPowerOfTwo } from "./util";

export class SpectrumWave {
	public spectrum: number[] = [];
	public hash: number = -1;

	constructor(isNoiseChannel: boolean) {
		this.reset(isNoiseChannel);
	}

	public reset(isNoiseChannel: boolean): void {
		for (let i: number = 0; i < Config.spectrumControlPoints; i++) {
			if (isNoiseChannel) {
				this.spectrum[i] = Math.round(Config.spectrumMax * (1 / Math.sqrt(1 + i / 3)));
			} else {
				const isHarmonic: boolean =
					i === 0 ||
					i === 7 ||
					i === 11 ||
					i === 14 ||
					i === 16 ||
					i === 18 ||
					i === 21 ||
					i === 23 ||
					i >= 25;
				this.spectrum[i] = isHarmonic
					? Math.max(0, Math.round(Config.spectrumMax * (1 - i / 30)))
					: 0;
			}
		}
		this.markCustomWaveDirty();
	}

	public markCustomWaveDirty(): void {
		const hashMult: number = fittingPowerOfTwo(Config.spectrumMax + 2) - 1;
		let hash: number = 0;
		for (const point of this.spectrum) hash = (hash * hashMult + point) >>> 0;
		this.hash = hash;
	}
}

export class SpectrumWaveState {
	public wave: Float32Array | null = null;
	private _hash: number = -1;

	public getCustomWave(settings: SpectrumWave, lowestOctave: number): Float32Array {
		if (this._hash === settings.hash) return this.wave!;
		this._hash = settings.hash;

		const waveLength: number = Config.spectrumNoiseLength;
		if (this.wave == null || this.wave.length !== waveLength + 1) {
			this.wave = new Float32Array(waveLength + 1);
		}
		const wave: Float32Array = this.wave;

		for (let i: number = 0; i < waveLength; i++) {
			wave[i] = 0;
		}

		const highestOctave: number = 14;
		const falloffRatio: number = 0.25;
		// Nudge the 2/7 and 4/7 control points so that they form harmonic intervals.
		const pitchTweak: number[] = [
			0,
			1 / 7,
			Math.log2(5 / 4),
			3 / 7,
			Math.log2(3 / 2),
			5 / 7,
			6 / 7,
		];
		function controlPointToOctave(point: number): number {
			return (
				lowestOctave +
				Math.floor(point / Config.spectrumControlPointsPerOctave) +
				pitchTweak[
					(point + Config.spectrumControlPointsPerOctave) %
						Config.spectrumControlPointsPerOctave
				]
			);
		}

		let combinedAmplitude: number = 1;
		for (let i: number = 0; i < Config.spectrumControlPoints + 1; i++) {
			const value1: number = i <= 0 ? 0 : settings.spectrum[i - 1];
			const value2: number =
				i >= Config.spectrumControlPoints
					? settings.spectrum[Config.spectrumControlPoints - 1]
					: settings.spectrum[i];
			const octave1: number = controlPointToOctave(i - 1);
			let octave2: number = controlPointToOctave(i);
			if (i >= Config.spectrumControlPoints)
				octave2 = highestOctave + (octave2 - highestOctave) * falloffRatio;
			if (value1 === 0 && value2 === 0) continue;

			combinedAmplitude +=
				0.02 *
				drawNoiseSpectrum(
					wave,
					waveLength,
					octave1,
					octave2,
					value1 / Config.spectrumMax,
					value2 / Config.spectrumMax,
					-0.5,
				);
		}
		if (settings.spectrum[Config.spectrumControlPoints - 1] > 0) {
			combinedAmplitude +=
				0.02 *
				drawNoiseSpectrum(
					wave,
					waveLength,
					highestOctave +
						(controlPointToOctave(Config.spectrumControlPoints) - highestOctave) *
							falloffRatio,
					highestOctave,
					settings.spectrum[Config.spectrumControlPoints - 1] / Config.spectrumMax,
					0,
					-0.5,
				);
		}

		inverseRealFourierTransform(wave, waveLength);
		scaleElementsByFactor(wave, 5.0 / (Math.sqrt(waveLength) * combinedAmplitude ** 0.75));

		// Duplicate the first sample at the end for easier wrap-around interpolation.
		wave[waveLength] = wave[0];

		return wave;
	}
}

export class HarmonicsWave {
	public harmonics: number[] = [];
	public hash: number = -1;

	constructor() {
		this.reset();
	}

	public reset(): void {
		for (let i: number = 0; i < Config.harmonicsControlPoints; i++) {
			this.harmonics[i] = 0;
		}
		this.harmonics[0] = Config.harmonicsMax;
		this.harmonics[3] = Config.harmonicsMax;
		this.harmonics[6] = Config.harmonicsMax;
		this.markCustomWaveDirty();
	}

	public markCustomWaveDirty(): void {
		const hashMult: number = fittingPowerOfTwo(Config.harmonicsMax + 2) - 1;
		let hash: number = 0;
		for (const point of this.harmonics) hash = (hash * hashMult + point) >>> 0;
		this.hash = hash;
	}
}

export class HarmonicsWaveState {
	public wave: Float32Array | null = null;
	private _hash: number = -1;
	private _generatedForType: InstrumentType;

	public getCustomWave(settings: HarmonicsWave, instrumentType: InstrumentType): Float32Array {
		if (this._hash === settings.hash && this._generatedForType === instrumentType)
			return this.wave!;
		this._hash = settings.hash;
		this._generatedForType = instrumentType;

		const harmonicsRendered: number =
			instrumentType === InstrumentType.pickedString
				? Config.harmonicsRenderedForPickedString
				: Config.harmonicsRendered;

		const waveLength: number = Config.harmonicsWavelength;
		const retroWave: Float32Array = getDrumWave(0, null, null);

		if (this.wave == null || this.wave.length !== waveLength + 1) {
			this.wave = new Float32Array(waveLength + 1);
		}
		const wave: Float32Array = this.wave;

		for (let i: number = 0; i < waveLength; i++) {
			wave[i] = 0;
		}

		const overallSlope: number = -0.25;
		let combinedControlPointAmplitude: number = 1;

		for (let harmonicIndex: number = 0; harmonicIndex < harmonicsRendered; harmonicIndex++) {
			const harmonicFreq: number = harmonicIndex + 1;
			let controlValue: number =
				harmonicIndex < Config.harmonicsControlPoints
					? settings.harmonics[harmonicIndex]
					: settings.harmonics[Config.harmonicsControlPoints - 1];
			if (harmonicIndex >= Config.harmonicsControlPoints) {
				controlValue *=
					1 -
					(harmonicIndex - Config.harmonicsControlPoints) /
						(harmonicsRendered - Config.harmonicsControlPoints);
			}
			const normalizedValue: number = controlValue / Config.harmonicsMax;
			let amplitude: number =
				2 ** (controlValue - Config.harmonicsMax + 1) * Math.sqrt(normalizedValue);
			if (harmonicIndex < Config.harmonicsControlPoints) {
				combinedControlPointAmplitude += amplitude;
			}
			amplitude *= harmonicFreq ** overallSlope;

			// Multiply all the sine wave amplitudes by 1 or -1 based on the LFSR
			// retro wave (effectively random) to avoid egregiously tall spikes.
			amplitude *= retroWave[harmonicIndex + 589];

			wave[waveLength - harmonicFreq] = amplitude;
		}

		inverseRealFourierTransform(wave, waveLength);

		// Limit the maximum wave amplitude.
		const mult: number = 1 / combinedControlPointAmplitude ** 0.7;
		for (let i: number = 0; i < wave.length; i++) wave[i] *= mult;

		performIntegralOld(wave);

		// Duplicate first sample at end for easier interpolation.
		wave[waveLength] = wave[0];

		return wave;
	}
}

export class Grain {
	public delayLinePosition: number; // Relative to latest sample

	public ageInSamples: number;
	public maxAgeInSamples: number;
	public delay: number;

	// parabolic envelope implementation
	public parabolicEnvelopeAmplitude: number;
	public parabolicEnvelopeSlope: number;
	public parabolicEnvelopeCurve: number;

	// raised cosine bell envelope implementation
	public rcbEnvelopeAmplitude: number;
	public rcbEnvelopeAttackIndex: number;
	public rcbEnvelopeReleaseIndex: number;
	public rcbEnvelopeSustain: number;

	constructor() {
		this.delayLinePosition = 0;

		this.ageInSamples = 0;
		this.maxAgeInSamples = 0;
		this.delay = 0;

		this.parabolicEnvelopeAmplitude = 0;
		this.parabolicEnvelopeSlope = 0;
		this.parabolicEnvelopeCurve = 0;

		this.rcbEnvelopeAmplitude = 0;
		this.rcbEnvelopeAttackIndex = 0;
		this.rcbEnvelopeReleaseIndex = 0;
		this.rcbEnvelopeSustain = 0;
	}

	public initializeParabolicEnvelope(durationInSamples: number, amplitude: number): void {
		this.parabolicEnvelopeAmplitude = 0;
		if (durationInSamples === 0) durationInSamples++; // prevent division by 0
		const invDuration: number = 1.0 / durationInSamples;
		const invDurationSquared: number = invDuration * invDuration;
		this.parabolicEnvelopeSlope = 4.0 * amplitude * (invDuration - invDurationSquared);
		this.parabolicEnvelopeCurve = -8.0 * amplitude * invDurationSquared;
	}

	public updateParabolicEnvelope(): void {
		this.parabolicEnvelopeAmplitude += this.parabolicEnvelopeSlope;
		this.parabolicEnvelopeSlope += this.parabolicEnvelopeCurve;
	}

	// rcb is unfinished and unused rn
	public initializeRCBEnvelope(durationInSamples: number, amplitude: number): void {
		// attack:
		this.rcbEnvelopeAttackIndex = Math.floor(durationInSamples / 6);
		// sustain:
		this.rcbEnvelopeSustain = amplitude;
		// release:
		this.rcbEnvelopeReleaseIndex = Math.floor((durationInSamples * 5) / 6);
	}

	public updateRCBEnvelope(): void {
		if (this.ageInSamples < this.rcbEnvelopeAttackIndex) {
			// attack
			this.rcbEnvelopeAmplitude =
				1.0 +
				Math.cos(
					Math.PI +
						Math.PI *
							(this.ageInSamples / this.rcbEnvelopeAttackIndex) *
							(this.rcbEnvelopeSustain / 2.0),
				);
		} else if (this.ageInSamples > this.rcbEnvelopeReleaseIndex) {
			// release
			this.rcbEnvelopeAmplitude =
				1.0 +
				Math.cos(
					Math.PI *
						((this.ageInSamples - this.rcbEnvelopeReleaseIndex) /
							this.rcbEnvelopeAttackIndex),
				) *
					(this.rcbEnvelopeSustain / 2.0);
		} // sustain covered by the end of attack
	}

	public addDelay(delay: number): void {
		this.delay = delay;
	}
}
