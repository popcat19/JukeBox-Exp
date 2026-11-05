// ChangeNotifier
//
// Purpose: Implements observer pattern for notifying editor components of state changes
//
// This module:
// - Tracks dirty state and registered watchers
// - Batches and dispatches change notifications
// - Schedules a flush on the shared frame scheduler whenever changed() is called

// Copyright (c) 2012-2022 John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

import { type FrameScheduler, frameScheduler } from "./frame-scheduler";

export class ChangeNotifier {
	// While this returns false the frame flush defers and retries next frame.
	public flushGate: () => boolean = () => true;
	constructor(private _scheduler: FrameScheduler = frameScheduler) {}

	private _watchers: (() => void)[] = [];
	private _dirty: boolean = false;
	private _generation: number = 0;

	public watch(watcher: () => void): void {
		if (this._watchers.indexOf(watcher) === -1) {
			this._watchers.push(watcher);
		}
	}

	public unwatch(watcher: () => void): void {
		const index: number = this._watchers.indexOf(watcher);
		if (index !== -1) {
			this._watchers.splice(index, 1);
		}
	}

	public changed(): void {
		this._dirty = true;
		this._generation++;
		this._scheduler.requestFlush(this._frameFlush);
	}

	private _frameFlush = (): void => {
		if (!this._dirty) return;
		if (!this.flushGate()) {
			this._scheduler.requestFlush(this._frameFlush);
			return;
		}
		this.notifyWatchers();
	};

	// Monotonic counter incremented on every change(). Lets rAF-driven
	// consumers detect that something changed even after notifyWatchers()
	// clears the dirty flag, without watching the notifier directly.
	public get generation(): number {
		return this._generation;
	}

	public notifyWatchers(): void {
		if (!this._dirty) return;
		this._dirty = false;
		for (const watcher of this._watchers.concat()) {
			watcher();
		}
	}
}
