// audio-backend.ts
//
// Purpose: Web Audio API lifecycle — AudioContext, AudioWorklet, SAB ring buffer
//
// This module:
// - Creates and manages AudioContext and AudioWorkletNode
// - Selects data-source mode at runtime:
//   Mode A (SAB): Lock-free SharedArrayBuffer ring buffer when
//     crossOriginIsolated is available (requires COOP/COEP headers).
//   Mode B (queue): Legacy postMessage need-data callback as fallback.
// - Fills the ring buffer proactively (rAF-driven, no need-data callback)
// - Handles AudioContext suspension/resumption on user gesture
// - Deactivates audio after a live-input timeout, unless a play request
//   is pending or inside the post-play grace window
// - Answers worklet underruns with an immediate synchronous refill

import { AudioRingBuffer } from "./audio-ring-buffer";
import { AUDIO_WORKLET_PROCESSOR_CODE } from "./audio-worklet-processor";

/** Interface for the host object that owns the audio backend. */
export interface AudioBackendHost {
	synthesize(
		outputDataL: Float32Array,
		outputDataR: Float32Array,
		outputBufferLength: number,
		playSong: boolean,
	): void;
	/** Live-read — always returns the caller's current value. */
	isPlayingSong(): boolean;
	/** Live-read — always returns the caller's current value. */
	liveInputEndTime(): number;
	/** Live-read — true during a stop fade-out so the worklet keeps running. */
	isFadingOut(): boolean;
	spectrumEnabled: boolean;
	onSpectrumUpdate: ((left: Float32Array, right: Float32Array) => void) | undefined;
	onSpectrumReset: (() => void) | undefined;
	anticipatePoorPerformance: boolean;
	preferLowerLatency: boolean;
}

export class AudioBackend {
	private audioCtx: AudioContext | null = null;
	private _workletNode: AudioWorkletNode | null = null;
	private _workletModuleUrl: string | null = null;
	/** Compute-tone worklet node (jukebox-compute-tone-processor). */
	private _computeWorkletNode: AudioWorkletNode | null = null;
	private _computeWorkletUrl: string | null = null;
	private _currentBufferSize: number = 0;
	private _ringBuffer: AudioRingBuffer | null = null;
	private _fillLoopId: number | null = null;
	private _host: AudioBackendHost | null = null;
	private _activateAudioPromise: Promise<void> | null = null;
	private _gestureListenerAdded: boolean = false;
	private _removeGestureListeners: (() => void) | null = null;
	private _playIntent: boolean = false;
	private _playGraceUntil: number = 0;
	private _underrunRecoveries: number = 0;
	private _lastSpectrumUpdateTime: number = 0;
	private _spectrumDecayStarted: boolean = false;
	private _logNeedDataCount: number = 0;
	private _underrunLogCount: number = 0;
	private _lastUnderrunLogMs: number = 0;
	private _fillInProgress: boolean = false;
	private _lastFillReason: string = "none";
	private _lastFillMs: number = 0;
	private _lastFillSlots: number = 0;
	private _lastFillFreeSlots: number = 0;
	private _lastFillReadHead: number = -1;
	private _lastFillWriteHead: number = -1;
	private _lastFillEndedByBudget: boolean = false;
	private _lastFillSynthMs: number = 0;
	private _lastFillMaxSlotMs: number = 0;
	private _lastFillQueuedSlots: number = 0;
	private _sabScratchL: Float32Array | null = null;
	private _sabScratchR: Float32Array | null = null;
	private _useSab: boolean = false;
	private static readonly SPECTRUM_UPDATE_INTERVAL_MS: number = 1000 / 60;
	private static readonly FILL_BUDGET_MS: number = 16;
	/** Window after play()/resume during which idle deactivation is suppressed. */
	public static readonly PLAY_GRACE_MS: number = 2000;
	// 8 slots gives ~7 fills of runway at 2048 samples each. Enough for
	// dense patterns where synthesize() takes up to ~7ms before the rAF
	// fill loop loses ground. Each slot is ~16KB (2048 × 2ch × 4B), total
	// ~128KB.
	private static readonly NUM_RING_SLOTS: number = 8;

	private static _readBufferSizeOverride(): number | null {
		try {
			if (typeof window === "undefined" || window.localStorage == null) return null;
			const raw: string | null = window.localStorage.getItem("audioBufferSize");
			if (raw == null) return null;
			const parsed: number = Number(raw);
			if ([512, 1024, 2048, 4096, 8192, 16384].includes(parsed)) return parsed;
		} catch {
			/* ignore */
		}
		return null;
	}

