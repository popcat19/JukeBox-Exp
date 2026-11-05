// Spectrum
//
// Purpose: Renders real-time audio as a smooth bezier-curve spectrum analyzer
//
// Inspired by camellia/seatrus MV visualizers and Furnace tracker spectrum.
// This module:
// - Dual layer: background bass (20-250Hz) + foreground main (250-8000Hz)
// - Smooth bezier curves through band magnitudes
// - Dynamic amplification with slow-decay peak hold (no constant 80% fill)
// - 60fps update rate, always clean regardless of project size

import { forwardRealFourierTransform } from "./fft";
import { ColorConfig } from "./color-config";
import { events } from "./events";

const FG_BANDS = 151;
const BG_BANDS = 67;

interface Particle {
	x: number;
	y: number;
	vx: number;
	vy: number;
	life: number;
	maxLife: number;
	size: number;
	color: string;
	colorRole: "left" | "right";
}

const MAX_PARTICLES = 300;

function spawnParticle(
	x: number,
	y: number,
	mag: number,
	impulse: number,
	color: string,
	colorRole: Particle["colorRole"],
): Particle {
	const maxLife = 80 + Math.random() * 120;
	const speed = 0.3 + impulse * 1.0 + mag * 0.6;
	return {
		x,
		y,
		vx: (Math.random() - 0.5) * speed * 0.3,
		vy: -(0.2 + Math.random() * 0.5 + speed * 0.4),
		life: maxLife,
		maxLife,
		size: 1 + Math.random() * 3 + mag * 2,
		color,
		colorRole,
	};
}

export class spectrumCanvas {
	public _EventUpdateCanvas: (left: Float32Array, right?: Float32Array) => void;
	private _cachedBgColor: string = "";
	private _cachedLColor: string = "";
	private _cachedRColor: string = "";
	private _hasValidFrame = false;
	private _disposed = false;
	private readonly _ownerWindow: Window | null;

	private _sampleRate = 48000;
	private _lastBufferSize = 0;
	private readonly _bgFreqs: number[] = [];
	// Ring buffer for BG long-FFT (8192 = ~170ms at 48kHz, provides 5.86Hz bins)
	private _bgRingBuf: Float32Array = new Float32Array(8192);
	private _bgRingPos = 0;
	private _bgFftBuf: Float32Array = new Float32Array(8192);
	private readonly _fgFreqs: number[] = [];

	// Fixed normalization references (floor for soft compression)
	private static readonly FG_REF = 0.04;
	private static readonly BG_REF = 0.05;
	// FFT scratch buffer (reallocated on buffer size change)
	private _fftBuffer: Float32Array = new Float32Array(2048);
	// Per-band temporal smoothing (~30ms decay at 60fps)
	// factor^2 ≈ 0.1, so ~30ms to decay to 10%
	private _fgSmoothMags = new Float32Array(151);
	private _bgSmoothMags = new Float32Array(67);

	// Particle system
	public showParticles: boolean = false;
	private _particles: Particle[] = [];
	private _fgYs: Float64Array = new Float64Array(151);
	private _bgYs: Float64Array = new Float64Array(67);
	// Impulse tracking: ratio of instant RMS to slow-decay average.
	// >1.0 means an attack/impulse is happening.
	private _energyAvg: number = 0.001;

