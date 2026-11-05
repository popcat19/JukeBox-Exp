// SongDocument
//
// Purpose: Central song document model managing undo history, synth, and editor state
//
// This module:
// - Manages song data, undo/redo history (delegated to HistoryManager), and change tracking
// - Coordinates synth playback and editor selection state
// - Handles URL persistence and song recovery

// Copyright (c) 2012-2022 John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

import { ColorConfig } from "../shared/color-config";
import { events } from "../shared/events";
import { type Channel, type Instrument, type Pattern, Song, SongDataError, Synth } from "../synth";
import { Config } from "../synth/synth-config";
import {
	type ChangeHoldingModRecording,
	ChangeSong,
	discardInvalidPatternInstruments,
	setDefaultInstruments,
} from "./changes";
import { isMobile } from "./config/editor-config";
import type { Change } from "./core/change";
import { ChangeNotifier } from "./core/change-notifier";
import {
	BrowserHistoryManager,
	type HistoryManager,
	type HistoryState,
} from "./core/history-manager";
import { Preferences } from "./core/preferences";
import { Selection } from "./core/selection";
import { SongPerformance } from "./core/song-performance";
import { errorAlert, generateUid, SongRecovery } from "./io/song-recovery";

import { createCustomSampleHandler, decodeEditorSong } from "./song-custom-samples";
import { Layout } from "./ui";

export class SongDocument {
	public colorTheme: string;
	public song: Song;
	public synth: Synth;
	public performance: SongPerformance;
	public readonly notifier: ChangeNotifier = new ChangeNotifier();
	public readonly selection: Selection = new Selection(this);
	public readonly prefs: Preferences = new Preferences();
	public channel: number = 0;
	public muteEditorChannel: number = 0;
	public bar: number = 0;
	public recalcChannelNames: boolean;
	public recentPatternInstruments: number[][] = [];
	public viewedInstrument: number[] = [];
	public recordingModulators: boolean = false;
	public continuingModRecordingChange: ChangeHoldingModRecording | null = null;

	public trackVisibleBars: number = 16;
	public trackVisibleChannels: number = 4;
	public barScrollPos: number = 0;
	public channelScrollPos: number = 0;
	private _prompt: string | null = null;
	public get prompt(): string | null {
		return this._prompt;
	}
	public set prompt(value: string | null) {
		if (this._prompt !== value) {
			this._prompt = value;
			this.notifier.changed();
		}
	}

	public addedEffect: boolean = false;
	public addedEnvelope: boolean = false;
	public currentPatternIsDirty: boolean = false;
	public modRecordingHandler: () => void;

	private _history: HistoryManager;
	private _recoveryUid: string;
	private _recentChange: Change | null = null;
	private _sequenceNumber: number = 0;
	private _stateShouldBePushed: boolean = false;
	private _recordedNewSong: boolean = false;
	public _waitingToUpdateState: boolean = false;

