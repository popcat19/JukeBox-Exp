// player-animator.ts
//
// Purpose: Drives animation-frame loop for playback UI updates
//
// This module:
// - Runs requestAnimationFrame loop for mod sliders, filters, playhead, and volume bar

import type { BarScrollBar } from "../components/bar-scroll-bar";
import type { FilterEditor } from "../components/filter-editor";
import type { SongDocument } from "../song-document";
import { frameScheduler } from "./frame-scheduler";

const BAR_LABEL_THROTTLE = 5; // avoid text reflow every rAF

function formatTime(seconds: number): string {
	const mins = Math.floor(seconds / 60);
	const secs = Math.floor(seconds % 60);
	return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export class PlayerAnimator {
	public outVolumeHistoricTimer: number = 0;
	public outVolumeHistoricCap: number = 0;
	public lastOutVolumeCap: number = 0;
	private _barLabelCounter: number = 0;
	private _cachedDuration: number = -1;
	private _cachedBarCount: number = -1;
	private _cachedGeneration: number = -1;

	constructor(
		private _doc: SongDocument,
		private _callbacks: {
			modSliderUpdate(): void;
			getCtrlHeld(): boolean;
			getShiftHeld(): boolean;
			eqFilterEditor: FilterEditor;
			noteFilterEditor: FilterEditor;
			songEqFilterEditor: FilterEditor;
			barScrollBar: BarScrollBar;
			outVolumeBar: SVGElement;
			outVolumeCap: SVGElement;
			barPosLabel: HTMLSpanElement;
		},
	) {}

	public animate = (): boolean => {
		this._callbacks.modSliderUpdate();
		if (this._doc.prefs.displayVolumeBar) {
			this.volumeUpdate();
		}
		this._callbacks.barScrollBar.animatePlayhead();

		// Update bar position label with elapsed time (throttled)
		this._barLabelCounter--;
		if (this._barLabelCounter <= 0) {
			this.updateBarLabel();
		}

		// Center-follow: scroll so playhead stays near middle of viewport
		if (this._doc.prefs.centerFollow && this._doc.synth.playing) {
			this._centerFollowScroll();
		}

		const ctrlShift = this._callbacks.getCtrlHeld() || this._callbacks.getShiftHeld();
		if (
			this._doc.synth.isFilterModActive(
				false,
				this._doc.channel,
				this._doc.getCurrentInstrument(),
			)
		) {
			this._callbacks.eqFilterEditor.render(true, ctrlShift);
		}
		if (
			this._doc.synth.isFilterModActive(
				true,
				this._doc.channel,
				this._doc.getCurrentInstrument(),
			)
		) {
			this._callbacks.noteFilterEditor.render(true, ctrlShift);
		}
		if (this._doc.synth.isFilterModActive(false, 0, 0, true)) {
			this._callbacks.songEqFilterEditor.render(true, ctrlShift);
		}

		// Self-gate: every per-frame task above only produces a visible
		// change while audio is moving (synth.playing drives playhead,
		// volume bar, mod sliders, center-follow, and filter mod
		// overlays; synth.recording / doc.recordingModulators cover the
		// recording paths). When none hold, this frame was the settle
		// pass, modSliderUpdate's !playing branch already cleared mod
		// sliders and _hasActiveModSliders, so stop rescheduling to free
		// rAF while paused. start() re-arms the loop on the next play.
		const keepRunning: boolean =
			this._doc.synth.playing ||
			this._doc.synth.fadingOut ||
			this._doc.synth.recording ||
			this._doc.recordingModulators;
		if (!keepRunning) this._running = false;
		return keepRunning;
	};

	// Arm the animation loop. Idempotent: no-op when already running.
	// SongPerformance's rAF observer calls this on the rising edge of
	// synth.playing so every play entry point (togglePlay, keyboard,
	// CVV play, autoplay) is covered without wiring each one.
	public start = (): void => {
		if (this._running) return;
		this._running = true;
		frameScheduler.register(this.animate);
	};
	private _running: boolean = false;

	// Scroll to keep playhead centered, clamped at song edges
	private _centerFollowScroll(): void {
		const playhead = Math.floor(this._doc.synth.playhead);
		const visible = this._doc.trackVisibleBars;
		if (visible <= 0) return;
		const target = Math.max(
			0,
			Math.min(this._doc.song.barCount - visible, playhead - Math.floor(visible / 2)),
		);
		if (target !== this._doc.barScrollPos) {
			this._doc.barScrollPos = target;
			this._doc.notifier.changed();
		}
	}

	// Immediately update the bar position label, bypassing the throttle.
	// Called when [ or ] jumps the playhead so the label stays accurate
	// during playback without waiting for the next throttle cycle.
	public forceBarLabelUpdate(): void {
		this.updateBarLabel();
	}

	private updateBarLabel(): void {
		this._barLabelCounter = BAR_LABEL_THROTTLE;
		const bar = Math.floor(this._doc.synth.playhead) + 1;
		const total = this._doc.song.barCount;
		const generation = this._doc.notifier.generation;
		if (
			this._cachedDuration < 0 ||
			this._doc.song.barCount !== this._cachedBarCount ||
			generation !== this._cachedGeneration
		) {
			const totalSamples = this._doc.synth.getTotalSamples(true, true, 0);
			this._cachedDuration =
				totalSamples > 0 ? totalSamples / this._doc.synth.samplesPerSecond : 0;
			this._cachedBarCount = this._doc.song.barCount;
			this._cachedGeneration = generation;
		}
		const elapsed = this._doc.synth.totalSamplesRendered / this._doc.synth.samplesPerSecond;
		const elapsedStr = formatTime(elapsed);
		const totalStr = formatTime(this._cachedDuration);
		this._callbacks.barPosLabel.textContent = `${elapsedStr} / ${totalStr}  -  ${bar}/${total}`;
	}

	public volumeUpdate = (): void => {
		// Post-limiter sample peak (song.outVolumeCap), same source as the limiter
		// prompt's Out meter. Peak reacts to kicks/transients and matches the actual
		// output sample level.
		const level = this._doc.song.outVolumeCap;
		this.outVolumeHistoricTimer--;
		if (this.outVolumeHistoricTimer <= 0) {
			this.outVolumeHistoricCap -= 0.03;
		}
		if (level > this.outVolumeHistoricCap) {
			this.outVolumeHistoricCap = level;
			this.outVolumeHistoricTimer = 50;
		}

		if (level !== this.lastOutVolumeCap) {
			this.lastOutVolumeCap = level;
			this._callbacks.outVolumeBar.setAttribute("width", `${Math.min(144, level * 144)}`);
			this._callbacks.outVolumeCap.setAttribute(
				"x",
				`${8 + Math.min(144, this.outVolumeHistoricCap * 144)}`,
			);
		}
	};
}