	constructor(
		public readonly canvas: HTMLCanvasElement,
		readonly scale: number = 1,
		readonly transparentBg: boolean = false,
	) {
		this._ownerWindow = canvas.ownerDocument?.defaultView ?? null;
		this._updateCachedColors();
		this._initBands(48000);

		this._EventUpdateCanvas = (directlinkL: Float32Array, directlinkR?: Float32Array): void => {
			if (!directlinkR || this._disposed) return;

			const sampleCount = directlinkL.length;
			if (sampleCount < 4) return;
			this._resizeBackingStore();

			// Compute instant RMS energy for impulse tracking
			let rawEnergy = 0;
			const rmsStep = Math.max(1, Math.floor(sampleCount / 128));
			for (let i = 0; i < sampleCount; i += rmsStep) {
				const s = (directlinkL[i] + directlinkR[i]) * 0.5;
				rawEnergy += s * s;
			}
			rawEnergy = Math.sqrt(rawEnergy / Math.ceil(sampleCount / rmsStep));
			this._energyAvg += (rawEnergy - this._energyAvg) * 0.08;
			const impulse = rawEnergy / Math.max(this._energyAvg, 0.00001);

			if (sampleCount !== this._lastBufferSize) {
				this._initBands(this._sampleRate);
				this._lastBufferSize = sampleCount;
			}
			this._sampleRate = this._sampleRate || 48000;

			// Use the actual buffer size if power of 2, else clamp to previous power of 2
			const fftSize = sampleCount <= 4096 ? 2 ** Math.floor(Math.log2(sampleCount)) : 2048;
			if (fftSize < 4) return;
			if (this._fftBuffer.length !== fftSize) {
				this._fftBuffer = new Float32Array(fftSize);
			}
			const fftBuf = this._fftBuffer;
			const copyLen = Math.min(sampleCount, fftSize);
			for (let i = 0; i < copyLen; i++) {
				const s = (directlinkL[i] + directlinkR[i]) * 0.5;
				const hann = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (fftSize - 1)));
				fftBuf[i] = s * hann;
				// Accumulate raw (unwindowed) audio in BG ring buffer for high-res FFT
				this._bgRingBuf[this._bgRingPos] = s;
				this._bgRingPos = (this._bgRingPos + 1) & 8191;
			}
			for (let i = copyLen; i < fftSize; i++) fftBuf[i] = 0;
			forwardRealFourierTransform(fftBuf);

			// FFT output format: elements 0..N/2 are real, N/2+1..N-1 are imag in descending order
			const halfN = fftSize >> 1;
			const binFreq = this._sampleRate / fftSize;
			const mags = new Float32Array(halfN + 1);
			for (let k = 0; k <= halfN; k++) {
				const re = fftBuf[k];
				const im = k === 0 || k === halfN ? 0 : fftBuf[fftSize - k];
				mags[k] = Math.sqrt(re * re + im * im) / fftSize;
			}

			// Interpolate FG bands from FFT bins: quadratic interpolation for sensitivity
			// Quadratic: y = a*x^2 + b*x + c through (k-1, ym1), (k, y0), (k+1, yp1)
			const fgMags = new Float32Array(FG_BANDS);
			for (let b = 0; b < FG_BANDS; b++) {
				const kFloat = this._fgFreqs[b] / binFreq;
				const k = Math.floor(kFloat);
				const frac = kFloat - k;
				if (k < 1 || k >= halfN) {
					// Edge: fall back to linear
					const kHi = Math.min(k + 1, halfN);
					fgMags[b] = mags[k] + (mags[kHi] - mags[k]) * frac;
				} else {
					const ym1 = mags[k - 1],
						y0 = mags[k],
						yp1 = mags[k + 1];
					const qa = (ym1 + yp1) * 0.5 - y0;
					const qb = (yp1 - ym1) * 0.5;
					const qc = y0;
					fgMags[b] = qa * frac * frac + qb * frac + qc;
				}
			}
			// Per-band gain: ramp from 0.5x (low) to 2x (high) to compensate for spectral tilt
			// Low freqs have more natural energy, attenuate relative to highs
			const fgGainStep = 1.5 / (FG_BANDS - 1);
			for (let b = 0; b < FG_BANDS; b++) {
				fgMags[b] *= 0.5 + b * fgGainStep;
			}
			// Light gaussian spatial blur (sigma=3 bands = 1.5 semitones) to suppress tiny peak jitter
			{
				const blurred = new Float32Array(FG_BANDS);
				for (let b = 0; b < FG_BANDS; b++) {
					let sum = 0,
						wSum = 0;
					for (let n = 0; n < FG_BANDS; n++) {
						const d = n - b;
						const w = Math.exp((-0.5 * d * d) / 9);
						sum += fgMags[n] * w;
						wSum += w;
					}
					blurred[b] = wSum > 0.001 ? sum / wSum : 0;
				}
				for (let b = 0; b < FG_BANDS; b++) fgMags[b] = blurred[b];
			}

