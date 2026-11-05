// FrameScheduler
//
// Purpose: Owns the single requestAnimationFrame loop for editor per-frame callbacks and notifier flushes
//
// This module:
// - Runs registered per-frame callbacks once per frame
// - Flushes pending one-shot flush requests after the callbacks, once per frame
// - Stops the loop when nothing is registered or pending

export type FrameCallback = (timestamp: number) => void | boolean;
export type FrameRequest = (callback: (timestamp: number) => void) => unknown;
export type FrameCancel = (handle: unknown) => void;

export class FrameScheduler {
	private _callbacks: Set<FrameCallback> = new Set();
	private _flushes: Set<() => void> = new Set();
	private _handle: unknown = null;
	private _scheduled: boolean = false;

	constructor(
		private _request?: FrameRequest,
		private _cancel?: FrameCancel,
	) {}

	// Swaps the frame driver so tests that count rAF requests can exclude the shared loop.
	public configure(request?: FrameRequest, cancel?: FrameCancel): void {
		this.dispose();
		this._request = request;
		this._cancel = cancel;
	}

	// Registering the same function twice is a no-op. A callback that returns
	// false is unregistered after that frame. The returned function unregisters.
	public register(callback: FrameCallback): () => void {
		this._callbacks.add(callback);
		this._schedule();
		return () => {
			this._callbacks.delete(callback);
		};
	}

	// One-shot: runs after this frame's callbacks. Duplicate requests for the
	// same function within a frame collapse into one call.
	public requestFlush(flush: () => void): void {
		this._flushes.add(flush);
		this._schedule();
	}

	public get running(): boolean {
		return this._scheduled;
	}

	public get callbackCount(): number {
		return this._callbacks.size;
	}

	public dispose(): void {
		this._callbacks.clear();
		this._flushes.clear();
		if (this._scheduled) {
			if (this._cancel != null) {
				this._cancel(this._handle);
			} else if (typeof globalThis.cancelAnimationFrame === "function") {
				globalThis.cancelAnimationFrame(this._handle as number);
			} else {
				clearTimeout(this._handle as ReturnType<typeof setTimeout>);
			}
		}
		this._scheduled = false;
		this._handle = null;
	}

	private _schedule(): void {
		if (this._scheduled) return;
		this._scheduled = true;
		const run = (timestamp: number): void => this._frame(timestamp);
		if (this._request != null) {
			this._handle = this._request(run);
		} else if (typeof globalThis.requestAnimationFrame === "function") {
			this._handle = globalThis.requestAnimationFrame(run);
		} else {
			this._handle = setTimeout(() => run(Date.now()), 16);
		}
	}

	private _frame(timestamp: number): void {
		this._scheduled = false;
		this._handle = null;
		try {
			for (const callback of Array.from(this._callbacks)) {
				if (!this._callbacks.has(callback)) continue;
				if (callback(timestamp) === false) this._callbacks.delete(callback);
			}
			const flushes: (() => void)[] = Array.from(this._flushes);
			this._flushes.clear();
			for (const flush of flushes) flush();
		} finally {
			if (this._callbacks.size > 0 || this._flushes.size > 0) this._schedule();
		}
	}
}

export const frameScheduler: FrameScheduler = new FrameScheduler();