	constructor() {
		this.notifier.flushGate = () => !this.recordingModulators;
		this.notifier.watch(this._validateDocState);

		ColorConfig.setTheme(this.prefs.colorTheme);
		Layout.setLayout(this.prefs.layout);

		this._history = new BrowserHistoryManager(() => this.prefs.displayBrowserUrl);

		let songString: string = window.location.hash;
		if (songString === "") {
			songString = this._history.getHash();
		}
		let retainRawHistoryEntry: boolean = false;
		try {
			this.song = decodeEditorSong(songString, createCustomSampleHandler());
			if (songString === "" || songString === undefined) {
				setDefaultInstruments(this.song);
				this.song.scale = this.prefs.defaultScale;
			}
		} catch (error) {
			if (!(error instanceof SongDataError)) throw error;
			retainRawHistoryEntry =
				SongRecovery.quarantine("hash", songString, this._history.getState(), error) ==
				null;
			errorAlert(error);
			this.song = new Song();
			this.song.customSampleHandler = createCustomSampleHandler();
			setDefaultInstruments(this.song);
		}
		const loadedSongString: string = this.song.toBase64String();
		this.synth = new Synth(this.song);
		this.synth.onSpectrumUpdate = (l, r) => {
			events.raise("spectrumUpdate", l, r);
		};
		this.synth.onSpectrumReset = () => {
			events.raise("spectrumReset");
		};
		this.synth.volume = this._calcVolume();
		this.synth.anticipatePoorPerformance = isMobile;
		if (!this.prefs.loopEnabled) this.synth.loopRepeatCount = 0;

		let state: HistoryState | null = this._history.getState();
		if (state == null) {
			// When the page is first loaded, indicate that undo is NOT possible.
			state = {
				canUndo: false,
				sequenceNumber: 0,
				bar: 0,
				channel: 0,
				instrument: 0,
				recoveryUid: generateUid(),
				selection: this.selection.toJSON(),
			};
		}
		if (state.recoveryUid === undefined) state.recoveryUid = generateUid();
		if (!retainRawHistoryEntry) this._history.replaceState(state, loadedSongString);
		this._history.onChange(this._whenHistoryStateChanged);
		this.bar = state.bar | 0;
		if (window.sessionStorage.getItem("resetBarOnLoad") === "1") {
			window.sessionStorage.removeItem("resetBarOnLoad");
			this.bar = 0;
			this.channel = 0;
			this.viewedInstrument[0] = 0;
			this.barScrollPos = 0;
			this.channelScrollPos = 0;
		} else {
			// On page refresh, window.history.state is null — recover
			// bar/channel from sessionStorage so the editor doesn't
			// snap to bar 1 on every reload.
			const savedBar: string | null = window.sessionStorage.getItem("jukeboxCurrentBar");
			if (savedBar != null) {
				this.bar = Number(savedBar);
				state.bar = this.bar;
			}
			const savedChannel: string | null =
				window.sessionStorage.getItem("jukeboxCurrentChannel");
			if (savedChannel != null) {
				this.channel = Number(savedChannel);
				state.channel = this.channel;
			}
			// Restore the synth playhead bar too. doc.bar covers the editor
			// focus; doc.synth.bar is the actual playback position. They
			// can diverge (e.g. after [/] with autoFollow off, historically).
			// Clamp to the loaded song's barCount so a stale value from a
			// different song cannot push the playhead out of range.
			const savedPlayheadBar: string | null = window.sessionStorage.getItem(
				"jukeboxCurrentPlayheadBar",
			);
			if (savedPlayheadBar != null) {
				const clampedPlayheadBar: number = Math.max(
					0,
					Math.min(Number(savedPlayheadBar), this.song.barCount - 1),
				);
				this.synth.goToBar(clampedPlayheadBar);
			}
		}
		this.channel = state.channel | 0;
		for (let i: number = 0; i <= this.channel; i++) this.viewedInstrument[i] = 0;
		this.viewedInstrument[this.channel] = state.instrument | 0;
		this._recoveryUid = state.recoveryUid;
		// this.barScrollPos = Math.max(0, this.bar - (this.trackVisibleBars - 6));
		this.selection.fromJSON(state.selection);
		this.selection.scrollToSelectedPattern();

		// For all input events, catch them when they are about to finish bubbling,
		// presumably after all handlers are done updating the model, then update the
		// view before the screen renders. mouseenter and mouseleave do not bubble,
		// but they are immediately followed by mousemove which does.
		for (const eventName of [
			"change",
			"click",
			"keyup",
			"mousedown",
			"mouseup",
			"touchstart",
			"touchmove",
			"touchend",
			"touchcancel",
		]) {
			window.addEventListener(eventName, this._cleanDocument);
		}
		window.addEventListener("keydown", this._cleanDocumentIfNotRecordingMods);
		window.addEventListener("input", this._cleanDocumentIfNotRecordingMods);
		window.addEventListener("mousemove", this._cleanDocumentDeferred);

		this._validateDocState();
		this.performance = new SongPerformance(this);
	}

	public toggleDisplayBrowserUrl() {
		const state: HistoryState | null = this._history.getState();
		if (state == null) throw new Error("History state is null.");
		this.prefs.displayBrowserUrl = !this.prefs.displayBrowserUrl;
		this._history.replaceState(state, this.song.toBase64String());
	}

	public hasRedoHistory(): boolean {
		return this._history.canRedo;
	}

	private _forward(): void {
		this._history.forward();
	}

	private _back(): void {
		this._history.back();
	}