	public get isActive(): boolean {
		return this.audioCtx != null && this._workletNode != null;
	}

	public get currentBufferSize(): number {
		return this._currentBufferSize;
	}

	/** Number of worklet underruns answered with a synchronous refill. */
	public get underrunRecoveries(): number {
		return this._underrunRecoveries;
	}

	public get hasPlayIntent(): boolean {
		return this._playIntent;
	}

	/** Set synchronously at the top of play(), before isPlayingSong is
	 *  observable, so fill/need-data handlers cannot deactivate the backend
	 *  while activation and warmup are still pending. */
	public beginPlayIntent(): void {
		this._playIntent = true;
		this._playGraceUntil = performance.now() + AudioBackend.PLAY_GRACE_MS;
	}

	/** Clears the pending flag once isPlayingSong is true; the grace window
	 *  keeps covering the first fills. */
	public settlePlayIntent(): void {
		this._playIntent = false;
		this._playGraceUntil = performance.now() + AudioBackend.PLAY_GRACE_MS;
	}

	/** Drops intent and grace immediately (play failed or pause requested). */
	public cancelPlayIntent(): void {
		this._playIntent = false;
		this._playGraceUntil = 0;
	}

	/** True when nothing is playing, fading or pending and live input expired. */
	public shouldDeactivate(host: AudioBackendHost): boolean {
		if (this._playIntent) return false;
		const now: number = performance.now();
		if (now < this._playGraceUntil) return false;
		return !host.isPlayingSong() && !host.isFadingOut() && now >= host.liveInputEndTime();
	}

	public get context(): AudioContext | null {
		return this.audioCtx;
	}

	/**
	 * MessagePort for sending commands to the compute-tone worklet.
	 * Returns null if the worklet hasn't been loaded yet.
	 */
	public get computeWorkletPort(): MessagePort | null {
		return this._computeWorkletNode?.port ?? null;
	}

	/**
	 * Set the URL for the compute-tone worklet module file.
	 * Called by Synth after the build path is determined.
	 */
	public setComputeWorkletUrl(url: string): void {
		this._computeWorkletUrl = url;
	}

	private _dbg(...args: unknown[]): void {
		if (AudioBackend._debugSynthEnabled()) console.log("[AudioBackend]", ...args);
	}

	private _dbgWarn(...args: unknown[]): void {
		if (AudioBackend._debugSynthEnabled()) console.warn("[AudioBackend]", ...args);
	}

	private _logUnderrun(msg: Record<string, unknown>): void {
		this._underrunLogCount++;
		const now: number = performance.now();
		if (now - this._lastUnderrunLogMs < 1000 && this._underrunLogCount > 3) return;
		this._lastUnderrunLogMs = now;
		console.warn(
			"[AudioBackend] underrun #" +
				this._underrunLogCount +
				" mode=" +
				String(msg.mode) +
				" workletCount=" +
				String(msg.count) +
				" bufferSize=" +
				this._currentBufferSize +
				" fillInProgress=" +
				this._fillInProgress +
				" lastFill=" +
				this._lastFillReason +
				" slots=" +
				this._lastFillSlots +
				"/" +
				this._lastFillFreeSlots +
				" ms=" +
				this._lastFillMs.toFixed(1) +
				" budgetStop=" +
				this._lastFillEndedByBudget +
				" synthMs=" +
				this._lastFillSynthMs.toFixed(1) +
				" maxSlotMs=" +
				this._lastFillMaxSlotMs.toFixed(1) +
				" queued=" +
				this._lastFillQueuedSlots +
				" heads=" +
				this._lastFillReadHead +
				"→" +
				this._lastFillWriteHead +
				" ctx=" +
				(this.audioCtx?.state ?? "none"),
		);
	}

	public static _debugSynthEnabled(): boolean {
		try {
			if (typeof window === "undefined") return false;
			const w = window as any;
			if (w.debugSynth === "1" || w.debugSynth === "true") return true;
			if (window.localStorage) {
				const v = window.localStorage.getItem("debugSynth");
				if (v === "1" || v === "true") return true;
			}
		} catch {
			/* ignore */
		}
		return false;
	}

	public activate(host: AudioBackendHost): Promise<void> {
		if (this._activateAudioPromise != null) {
			this._dbg("activate: returning existing in-progress promise");
			return this._activateAudioPromise;
		}
		this._activateAudioPromise = this._doActivate(host);
		return this._activateAudioPromise;
	}