			const bgMags = new Float32Array(BG_BANDS);
			// BG: separate 8192-sample FFT for 5.86Hz bins (fine low-freq resolution), halves attack lag vs 16384
			const bgFftSize = 8192;
			const bgHalfN = bgFftSize >> 1;
			const bgBuf = this._bgFftBuf;
			for (let i = 0; i < bgFftSize; i++) {
				const idx = (this._bgRingPos + i) & 8191;
				const hann = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (bgFftSize - 1)));
				bgBuf[i] = this._bgRingBuf[idx] * hann;
			}
			forwardRealFourierTransform(bgBuf);
			const bgBinFreq = this._sampleRate / bgFftSize;
			// Compute BG magnitudes from FFT bins
			const bgMagsArr = new Float32Array(bgHalfN + 1);
			for (let k = 0; k <= bgHalfN; k++) {
				const bgRe = bgBuf[k];
				const bgIm = k === 0 || k === bgHalfN ? 0 : bgBuf[bgFftSize - k];
				bgMagsArr[k] = Math.sqrt(bgRe * bgRe + bgIm * bgIm) / bgFftSize;
			}
			// Per-band: interpolate from FFT bins
			for (let b = 0; b < BG_BANDS; b++) {
				const kFloat = this._bgFreqs[b] / bgBinFreq;
				const kLo = Math.floor(kFloat);
				const kHi = Math.min(kLo + 1, bgHalfN);
				const frac = kFloat - kLo;
				bgMags[b] = bgMagsArr[kLo] + (bgMagsArr[kHi] - bgMagsArr[kLo]) * frac;
			}
			// Light gaussian blur (sigma=2 bands = 1 semitone) to suppress tiny spikes
			{
				const blurred = new Float32Array(BG_BANDS);
				for (let b = 0; b < BG_BANDS; b++) {
					let sum = 0,
						wSum = 0;
					for (let n = 0; n < BG_BANDS; n++) {
						const d = n - b;
						const w = Math.exp((-0.5 * d * d) / 4);
						sum += bgMags[n] * w;
						wSum += w;
					}
					blurred[b] = wSum > 0.001 ? sum / wSum : 0;
				}
				for (let b = 0; b < BG_BANDS; b++) bgMags[b] = blurred[b];
			}
			// Per-band decay
			for (let b = 0; b < BG_BANDS; b++) {
				if (bgMags[b] > this._bgSmoothMags[b]) {
					this._bgSmoothMags[b] = bgMags[b];
				} else {
					this._bgSmoothMags[b] = this._bgSmoothMags[b] * 0.31 + bgMags[b] * 0.69;
				}
			}
			// Per-band decay for FG only
			for (let b = 0; b < FG_BANDS; b++) {
				if (fgMags[b] > this._fgSmoothMags[b]) {
					this._fgSmoothMags[b] = fgMags[b]; // instant attack
				} else {
					this._fgSmoothMags[b] = this._fgSmoothMags[b] * 0.55 + fgMags[b] * 0.45;
				}
			}

			const h = this.canvas.height;
			const w = this.canvas.width;
			this._computeYPositions(
				h,
				this._bgSmoothMags,
				spectrumCanvas.BG_REF,
				BG_BANDS,
				this._bgYs,
				1.0,
			);
			this._computeYPositions(
				h,
				this._fgSmoothMags,
				spectrumCanvas.FG_REF,
				FG_BANDS,
				this._fgYs,
				1.0,
			);
			if (this.showParticles) {
				this._updateParticles(h);
				this._spawnParticles(w, impulse);
			} else {
				this._particles.length = 0;
			}
			this._hasValidFrame = true;
			this._paintRetainedFrame(this.showParticles, false);
		};

		events.listen("spectrumUpdate", this._EventUpdateCanvas);
		events.listen("spectrumReset", this._onSpectrumReset);
		events.listen("themeChange", this._onThemeChange);
		this._ownerWindow?.addEventListener("resize", this._onResize);
	}

	private readonly _onSpectrumReset = (): void => {
		this.reset();
	};

	private readonly _onThemeChange = (): void => {
		if (this._disposed) return;
		this._updateCachedColors();
		for (const particle of this._particles) {
			particle.color =
				particle.colorRole === "left" ? this._cachedLColor : this._cachedRColor;
		}
		if (this._hasValidFrame) this._paintRetainedFrame(this.showParticles);
	};

	private readonly _onResize = (): void => {
		if (this._disposed || !this._resizeBackingStore()) return;
		this._computeRetainedYPositions();
		if (this._hasValidFrame) this._paintRetainedFrame(this.showParticles, false);
	};

	private _resizeBackingStore(): boolean {
		const pixelRatio = this._ownerWindow?.devicePixelRatio ?? 1;
		const displayW = Math.round(this.canvas.clientWidth * pixelRatio);
		const displayH = Math.round(this.canvas.clientHeight * pixelRatio);
		if (this.canvas.width === displayW && this.canvas.height === displayH) return false;
		this.canvas.width = displayW;
		this.canvas.height = displayH;
		return true;
	}

	private _computeRetainedYPositions(): void {
		const h = this.canvas.height;
		this._computeYPositions(
			h,
			this._bgSmoothMags,
			spectrumCanvas.BG_REF,
			BG_BANDS,
			this._bgYs,
			1.0,
		);
		this._computeYPositions(
			h,
			this._fgSmoothMags,
			spectrumCanvas.FG_REF,
			FG_BANDS,
			this._fgYs,
			1.0,
		);
	}

	private _paintRetainedFrame(drawParticles: boolean, resize = true): void {
		const ctx = this.canvas.getContext("2d");
		if (ctx === null) return;
		if (resize && this._resizeBackingStore()) this._computeRetainedYPositions();
		const w = this.canvas.width;
		const h = this.canvas.height;
		if (!this.transparentBg) {
			ctx.fillStyle = this._cachedBgColor;
			ctx.fillRect(0, 0, w, h);
		} else {
			ctx.clearRect(0, 0, w, h);
		}
		this._drawSmooth(
			ctx,
			w,
			h,
			this._bgSmoothMags,
			spectrumCanvas.BG_REF,
			BG_BANDS,
			this._cachedRColor,
			0.4,
			1.0,
		);
		this._drawSmooth(
			ctx,
			w,
			h,
			this._fgSmoothMags,
			spectrumCanvas.FG_REF,
			FG_BANDS,
			this._cachedLColor,
			1.0,
			1.0,
		);
		if (drawParticles) this._drawParticles(ctx);
	}

	private _computeYPositions(
		h: number,
		mags: Float32Array,
		maxMag: number,
		bandCount: number,
		out: Float64Array,
		heightScale: number,
	): void {
		for (let b = 0; b < bandCount; b++) {
			out[b] = h - Math.min(1, (2 * mags[b]) / (mags[b] + maxMag)) * h * heightScale;
		}
	}

	private _drawSmooth(
		ctx: CanvasRenderingContext2D,
		w: number,
		h: number,
		mags: Float32Array,
		maxMag: number,
		bandCount: number,
		color: string,
		opacity: number,
		heightScale: number,
	): void {
		const bandWidth = w / (bandCount - 1);
		const ys = new Array<number>(bandCount);
		for (let b = 0; b < bandCount; b++) {
			ys[b] = h - Math.min(1, (2 * mags[b]) / (mags[b] + maxMag)) * h * heightScale;
		}

		ctx.globalAlpha = opacity;

		// Simple quadratic bezier: data points as control, midpoints as endpoints
		ctx.beginPath();
		ctx.moveTo(0, h);
		ctx.lineTo(0, ys[0]);
		for (let b = 0; b < bandCount - 1; b++) {
			const x1 = b * bandWidth;
			const x2 = (b + 1) * bandWidth;
			ctx.quadraticCurveTo(x1, ys[b], (x1 + x2) / 2, (ys[b] + ys[b + 1]) / 2);
		}
		ctx.lineTo(w, ys[bandCount - 1]);
		ctx.lineTo(w, h);
		ctx.closePath();
		ctx.fillStyle = color;
		ctx.fill();
		ctx.globalAlpha = 1.0;
	}

	private _updateParticles(h: number): void {
		for (let i = this._particles.length - 1; i >= 0; i--) {
			const p = this._particles[i];
			p.x += p.vx;
			p.y += p.vy;
			p.vy += 0.006;
			p.life--;
			// Remove when out of viewport (top is canvas top, -50 buffer)
			if (p.life <= 0 || p.y > h + 10 || p.y < -50) {
				this._particles.splice(i, 1);
			}
		}
	}

	private _spawnParticles(w: number, impulse: number): void {
		if (this._particles.length >= MAX_PARTICLES) return;

		// Spawn from FG bands (L color)
		const fgBandCount = FG_BANDS;
		const fgBandWidth = w / (fgBandCount - 1);
		for (let b = 0; b < fgBandCount; b++) {
			const mag = this._fgSmoothMags[b];
			if (mag < 0.001) continue;
			const normMag = (2 * mag) / (mag + spectrumCanvas.FG_REF);
			if (normMag > 0.08 && Math.random() < normMag * (0.5 + impulse * 0.3)) {
				const x = b * fgBandWidth + (Math.random() - 0.5) * fgBandWidth * 0.8;
				const y = this._fgYs[b] + (Math.random() - 0.5) * 6;
				this._particles.push(
					spawnParticle(x, y, normMag, impulse, this._cachedLColor, "left"),
				);
				if (this._particles.length >= MAX_PARTICLES) return;
			}
		}

		// Spawn from BG bands (R color, lower spawn rate)
		const bgBandCount = BG_BANDS;
		const bgBandWidth = w / (bgBandCount - 1);
		for (let b = 0; b < bgBandCount; b++) {
			const mag = this._bgSmoothMags[b];
			if (mag < 0.001) continue;
			const normMag = (2 * mag) / (mag + spectrumCanvas.BG_REF);
			if (normMag > 0.1 && Math.random() < normMag * 0.25) {
				const x = b * bgBandWidth + (Math.random() - 0.5) * bgBandWidth * 0.5;
				const y = this._bgYs[b] + (Math.random() - 0.5) * 4;
				this._particles.push(
					spawnParticle(x, y, normMag, impulse, this._cachedRColor, "right"),
				);
				if (this._particles.length >= MAX_PARTICLES) return;
			}
		}
	}

	private _drawParticles(ctx: CanvasRenderingContext2D): void {
		ctx.save();
		for (const p of this._particles) {
			const t = p.life / p.maxLife;
			const alpha = Math.min(1, t * 3) * (1 - t * 0.5);
			const radius = p.size * (0.4 + 0.6 * t);
			ctx.globalAlpha = alpha;
			ctx.fillStyle = p.color;
			ctx.beginPath();
			ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
			ctx.fill();
		}
		ctx.restore();
	}

	private _initBands(sampleRate: number): void {
		this._sampleRate = sampleRate;
		// Compute BG center frequencies: every 2nd semitone from BG_MIN_FREQ (~20Hz)
		this._bgFreqs.length = 0;
		const bgA4 = 440;
		const bgNoteStart = Math.round(12 * Math.log2(20 / bgA4) + 69);
		// Every quarter-tone (24TET): 67 bands from ~20Hz to ~130Hz
		for (let b = 0; b < BG_BANDS; b++) {
			this._bgFreqs.push(bgA4 * 2 ** ((bgNoteStart + b * 0.5 - 69) / 12));
		}
		// Every quarter-tone (24TET): 151 bands from ~130Hz to ~10000Hz
		this._fgFreqs.length = 0;
		const fgNoteStart = Math.round(12 * Math.log2(130 / 440) + 69);
		for (let b = 0; b < FG_BANDS; b++) {
			this._fgFreqs.push(440 * 2 ** ((fgNoteStart + b * 0.5 - 69) / 12));
		}
	}

	public reset(): void {
		this._hasValidFrame = false;
		this._fgSmoothMags.fill(0);
		this._bgSmoothMags.fill(0);
		// Clear the background ring buffer so the next FFT doesn't
		// reconstruct stale magnitudes from paused audio.
		this._bgRingBuf.fill(0);
		this._bgRingPos = 0;
		this._particles.length = 0;
		// Clear canvas immediately so the last frame doesn't persist
		// (spectrumUpdate stops firing when paused).
		const ctx = this.canvas.getContext("2d");
		if (ctx) {
			if (!this.transparentBg) {
				ctx.fillStyle = this._cachedBgColor;
				ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
			} else {
				ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
			}
		}
	}

	public dispose(): void {
		if (this._disposed) return;
		this._disposed = true;
		events.unlisten("spectrumUpdate", this._EventUpdateCanvas);
		events.unlisten("spectrumReset", this._onSpectrumReset);
		events.unlisten("themeChange", this._onThemeChange);
		this._ownerWindow?.removeEventListener("resize", this._onResize);
	}

	private _updateCachedColors(): void {
		this._cachedBgColor = ColorConfig.getComputed("--editor-background") || "black";
		this._cachedLColor = ColorConfig.getComputed("--spectrum-line-L") || "white";
		this._cachedRColor =
			ColorConfig.getComputed("--spectrum-line-R") || "rgba(119,68,255,0.99)";
	}
}