	private _whenHistoryStateChanged = (): void => {
		if (this.synth.recording) {
			// Changes to the song while it's recording to could mess up the recording so just abort the recording.
			this.performance.abortRecording();
		}

		if (window.history.state == null && window.location.hash !== "") {
			// The user changed the hash directly.
			const rawHash: string = this._history.getHash();
			const retainedState: HistoryState = {
				canUndo: true,
				sequenceNumber: this._sequenceNumber,
				bar: this.bar,
				channel: this.channel,
				instrument: this.viewedInstrument[this.channel],
				recoveryUid: this._recoveryUid,
				selection: this.selection.toJSON(),
			};
			try {
				new ChangeSong(this, rawHash);
			} catch (error) {
				if (!(error instanceof SongDataError)) throw error;
				SongRecovery.quarantine("hash", rawHash, retainedState, error);
				errorAlert(error);
				return;
			}
			this._sequenceNumber++;
			this._resetSongRecoveryUid();
			const state: HistoryState = {
				...retainedState,
				sequenceNumber: this._sequenceNumber,
				bar: 0,
				recoveryUid: this._recoveryUid,
			};
			this.synth.incrementEditSequence();
			this._history.replaceState(state, this.song.toBase64String());
			this.forgetLastChange();
			this.synth.pause();
			this.synth.goToBar(0);
			this.notifier.changed();
			this._cleanDocumentDeferred();
			this._validateDocState();
			this.persistCurrentPosition();
			return;
		}

		const state: HistoryState | null = this._history.getState();
		if (state == null) return;

		// Abort if we've already handled the current state.
		if (state.sequenceNumber === this._sequenceNumber) return;

		const rawHash: string = this._history.getHash();
		try {
			new ChangeSong(this, rawHash);
		} catch (error) {
			if (!(error instanceof SongDataError)) throw error;
			SongRecovery.quarantine("history", rawHash, state, error);
			errorAlert(error);
			return;
		}
		this.synth.incrementEditSequence();
		this.bar = state.bar;
		this.channel = state.channel;
		this.viewedInstrument[this.channel] = state.instrument;
		this._sequenceNumber = state.sequenceNumber;
		this._recoveryUid = state.recoveryUid;
		this.selection.fromJSON(state.selection);
		this._validateDocState();
		this.persistCurrentPosition();

		// this.barScrollPos = Math.min(this.bar, Math.max(this.bar - (this.trackVisibleBars - 1), this.barScrollPos));

		this.forgetLastChange();
		this.notifier.notifyWatchers();
	};

	private _cleanDocument = (): void => {
		this.notifier.notifyWatchers();
	};

	private _cleanDocumentIfNotRecordingMods = (): void => {
		if (!this.recordingModulators) {
			this.notifier.notifyWatchers();
		} else {
			this.modRecordingHandler();
		}
	};

	private _cleanDocumentPending = false;
	private _cleanDocumentDeferred = (): void => {
		if (this._cleanDocumentPending) return;
		this._cleanDocumentPending = true;
		requestAnimationFrame(() => {
			this._cleanDocumentPending = false;
			if (!this.recordingModulators) {
				this.notifier.notifyWatchers();
			} else {
				this.modRecordingHandler();
			}
		});
	};