	private async _doActivate(host: AudioBackendHost): Promise<void> {
		const configuredBufferSize: number = host.anticipatePoorPerformance
			? host.preferLowerLatency
				? 2048
				: 4096
			: host.preferLowerLatency
				? 512
				: 2048;
		const bufferSize: number = AudioBackend._readBufferSizeOverride() ?? configuredBufferSize;
		if (
			this.audioCtx != null &&
			this._workletNode != null &&
			this._currentBufferSize === bufferSize
		) {
			this._activateAudioPromise = null;
			return;
		}
		this._dbg(
			"_doActivate, bufferSize:",
			bufferSize,
			"currentBufferSize:",
			this._currentBufferSize,
		);
		try {
			if (this._workletNode != null) this.deactivate();
			const latencyHint: string = host.anticipatePoorPerformance
				? host.preferLowerLatency
					? "balanced"
					: "playback"
				: host.preferLowerLatency
					? "interactive"
					: "balanced";
			this._dbg("Creating AudioContext, latencyHint:", latencyHint);
			this.audioCtx =
				this.audioCtx ||
				new (window.AudioContext || window.webkitAudioContext)({ latencyHint });
			const ctx = this.audioCtx!;
			this._host = host;
			this._dbg("AudioContext sampleRate:", ctx.sampleRate);

			this._ensureGestureListener();
			ctx.onstatechange = () => {
				if (ctx.state === "suspended") this._ensureGestureListener();
			};

			if (this._workletModuleUrl == null) {
				const blob = new Blob([AUDIO_WORKLET_PROCESSOR_CODE], {
					type: "application/javascript",
				});
				this._workletModuleUrl = URL.createObjectURL(blob);
				this._dbg("Created worklet module blob URL");
			}
			this._dbg("Loading AudioWorklet module (output sink)...");
			await ctx.audioWorklet.addModule(this._workletModuleUrl);
			this._dbg("AudioWorklet module (output sink) loaded");

			// Load the compute-tone worklet
			if (this._computeWorkletUrl != null) {
				this._dbg("Loading compute-tone worklet module...");
				try {
					await ctx.audioWorklet.addModule(this._computeWorkletUrl);
					this._computeWorkletNode = new AudioWorkletNode(
						ctx,
						"jukebox-compute-tone-processor",
						{ outputChannelCount: [2] },
					);
					// Not connected to destination — main thread renders audio.
					// Worklet runs computeToneSnapshot for timing verification.
					// Phase 6: reconnect when worklet FM output is validated.
					this._dbg("Compute-tone worklet node created and connected to destination");
				} catch (e) {
					this._dbgWarn("Failed to load compute-tone worklet:", e);
					this._computeWorkletNode = null;
				}
			} else {
				this._dbg("No compute-tone worklet URL configured — skipping");
			}

			// Check for crossOriginIsolated (enables SharedArrayBuffer).
			this._useSab =
				typeof SharedArrayBuffer !== "undefined" &&
				typeof self !== "undefined" &&
				(self as any).crossOriginIsolated === true;
			this._dbg("crossOriginIsolated:", this._useSab);

			if (this._useSab) {
				this._ringBuffer = new AudioRingBuffer(AudioBackend.NUM_RING_SLOTS, bufferSize);
				this._dbg("SAB ring buffer allocated, slots:", AudioBackend.NUM_RING_SLOTS);
			}

			this._workletNode = new AudioWorkletNode(ctx, "beepbox-audio-worklet-processor", {
				outputChannelCount: [2],
				processorOptions: { bufferSize, debug: AudioBackend._debugSynthEnabled() },
			});
			this._dbg("AudioWorkletNode created");

			if (this._useSab) {
				// SharedArrayBuffer is already shared — do not transfer.
				// PostMessage automatically shares SABs referenced in
				// the message payload; the transfer list would throw.
				this._workletNode.port.postMessage({
					type: "init",
					sab: this._ringBuffer!.sab,
					numSlots: this._ringBuffer!.numSlots,
					headerInts: AudioRingBuffer.HEADER_INTS,
					headerBytes: this._ringBuffer!.headerBytes,
				});
				this._dbg("SAB init message sent to worklet");
			}

			// Handle need-data from worklet.
			// Queue mode: worklet sends need-data when queue runs low
			//   (primary fill). _onWorkletNeedData allocates buffers,
			//   fills them via synthesize(), sends via postMessage.
			// SAB mode: worklet sends need-data only when the ring is
			//   empty, which happens during background-tab rAF throttle.
			//   Fill the ring directly; the worklet reads it via atomic
			//   head on the next process() call.
			this._workletNode.port.onmessage = (e: MessageEvent) => {
				const msg = e.data;
				if (!msg) return;
				if (msg.type === "need-data") {
					if (this._useSab) {
						this._fillAllFreeSlotsInternal(host, false, "need-data");
					} else {
						this._onWorkletNeedData(host);
					}
				} else if (msg.type === "underrun") {
					this._logUnderrun(msg as Record<string, unknown>);
					this.recoverFromUnderrun(host);
				}
			};

			this._workletNode.connect(ctx.destination);
			this._dbg("WorkletNode connected");

			this._currentBufferSize = bufferSize;
			this._logNeedDataCount = 0;

			// Do not pre-render on activation. synthesize(playSong=false)
			// still advances tick/part transport, which made cold playback
			// begin after beat 0. play() resets the ring and starts filling
			// once isPlayingSong is true.
			if (this._useSab) {
				this._ringBuffer!.resetHeads();
			}

			this._dbg("_doActivate complete, mode:", this._useSab ? "SAB" : "queue");
		} catch (e) {
			this._dbgWarn("_doActivate failed:", e);
			this.deactivate();
			throw e;
		} finally {
			this._activateAudioPromise = null;
		}
	}