	private _validateDocState = (): void => {
		const channelCount: number = this.song.getChannelCount();
		// Clamp the active channel against the loaded song's channel count. A
		// history/URL state saved while viewing a high channel index (e.g. after a
		// 26-channel MIDI import) survives into a song with fewer channels and
		// would otherwise index channels[channel] out of bounds, crashing
		// SongPerformance._documentChanged and this validator.
		if (this.channel >= channelCount) this.channel = channelCount - 1;
		if (this.channel < 0) this.channel = 0;
		for (let i: number = this.recentPatternInstruments.length; i < channelCount; i++) {
			this.recentPatternInstruments[i] = [0];
		}
		this.recentPatternInstruments.length = channelCount;
		for (let i: number = 0; i < channelCount; i++) {
			if (i === this.channel) {
				if (this.song.patternInstruments) {
					const pattern: Pattern | null = this.song.getPattern(this.channel, this.bar);
					if (pattern != null) {
						this.recentPatternInstruments[i] = pattern.instruments.concat();
					}
				} else {
					const channel: Channel = this.song.channels[this.channel];
					for (let j: number = 0; j < channel.instruments.length; j++) {
						this.recentPatternInstruments[i][j] = j;
					}
					this.recentPatternInstruments[i].length = channel.instruments.length;
				}
			}
			discardInvalidPatternInstruments(this.recentPatternInstruments[i], this.song, i);
		}

		for (let i: number = this.viewedInstrument.length; i < channelCount; i++) {
			this.viewedInstrument[i] = 0;
		}
		this.viewedInstrument.length = channelCount;
		for (let i: number = 0; i < channelCount; i++) {
			if (
				this.song.patternInstruments &&
				!this.song.layeredInstruments &&
				i === this.channel
			) {
				const pattern: Pattern | null = this.song.getPattern(this.channel, this.bar);
				if (pattern != null) {
					this.viewedInstrument[i] = pattern.instruments[0];
				}
			}
			this.viewedInstrument[i] = Math.min(
				this.viewedInstrument[i] | 0,
				this.song.channels[i].instruments.length - 1,
			);
		}

		const highlightedPattern: Pattern | null = this.getCurrentPattern();
		if (highlightedPattern != null && this.song.patternInstruments) {
			this.recentPatternInstruments[this.channel] = highlightedPattern.instruments.concat();
		}

		// Normalize selection.
		// Allow doc.bar to drift outside the box selection while playing
		// because it may auto-follow the playhead outside the selection but it would
		// be annoying to lose your selection just because the song is playing.
		if (
			(!this.synth.playing &&
				(this.bar < this.selection.boxSelectionBar ||
					this.selection.boxSelectionBar + this.selection.boxSelectionWidth <=
						this.bar)) ||
			this.channel < this.selection.boxSelectionChannel ||
			this.selection.boxSelectionChannel + this.selection.boxSelectionHeight <=
				this.channel ||
			this.song.barCount <
				this.selection.boxSelectionBar + this.selection.boxSelectionWidth ||
			channelCount < this.selection.boxSelectionChannel + this.selection.boxSelectionHeight ||
			(this.selection.boxSelectionWidth === 1 && this.selection.boxSelectionHeight === 1)
		) {
			this.selection.resetBoxSelection();
		}

		this.barScrollPos = Math.max(
			0,
			Math.min(this.song.barCount - this.trackVisibleBars, this.barScrollPos),
		);
		this.channelScrollPos = Math.max(
			0,
			Math.min(
				this.song.getChannelCount() - this.trackVisibleChannels,
				this.channelScrollPos,
			),
		);
	};

	private _updateHistoryState = (): void => {
		this._waitingToUpdateState = false;
		let hash: string;
		try {
			// Ensure that the song is not corrupted before saving it.
			hash = this.song.toBase64String();
		} catch (error) {
			errorAlert(error);
			return;
		}
		if (this._stateShouldBePushed) this._sequenceNumber++;
		if (this._recordedNewSong) {
			this._resetSongRecoveryUid();
		} else {
			this._history.recovery.saveVersion(this._recoveryUid, this.song.title, hash);
		}
		const state: HistoryState = {
			canUndo: true,
			sequenceNumber: this._sequenceNumber,
			bar: this.bar,
			channel: this.channel,
			instrument: this.viewedInstrument[this.channel],
			recoveryUid: this._recoveryUid,
			selection: this.selection.toJSON(),
		};
		if (this._stateShouldBePushed) {
			this._history.pushState(state, hash);
		} else {
			this._history.replaceState(state, hash);
		}
		this._stateShouldBePushed = false;
		this._recordedNewSong = false;

		this.persistCurrentPosition();
	};

	public persistCurrentPosition(): void {
		try {
			window.sessionStorage.setItem("jukeboxCurrentBar", String(this.bar));
			window.sessionStorage.setItem("jukeboxCurrentChannel", String(this.channel));
			window.sessionStorage.setItem(
				"jukeboxCurrentPlayheadBar",
				String(this.synth.currentBar),
			);
		} catch {
			/* sessionStorage may be unavailable */
		}
	}

	public record(change: Change, replace: boolean = false, newSong: boolean = false): void {
		if (change.isNoop()) {
			this._recentChange = null;
			if (replace) this._back();
		} else {
			change.commit();
			this.synth.incrementEditSequence();
			this._recentChange = change;
			this._stateShouldBePushed = this._stateShouldBePushed || !replace;
			this._recordedNewSong = this._recordedNewSong || newSong;
			this.persistCurrentPosition();
			if (!this._waitingToUpdateState) {
				// Defer updating the url/history until all sequenced changes have
				// committed and the interface has rendered the latest changes to
				// improve perceived responsiveness.
				window.requestAnimationFrame(this._updateHistoryState);
				this._waitingToUpdateState = true;
			}
		}
	}

	private _resetSongRecoveryUid(): void {
		this._recoveryUid = generateUid();
	}

	public openPrompt(prompt: string): void {
		this.prompt = prompt;
	}

	public undo(): void {
		const state: HistoryState | null = this._history.getState();
		if (state == null || state.canUndo) this._back();
	}

	public redo(): void {
		this._forward();
	}

	public setProspectiveChange(change: Change | null): void {
		this._recentChange = change;
	}

	public forgetLastChange(): void {
		this._recentChange = null;
	}

	public checkLastChange(): Change | null {
		return this._recentChange;
	}

	public lastChangeWas(change: Change | null): boolean {
		return change != null && change === this._recentChange;
	}

	public goBackToStart(): void {
		this.bar = 0;
		this.channel = 0;
		this.barScrollPos = 0;
		this.channelScrollPos = 0;
		this.synth.snapToStart();
		this.notifier.changed();
	}

	public setVolume(val: number): void {
		this.prefs.volume = val;
		this.prefs.save();
		this.synth.volume = this._calcVolume();
	}

	private _calcVolume(): number {
		return (
			Math.min(1.0, (this.prefs.volume / 50.0) ** 0.5) *
			2.0 ** ((this.prefs.volume - 75.0) / 25.0)
		);
	}

	public getCurrentPattern(barOffset: number = 0): Pattern | null {
		return this.song.getPattern(this.channel, this.bar + barOffset);
	}

	public getCurrentInstrument(barOffset: number = 0): number {
		if (barOffset === 0) {
			return this.viewedInstrument[this.channel];
		} else {
			const pattern: Pattern | null = this.getCurrentPattern(barOffset);
			return pattern == null ? 0 : pattern.instruments[0];
		}
	}

	public getCurrentInstrumentObj(): Instrument {
		return this.song.channels[this.channel].instruments[this.getCurrentInstrument()];
	}

	public getMobileLayout(): boolean {
		return this.prefs.layout === "wide" ? window.innerWidth <= 1000 : window.innerWidth <= 710;
	}

	public getBarWidth(): number {
		// Bugfix: In wide fullscreen, the 32 pixel display doesn't work as the trackEditor is still horizontally constrained
		return !this.getMobileLayout() &&
			this.prefs.enableChannelMuting &&
			(!this.getFullScreen() || this.prefs.layout === "wide")
			? 30
			: 32;
	}

	public getChannelHeight(): number {
		const squashed: boolean =
			this.getMobileLayout() ||
			this.song.getChannelCount() > 4 ||
			(this.song.barCount > this.trackVisibleBars && this.song.getChannelCount() > 3);
		// TODO: Jummbox widescreen should allow more channels before squashing or megasquashing
		const megaSquashed: boolean =
			!this.getMobileLayout() &&
			((this.prefs.layout !== "wide" && this.song.getChannelCount() > 11) ||
				this.song.getChannelCount() > 22);
		return megaSquashed ? 23 : squashed ? 27 : 32;
	}

	public getFullScreen(): boolean {
		return !this.getMobileLayout() && this.prefs.layout !== "small";
	}

	public getVisibleOctaveCount(): number {
		return this.getFullScreen() ? this.prefs.visibleOctaves : Preferences.defaultVisibleOctaves;
	}

	public getVisiblePitchCount(): number {
		return this.getVisibleOctaveCount() * Config.pitchesPerOctave + 1;
	}

	public getBaseVisibleOctave(channel: number): number {
		const visibleOctaveCount: number = this.getVisibleOctaveCount();
		return Math.max(
			0,
			Math.min(
				this.song.octaveCount - visibleOctaveCount,
				Math.ceil(this.song.channels[channel].octave - visibleOctaveCount * 0.5),
			),
		);
	}
}