	private _ensureGestureListener(): void {
		const ctx: AudioContext | null = this.audioCtx;
		if (ctx == null || ctx.state !== "suspended" || this._gestureListenerAdded) return;
		this._gestureListenerAdded = true;
		const remove = (): void => {
			window.removeEventListener("click", resume);
			window.removeEventListener("keydown", resume);
			this._removeGestureListeners = null;
			this._gestureListenerAdded = false;
		};
		const resume = (): void => {
			remove();
			if (this.audioCtx && this.audioCtx.state === "suspended") {
				this.audioCtx.resume().then(() => {
					this._dbg("AudioContext resumed via user gesture");
				});
			}
		};
		window.addEventListener("click", resume);
		window.addEventListener("keydown", resume);
		this._removeGestureListeners = remove;
		this._dbg("Added one-time gesture listener");
	}

	public async resumeContext(): Promise<void> {
		if (this.audioCtx && this.audioCtx.state === "suspended") {
			this._playGraceUntil = Math.max(
				this._playGraceUntil,
				performance.now() + AudioBackend.PLAY_GRACE_MS,
			);
			try {
				await this.audioCtx.resume();
				this._dbg("AudioContext resumed, state:", this.audioCtx.state);
			} catch (_e) {
				this._ensureGestureListener();
			}
		}
	}

	public deactivate(): void {
		this._dbg("deactivate called");
		this._cancelFillLoop();
		this._removeGestureListeners?.();
		if (this._workletNode != null && this.audioCtx != null) {
			this._dbg("Disconnecting worklet node...");
			this._workletNode.port.postMessage({ type: "stop" });
			// Guard: node may have been created but not yet connected
			// (error in _doActivate between create and connect).
			try {
				this._workletNode.disconnect(this.audioCtx.destination);
			} catch {
				this._dbg("disconnect failed (node not connected)");
			}
			this._workletNode = null;
		}
		// Clean up compute-tone worklet node
		if (this._computeWorkletNode != null) {
			this._computeWorkletNode.port.postMessage({ type: "stop" });
			// Disconnect from destination if connected
			try {
				if (this.audioCtx != null) {
					this._computeWorkletNode.disconnect(this.audioCtx.destination);
				}
			} catch {
				this._dbg("compute worklet disconnect failed (already disconnected)");
			}
			this._computeWorkletNode = null;
		}
		if (this.audioCtx != null) {
			this.audioCtx.onstatechange = null;
			if (this.audioCtx.close) {
				this._dbg("Closing AudioContext...");
				this.audioCtx.close();
			}
			this.audioCtx = null;
		}
		this._ringBuffer = null;
		this._sabScratchL = null;
		this._sabScratchR = null;
		this._fillInProgress = false;
		this._host = null;
		this._currentBufferSize = 0;
		this._gestureListenerAdded = false;
		this._activateAudioPromise = null;
		this._dbg("Audio deactivated");
	}

	public startSpectrumDecay(host: AudioBackendHost): void {
		if (this._spectrumDecayStarted) return;
		this._spectrumDecayStarted = true;
		if (host.onSpectrumReset) host.onSpectrumReset();
	}

	public cancelSpectrumDecay(): void {
		// placeholder for future RAF-based decay
	}

	/** Discards queued SAB audio without rendering new samples.
	 *  Used on play() to drop activation-time silence so the visible
	 *  playhead does not compensate for audio that will never be heard. */
	public resetRingForPlayback(): void {
		if (!this._useSab || this._ringBuffer == null) return;
		this._ringBuffer.resetHeads();
		if (this._fillLoopId == null) {
			this._fillLoopId = requestAnimationFrame(this._onFillFrame);
		}
	}

	/** Synchronously fills all free ring-buffer slots (SAB mode only).
	 *  Queue mode is a no-op. First call (after isPlayingSong=true)
	 *  starts the rAF fill loop. */
	public fillAllFreeSlots(host: AudioBackendHost, playSong?: boolean, maxSlots?: number): void {
		if (!this._useSab || this._ringBuffer == null) return;
		this._ringBuffer.resetHeads();
		// noBudget=true fills synchronously without the 16ms budget
		// stop. When playSong is provided, use it explicitly (allows
		// pre-fill before the host sets isPlayingSong=true).
		this._fillAllFreeSlotsInternal(host, true, "manual", true, playSong, maxSlots);
		if (this._fillLoopId == null) {
			this._fillLoopId = requestAnimationFrame(this._onFillFrame);
		}
	}

	/** Answers a worklet underrun with an immediate synchronous refill of
	 *  every free slot. Heads are not reset, so queued audio is kept. SAB
	 *  mode only; queue mode keeps its need-data path. */
	public recoverFromUnderrun(host: AudioBackendHost): void {
		this._underrunRecoveries++;
		if (!this._useSab || this._ringBuffer == null) return;
		if (!this._playIntent && !host.isPlayingSong() && !host.isFadingOut()) return;
		this._fillAllFreeSlotsInternal(host, true, "underrun", true, host.isPlayingSong());
	}

	// ── Queue mode (legacy need-data callback) ──

	private _onWorkletNeedData(host: AudioBackendHost): void {
		this._logNeedDataCount++;
		const isPlayingSong: boolean = host.isPlayingSong();
		if (this._logNeedDataCount <= 5 || this._logNeedDataCount % 100 === 0) {
			this._dbg(`need-data #${this._logNeedDataCount}, isPlayingSong:`, isPlayingSong);
		}

		if (this.shouldDeactivate(host)) {
			this.deactivate();
			return;
		}

		// Guard: deactivate() may have been called while this need-data
		// message was in flight, setting _currentBufferSize to 0. If we
		// proceed with bufferSize=0, budget becomes 0ms and every render
		// exceeds it, cascading into hundreds of audio stutter warnings.
		if (this._currentBufferSize <= 0) {
			if (this._logNeedDataCount <= 5 || this._logNeedDataCount % 100 === 0) {
				this._dbg("need-data skipped: _currentBufferSize is 0");
			}
			return;
		}

		const left = new Float32Array(this._currentBufferSize);
		const right = new Float32Array(this._currentBufferSize);
		host.synthesize(left, right, this._currentBufferSize, isPlayingSong);

		if (host.spectrumEnabled) {
			const now = performance.now();
			if (now - this._lastSpectrumUpdateTime >= AudioBackend.SPECTRUM_UPDATE_INTERVAL_MS) {
				if (host.onSpectrumUpdate) host.onSpectrumUpdate(left, right);
				this._lastSpectrumUpdateTime = now;
			}
		}

		if (this._workletNode != null) {
			this._workletNode.port.postMessage({ type: "audio", left, right }, [
				left.buffer,
				right.buffer,
			] as any);
		}
	}

	// ── SAB mode (rAF-driven fill loop) ──

	private _onFillFrame = (): void => {
		this._fillLoopId = requestAnimationFrame(this._onFillFrame);
		const host: AudioBackendHost | null = this._host;
		if (host != null && this._ringBuffer != null) {
			this._fillAllFreeSlotsInternal(host, false, "raf");
		}
	};

	private _cancelFillLoop(): void {
		if (this._fillLoopId != null) {
			cancelAnimationFrame(this._fillLoopId);
			this._fillLoopId = null;
		}
	}

	/** Core fill — writes into all free SAB ring slots.
	 *  @param host - the backend host
	 *  @param skipDeactivate - when true, skips the deactivation check
	 *    (used during _doActivate before play() has set isPlayingSong).
	 *  @param noBudget - when true, fill ALL free slots without the 16ms
	 *    budget stop (used during pre-fill on unpause). */
	private _fillAllFreeSlotsInternal(
		host: AudioBackendHost,
		skipDeactivate: boolean,
		reason: string,
		noBudget?: boolean,
		playSongOverride?: boolean,
		maxSlots?: number,
	): void {
		const ring: AudioRingBuffer = this._ringBuffer!;
		if (ring == null) return;

		if (!skipDeactivate) {
			if (this.shouldDeactivate(host)) {
				this._dbg("No playback, no fade, no live input — deactivating");
				this.deactivate();
				return;
			}
		}

		// Guard: _currentBufferSize may be 0 if deactivate() was called
		// from another handler between the ring-null check above and here.
		// Prevents budget=0.0ms renders that cascade into stutters.
		if (this._currentBufferSize <= 0) {
			if (AudioBackend._debugSynthEnabled()) {
				console.log("[AudioBackend] fill skipped: _currentBufferSize is 0");
			}
			return;
		}

		const writeHead: number = ring.loadWriteHead();
		const readHead: number = ring.loadReadHead();

		// Free slots = total - 1 safety margin - slots consumed
		const diff: number = writeHead - readHead;
		const freeSlots: number = Math.min(ring.numSlots - 1 - diff, ring.numSlots);
		const slotsToFill: number =
			maxSlots == null ? freeSlots : Math.max(0, Math.min(freeSlots, maxSlots));
		if (slotsToFill <= 0) return;

		if (this._sabScratchL == null || this._sabScratchL.length !== this._currentBufferSize) {
			this._sabScratchL = new Float32Array(this._currentBufferSize);
			this._sabScratchR = new Float32Array(this._currentBufferSize);
		}
		const left: Float32Array = this._sabScratchL;
		const right: Float32Array = this._sabScratchR!;
		const fillStart: number = performance.now();
		let synthMs: number = 0;
		let maxSlotMs: number = 0;
		let filledSlots: number = 0;
		let endedByBudget: boolean = false;
		this._fillInProgress = true;
		for (let i: number = 0; i < slotsToFill; i++) {
			const slotStart: number = performance.now();
			const slot: number = writeHead + 1 + i;
			left.fill(0.0);
			right.fill(0.0);
			const synthStart: number = performance.now();
			const playSong: boolean =
				playSongOverride ??
				(noBudget ? host.isPlayingSong() : skipDeactivate ? false : host.isPlayingSong());
			host.synthesize(left, right, this._currentBufferSize, playSong);
			synthMs += performance.now() - synthStart;

			ring.writeSlot(slot, left, right);
			ring.publishWriteHead(slot);

			filledSlots++;

			if (i === 0 && host.spectrumEnabled) {
				const now: number = performance.now();
				if (
					now - this._lastSpectrumUpdateTime >=
					AudioBackend.SPECTRUM_UPDATE_INTERVAL_MS
				) {
					if (host.onSpectrumUpdate) host.onSpectrumUpdate(left, right);
					this._lastSpectrumUpdateTime = now;
				}
			}

			const slotMs: number = performance.now() - slotStart;
			if (slotMs > maxSlotMs) maxSlotMs = slotMs;
			if (
				!skipDeactivate &&
				!noBudget &&
				filledSlots > 0 &&
				performance.now() - fillStart > AudioBackend.FILL_BUDGET_MS
			) {
				endedByBudget = true;
				break;
			}
		}
		this._fillInProgress = false;
		this._lastFillReason = reason;
		this._lastFillMs = performance.now() - fillStart;
		this._lastFillSlots = filledSlots;
		this._lastFillFreeSlots = freeSlots;
		this._lastFillReadHead = readHead;
		this._lastFillWriteHead = writeHead;
		this._lastFillEndedByBudget = endedByBudget;
		this._lastFillSynthMs = synthMs;
		this._lastFillMaxSlotMs = maxSlotMs;
		this._lastFillQueuedSlots = Math.max(0, writeHead + filledSlots - readHead);
	}

	/** Number of samples sitting in the SAB ring between the writer
	 *  (producer) and the reader (worklet). Used by the synth to compute
	 *  the audible playhead (render head minus queued audio), since
	 *  `playheadInternal` is the producer position and runs ahead of
	 *  what the user actually hears by exactly this amount. */
	public getQueuedSampleCount(): number {
		if (this._ringBuffer == null || this._currentBufferSize <= 0) return 0;
		const ring: AudioRingBuffer = this._ringBuffer;
		const diff: number = Math.max(0, ring.loadWriteHead() - ring.loadReadHead());
		return diff * this._currentBufferSize;
	}
}
