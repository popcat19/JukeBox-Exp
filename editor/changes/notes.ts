// Changes - Notes
//
// Purpose: Implements undoable changes for note editing and pattern manipulation
//
// This module:
// - Provides change classes for note add, remove, pitch, and length editing
// - Handles pattern copy, paste, transpose, and scale operations
// - Manages track and pattern selection changes

// Copyright (c) 2012-2022 John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

import { ColorConfig } from "../../shared/color-config";
import {
	Channel,
	Instrument,
	makeNotePin,
	Note,
	type NotePin,
	Pattern,
	type Song,
} from "../../synth";
import { tagInstrumentWithModule } from "../../synth/socket/instrument-tagging";
import { Config, type Dictionary } from "../../synth/synth-config";
import { Change, ChangeGroup, ChangeSequence, UndoableChange } from "../core/change";
import type { SongDocument } from "../song-document";
import type { Slider } from "../ui";
import {
	discardInvalidPatternInstruments,
	patternsContainSameInstruments,
	projectNoteIntoBar,
	removeRedundantPins,
} from "./util";

export class ChangeMoveAndOverflowNotes extends ChangeGroup {
	constructor(doc: SongDocument, newBeatsPerBar: number, partsToMove: number) {
		super();

		const pitchChannels: Channel[] = [];
		const noiseChannels: Channel[] = [];
		const modChannels: Channel[] = [];

		for (
			let channelIndex: number = 0;
			channelIndex < doc.song.getChannelCount();
			channelIndex++
		) {
			const oldChannel: Channel = doc.song.channels[channelIndex];
			const newChannel: Channel = new Channel();

			if (channelIndex < doc.song.pitchChannelCount) {
				pitchChannels.push(newChannel);
			} else if (channelIndex < doc.song.pitchChannelCount + doc.song.noiseChannelCount) {
				noiseChannels.push(newChannel);
			} else {
				modChannels.push(newChannel);
			}

			newChannel.muted = oldChannel.muted;
			newChannel.octave = oldChannel.octave;
			newChannel.name = oldChannel.name;

			for (const instrument of oldChannel.instruments) {
				newChannel.instruments.push(instrument);
			}

			const oldPartsPerBar: number = Config.partsPerBeat * doc.song.beatsPerBar;
			const newPartsPerBar: number = Config.partsPerBeat * newBeatsPerBar;
			let currentBar: number = -1;
			let pattern: Pattern | null = null;

			for (let oldBar: number = 0; oldBar < doc.song.barCount; oldBar++) {
				const oldPattern: Pattern | null = doc.song.getPattern(channelIndex, oldBar);
				if (oldPattern != null) {
					const oldBarStart: number = oldBar * oldPartsPerBar;
					for (const oldNote of oldPattern.notes) {
						const absoluteNoteStart: number = oldNote.start + oldBarStart + partsToMove;
						const absoluteNoteEnd: number = oldNote.end + oldBarStart + partsToMove;

						const startBar: number = Math.floor(absoluteNoteStart / newPartsPerBar);
						const endBar: number = Math.ceil(absoluteNoteEnd / newPartsPerBar);
						for (let bar: number = startBar; bar < endBar; bar++) {
							const barStartPart: number = bar * newPartsPerBar;
							const noteStartPart: number = Math.max(
								0,
								absoluteNoteStart - barStartPart,
							);
							const noteEndPart: number = Math.min(
								newPartsPerBar,
								absoluteNoteEnd - barStartPart,
							);

							if (noteStartPart < noteEndPart) {
								// Ensure a pattern exists for the current bar before inserting notes into it.
								if (currentBar < bar || pattern == null) {
									currentBar++;
									while (currentBar < bar) {
										newChannel.bars[currentBar] = 0;
										currentBar++;
									}
									pattern = new Pattern();
									newChannel.patterns.push(pattern);
									newChannel.bars[currentBar] = newChannel.patterns.length;
									pattern.instruments.length = 0;
									pattern.instruments.push(...oldPattern.instruments);
								}

								// This is a consideration to allow arbitrary note sequencing, e.g. for mod channels (so the pattern being used can jump around)
								pattern = newChannel.patterns[newChannel.bars[bar] - 1];

								projectNoteIntoBar(
									oldNote,
									absoluteNoteStart - barStartPart - noteStartPart,
									noteStartPart,
									noteEndPart,
									pattern.notes,
								);
							}
						}
					}
				}
			}
		}

		removeDuplicatePatterns(pitchChannels);
		removeDuplicatePatterns(noiseChannels);
		removeDuplicatePatterns(modChannels);
		this.append(new ChangeReplacePatterns(doc, pitchChannels, noiseChannels, modChannels));
	}
}

class ChangePins extends UndoableChange {
	protected _oldStart: number;
	protected _newStart: number;
	protected _oldEnd: number;
	protected _newEnd: number;
	protected _oldPins: NotePin[];
	protected _newPins: NotePin[];
	protected _oldPitches: number[];
	protected _newPitches: number[];
	protected _oldContinuesLastPattern: boolean;
	protected _newContinuesLastPattern: boolean;
	constructor(
		protected _doc: SongDocument | null,
		protected _note: Note,
	) {
		super(false);
		this._oldStart = this._note.start;
		this._oldEnd = this._note.end;
		this._newStart = this._note.start;
		this._newEnd = this._note.end;
		this._oldPins = this._note.pins;
		this._newPins = [];
		this._oldPitches = this._note.pitches;
		this._newPitches = [];
		this._oldContinuesLastPattern = this._note.continuesLastPattern;
		this._newContinuesLastPattern = this._note.continuesLastPattern;
	}

	protected _finishSetup(continuesLastPattern?: boolean): void {
		for (let i: number = 0; i < this._newPins.length - 1; ) {
			if (this._newPins[i].time >= this._newPins[i + 1].time) {
				this._newPins.splice(i, 1);
			} else {
				i++;
			}
		}

		removeRedundantPins(this._newPins);

		const firstInterval: number = this._newPins[0].interval;
		const firstTime: number = this._newPins[0].time;
		for (let i: number = 0; i < this._oldPitches.length; i++) {
			this._newPitches[i] = this._oldPitches[i] + firstInterval;
		}
		for (let i: number = 0; i < this._newPins.length; i++) {
			this._newPins[i].interval -= firstInterval;
			this._newPins[i].time -= firstTime;
		}
		this._newStart = this._oldStart + firstTime;
		this._newEnd = this._newStart + this._newPins[this._newPins.length - 1].time;

		if (continuesLastPattern !== undefined) {
			this._newContinuesLastPattern = continuesLastPattern;
		}
		if (this._newStart !== 0) {
			this._newContinuesLastPattern = false;
		}

		this._doForwards();
		this._didSomething();
	}

	protected _doForwards(): void {
		this._note.pins = this._newPins;
		this._note.pitches = this._newPitches;
		this._note.start = this._newStart;
		this._note.end = this._newEnd;
		this._note.continuesLastPattern = this._newContinuesLastPattern;
		if (this._doc != null) this._doc.notifier.changed();
	}

	protected _doBackwards(): void {
		this._note.pins = this._oldPins;
		this._note.pitches = this._oldPitches;
		this._note.start = this._oldStart;
		this._note.end = this._oldEnd;
		this._note.continuesLastPattern = this._oldContinuesLastPattern;
		if (this._doc != null) this._doc.notifier.changed();
	}
}

export class ChangePitchAdded extends UndoableChange {
	private _doc: SongDocument;
	private _note: Note;
	private _pitch: number;
	private _index: number;
	constructor(
		doc: SongDocument,
		note: Note,
		pitch: number,
		index: number,
		deletion: boolean = false,
	) {
		super(deletion);
		this._doc = doc;
		this._note = note;
		this._pitch = pitch;
		this._index = index;
		this._didSomething();
		this.redo();
	}

	protected _doForwards(): void {
		this._note.pitches.splice(this._index, 0, this._pitch);
		this._doc.notifier.changed();
	}

	protected _doBackwards(): void {
		this._note.pitches.splice(this._index, 1);
		this._doc.notifier.changed();
	}
}

export class ChangePatternNumbers extends Change {
	constructor(
		doc: SongDocument,
		value: number,
		startBar: number,
		startChannel: number,
		width: number,
		height: number,
	) {
		super();
		if (value > doc.song.patternsPerChannel) throw new Error("invalid pattern");

		for (let bar: number = startBar; bar < startBar + width; bar++) {
			for (
				let channelIndex: number = startChannel;
				channelIndex < startChannel + height;
				channelIndex++
			) {
				if (doc.song.channels[channelIndex].bars[bar] !== value) {
					doc.song.channels[channelIndex].bars[bar] = value;
					this._didSomething();
				}
			}
		}

		// Make mod channels shift viewed instrument over when pattern numbers change
		if (startChannel >= doc.song.pitchChannelCount + doc.song.noiseChannelCount) {
			const pattern: Pattern | null = doc.getCurrentPattern();
			if (pattern != null) {
				doc.viewedInstrument[startChannel] = pattern.instruments[0];
			} else {
				doc.viewedInstrument[startChannel] = 0;
			}
		}

		doc.notifier.changed();
	}
}

export class ChangePatternsPerChannel extends Change {
	constructor(doc: SongDocument, newValue: number) {
		super();
		if (doc.song.patternsPerChannel !== newValue) {
			for (let i: number = 0; i < doc.song.getChannelCount(); i++) {
				const channelBars: number[] = doc.song.channels[i].bars;
				const channelPatterns: Pattern[] = doc.song.channels[i].patterns;
				for (let j: number = 0; j < channelBars.length; j++) {
					if (channelBars[j] > newValue) channelBars[j] = 0;
				}
				for (let j: number = channelPatterns.length; j < newValue; j++) {
					channelPatterns[j] = new Pattern();
				}
				channelPatterns.length = newValue;
			}
			doc.song.patternsPerChannel = newValue;
			doc.notifier.changed();
			this._didSomething();
		}
	}
}

export class ChangeEnsurePatternExists extends UndoableChange {
	private _doc: SongDocument;
	private _bar: number;
	private _channelIndex: number;
	private _patternIndex: number;
	private _patternOldNotes: Note[] | null = null;
	private _oldPatternCount: number;
	private _newPatternCount: number;
	private _oldPatternInstruments: number[] | null = null;
	private _newPatternInstruments: number[];

	constructor(doc: SongDocument, channelIndex: number, bar: number) {
		super(false);
		const song: Song = doc.song;
		if (song.channels[channelIndex].bars[bar] !== 0) return;

		this._doc = doc;
		this._bar = bar;
		this._channelIndex = channelIndex;
		this._oldPatternCount = song.patternsPerChannel;
		this._newPatternCount = song.patternsPerChannel;
		if (channelIndex < doc.song.pitchChannelCount + doc.song.noiseChannelCount) {
			this._newPatternInstruments = doc.recentPatternInstruments[channelIndex].concat();
		} else {
			this._newPatternInstruments = [doc.viewedInstrument[channelIndex]];
		}

		let firstEmptyUnusedIndex: number | null = null;
		let firstUnusedIndex: number | null = null;
		for (
			let patternIndex: number = 1;
			patternIndex <= song.patternsPerChannel;
			patternIndex++
		) {
			let used = false;
			for (let barIndex: number = 0; barIndex < song.barCount; barIndex++) {
				if (song.channels[channelIndex].bars[barIndex] === patternIndex) {
					used = true;
					break;
				}
			}
			if (used) continue;
			if (firstUnusedIndex == null) {
				firstUnusedIndex = patternIndex;
			}
			const pattern: Pattern = song.channels[channelIndex].patterns[patternIndex - 1];
			if (pattern.notes.length === 0) {
				firstEmptyUnusedIndex = patternIndex;
				break;
			}
		}

		if (firstEmptyUnusedIndex != null) {
			this._patternIndex = firstEmptyUnusedIndex;
			this._oldPatternInstruments =
				song.channels[channelIndex].patterns[
					firstEmptyUnusedIndex - 1
				].instruments.concat();
		} else if (song.patternsPerChannel < song.barCount) {
			this._newPatternCount = song.patternsPerChannel + 1;
			this._patternIndex = song.patternsPerChannel + 1;
		} else if (firstUnusedIndex != null) {
			this._patternIndex = firstUnusedIndex;
			this._patternOldNotes =
				song.channels[channelIndex].patterns[firstUnusedIndex - 1].notes;
			this._oldPatternInstruments =
				song.channels[channelIndex].patterns[firstUnusedIndex - 1].instruments.concat();
		} else {
			throw new Error();
		}

		this._didSomething();
		this._doForwards();
	}

	protected _doForwards(): void {
		const song: Song = this._doc.song;
		for (let j: number = song.patternsPerChannel; j < this._newPatternCount; j++) {
			for (let i: number = 0; i < song.getChannelCount(); i++) {
				song.channels[i].patterns[j] = new Pattern();
			}
		}
		song.patternsPerChannel = this._newPatternCount;
		const pattern: Pattern = song.channels[this._channelIndex].patterns[this._patternIndex - 1];
		pattern.notes = [];
		pattern.instruments.length = 0;
		pattern.instruments.push(...this._newPatternInstruments);
		song.channels[this._channelIndex].bars[this._bar] = this._patternIndex;
		this._doc.notifier.changed();
	}

	protected _doBackwards(): void {
		const song: Song = this._doc.song;
		const pattern: Pattern = song.channels[this._channelIndex].patterns[this._patternIndex - 1];
		if (this._patternOldNotes != null) pattern.notes = this._patternOldNotes;
		if (this._oldPatternInstruments != null) {
			pattern.instruments.length = 0;
			pattern.instruments.push(...this._oldPatternInstruments);
		}
		song.channels[this._channelIndex].bars[this._bar] = 0;
		for (let i: number = 0; i < song.getChannelCount(); i++) {
			song.channels[i].patterns.length = this._oldPatternCount;
		}
		song.patternsPerChannel = this._oldPatternCount;
		this._doc.notifier.changed();
	}
}

export class ChangePinTime extends ChangePins {
	constructor(
		doc: SongDocument | null,
		note: Note,
		pinIndex: number,
		shiftedTime: number,
		continuesLastPattern: boolean,
	) {
		super(doc, note);

		shiftedTime -= this._oldStart;
		const originalTime: number = this._oldPins[pinIndex].time;
		const skipStart: number = Math.min(originalTime, shiftedTime);
		const skipEnd: number = Math.max(originalTime, shiftedTime);
		let setPin: boolean = false;
		for (let i: number = 0; i < this._oldPins.length; i++) {
			const oldPin: NotePin = note.pins[i];
			const time: number = oldPin.time;
			if (time < skipStart) {
				this._newPins.push(makeNotePin(oldPin.interval, time, oldPin.size));
			} else if (time > skipEnd) {
				if (!setPin) {
					if (this._newPins.length > 0) continuesLastPattern = note.continuesLastPattern;
					this._newPins.push(
						makeNotePin(
							this._oldPins[pinIndex].interval,
							shiftedTime,
							this._oldPins[pinIndex].size,
						),
					);
					setPin = true;
				}
				this._newPins.push(makeNotePin(oldPin.interval, time, oldPin.size));
			}
		}
		if (!setPin) {
			continuesLastPattern = note.continuesLastPattern;
			this._newPins.push(
				makeNotePin(
					this._oldPins[pinIndex].interval,
					shiftedTime,
					this._oldPins[pinIndex].size,
				),
			);
		}

		this._finishSetup(continuesLastPattern);
	}
}

export class ChangePitchBend extends ChangePins {
	constructor(
		doc: SongDocument | null,
		note: Note,
		bendStart: number,
		bendEnd: number,
		bendTo: number,
		pitchIndex: number,
	) {
		super(doc, note);

		bendStart -= this._oldStart;
		bendEnd -= this._oldStart;
		bendTo -= note.pitches[pitchIndex];

		let setStart: boolean = false;
		let setEnd: boolean = false;
		let prevInterval: number = 0;
		let prevSize: number = Config.noteSizeMax;
		let persist: boolean = true;
		let i: number;
		let direction: number;
		let stop: number;
		let push: (item: NotePin) => void;
		if (bendEnd > bendStart) {
			i = 0;
			direction = 1;
			stop = note.pins.length;
			push = (item: NotePin) => {
				this._newPins.push(item);
			};
		} else {
			i = note.pins.length - 1;
			direction = -1;
			stop = -1;
			push = (item: NotePin) => {
				this._newPins.unshift(item);
			};
		}
		for (; i !== stop; i += direction) {
			const oldPin: NotePin = note.pins[i];
			const time: number = oldPin.time;
			for (;;) {
				if (!setStart) {
					if (time * direction <= bendStart * direction) {
						prevInterval = oldPin.interval;
						prevSize = oldPin.size;
					}
					if (time * direction < bendStart * direction) {
						push(makeNotePin(oldPin.interval, time, oldPin.size));
						break;
					} else {
						push(makeNotePin(prevInterval, bendStart, prevSize));
						setStart = true;
					}
				} else if (!setEnd) {
					if (time * direction <= bendEnd * direction) {
						prevInterval = oldPin.interval;
						prevSize = oldPin.size;
					}
					if (time * direction < bendEnd * direction) {
						break;
					} else {
						push(makeNotePin(bendTo, bendEnd, prevSize));
						setEnd = true;
					}
				} else {
					if (time * direction === bendEnd * direction) {
						break;
					} else {
						if (oldPin.interval !== prevInterval) persist = false;
						push(makeNotePin(persist ? bendTo : oldPin.interval, time, oldPin.size));
						break;
					}
				}
			}
		}
		if (!setEnd) {
			push(makeNotePin(bendTo, bendEnd, prevSize));
		}

		this._finishSetup();
	}
}

export class ChangePatternRhythm extends ChangeSequence {
	constructor(doc: SongDocument, pattern: Pattern) {
		super();
		const minDivision: number =
			Config.partsPerBeat / Config.rhythms[doc.song.rhythm].stepsPerBeat;

		const changeRhythm: (oldTime: number) => number = (oldTime: number): number => {
			const thresholds: number[] | null = Config.rhythms[doc.song.rhythm].roundUpThresholds;
			if (thresholds != null) {
				const beatStart: number =
					Math.floor(oldTime / Config.partsPerBeat) * Config.partsPerBeat;
				const remainder: number = oldTime - beatStart;
				let newTime: number = beatStart;
				for (const threshold of thresholds) {
					if (remainder >= threshold) {
						newTime += minDivision;
					} else {
						break;
					}
				}
				return newTime;
			} else {
				return Math.round(oldTime / minDivision) * minDivision;
			}
		};

		let i: number = 0;
		while (i < pattern.notes.length) {
			const note: Note = pattern.notes[i];
			if (changeRhythm(note.start) >= changeRhythm(note.end)) {
				this.append(new ChangeNoteAdded(doc, pattern, note, i, true));
			} else {
				this.append(new ChangeRhythmNote(doc, note, changeRhythm));
				i++;
			}
		}
	}
}

export class ChangeRhythmNote extends ChangePins {
	constructor(doc: SongDocument | null, note: Note, changeRhythm: (oldTime: number) => number) {
		super(doc, note);

		for (const oldPin of this._oldPins) {
			this._newPins.push(
				makeNotePin(
					oldPin.interval,
					changeRhythm(oldPin.time + this._oldStart) - this._oldStart,
					oldPin.size,
				),
			);
		}

		this._finishSetup();
	}
}

export class ChangeMoveNotesSideways extends ChangeGroup {
	constructor(doc: SongDocument, beatsToMove: number, strategy: string) {
		super();
		let partsToMove: number = Math.round(
			(beatsToMove % doc.song.beatsPerBar) * Config.partsPerBeat,
		);
		if (partsToMove < 0) partsToMove += doc.song.beatsPerBar * Config.partsPerBeat;
		if (partsToMove === 0.0) return;

		switch (strategy) {
			case "wrapAround":
				{
					const partsPerBar: number = Config.partsPerBeat * doc.song.beatsPerBar;
					for (const channel of doc.song.channels) {
						for (const pattern of channel.patterns) {
							const newNotes: Note[] = [];

							for (let bar: number = 1; bar >= 0; bar--) {
								const barStartPart: number = bar * partsPerBar;

								for (const oldNote of pattern.notes) {
									const absoluteNoteStart: number = oldNote.start + partsToMove;
									const absoluteNoteEnd: number = oldNote.end + partsToMove;
									const noteStartPart: number = Math.max(
										0,
										absoluteNoteStart - barStartPart,
									);
									const noteEndPart: number = Math.min(
										partsPerBar,
										absoluteNoteEnd - barStartPart,
									);

									if (noteStartPart < noteEndPart) {
										projectNoteIntoBar(
											oldNote,
											absoluteNoteStart - barStartPart - noteStartPart,
											noteStartPart,
											noteEndPart,
											newNotes,
										);
									}
								}
							}

							pattern.notes = newNotes;
						}
					}
				}
				break;
			case "overflow":
				{
					let originalBarCount: number = doc.song.barCount;
					let originalLoopStart: number = doc.song.loopStart;
					const originalLoopLength: number = doc.song.loopLength;

					this.append(
						new ChangeMoveAndOverflowNotes(doc, doc.song.beatsPerBar, partsToMove),
					);

					if (beatsToMove < 0) {
						let firstBarIsEmpty: boolean = true;
						for (const channel of doc.song.channels) {
							if (channel.bars[0] !== 0) firstBarIsEmpty = false;
						}
						if (firstBarIsEmpty) {
							for (const channel of doc.song.channels) {
								channel.bars.shift();
							}
							doc.song.barCount--;
						} else {
							originalBarCount++;
							originalLoopStart++;
							doc.bar++;
						}
					}
					while (doc.song.barCount < originalBarCount) {
						for (const channel of doc.song.channels) {
							channel.bars.push(0);
						}
						doc.song.barCount++;
					}
					doc.song.loopStart = originalLoopStart;
					doc.song.loopLength = originalLoopLength;
				}
				break;
			default:
				throw new Error("Unrecognized beats-per-bar conversion strategy.");
		}

		doc.notifier.changed();
		this._didSomething();
	}
}

export class ChangeScale extends ChangeGroup {
	constructor(doc: SongDocument, newValue: number) {
		super();
		if (doc.song.scale !== newValue) {
			doc.song.scale = newValue;
			doc.notifier.changed();
			this._didSomething();
		}
	}
}

export class ChangeDetectKey extends ChangeGroup {
	constructor(doc: SongDocument) {
		super();
		const song: Song = doc.song;
		const basePitch: number = Config.keys[song.key].basePitch;
		const keyWeights: number[] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
		for (let channelIndex: number = 0; channelIndex < song.pitchChannelCount; channelIndex++) {
			for (let barIndex: number = 0; barIndex < song.barCount; barIndex++) {
				const pattern: Pattern | null = song.getPattern(channelIndex, barIndex);
				if (pattern != null) {
					for (const note of pattern.notes) {
						const prevPin: NotePin = note.pins[0];
						for (let pinIndex: number = 1; pinIndex < note.pins.length; pinIndex++) {
							const nextPin: NotePin = note.pins[pinIndex];
							if (prevPin.interval === nextPin.interval) {
								let weight: number = nextPin.time - prevPin.time;
								weight += Math.max(
									0,
									Math.min(Config.partsPerBeat, nextPin.time + note.start) -
										(prevPin.time + note.start),
								);
								weight *= nextPin.size + prevPin.size;
								for (const pitch of note.pitches) {
									const key = (basePitch + prevPin.interval + pitch) % 12;
									keyWeights[key] += weight;
								}
							}
						}
					}
				}
			}
		}

		let bestKey: number = 0;
		let bestKeyWeight: number = 0;
		for (let key: number = 0; key < 12; key++) {
			// Look for the root of the most prominent major or minor chord.
			const keyWeight: number =
				keyWeights[key] *
				(3 * keyWeights[(key + 7) % 12] +
					keyWeights[(key + 4) % 12] +
					keyWeights[(key + 3) % 12]);
			if (bestKeyWeight < keyWeight) {
				bestKeyWeight = keyWeight;
				bestKey = key;
			}
		}

		if (bestKey !== song.key) {
			const diff: number = song.key - bestKey;
			const absoluteDiff: number = Math.abs(diff);

			for (
				let channelIndex: number = 0;
				channelIndex < song.pitchChannelCount;
				channelIndex++
			) {
				for (const pattern of song.channels[channelIndex].patterns) {
					for (let i: number = 0; i < absoluteDiff; i++) {
						this.append(
							new ChangeTranspose(doc, channelIndex, pattern, diff > 0, true),
						);
					}
				}
			}

			song.key = bestKey;
			doc.notifier.changed();
			this._didSomething();
		}
	}
}

export class ChangeValidateTrackSelection extends Change {
	constructor(doc: SongDocument) {
		super();
		const channelIndex: number = Math.min(doc.channel, doc.song.getChannelCount() - 1);
		const bar: number = Math.max(0, Math.min(doc.song.barCount - 1, doc.bar));
		if (doc.channel !== channelIndex || doc.bar !== bar) {
			doc.bar = bar;
			doc.channel = channelIndex;
			this._didSomething();
		}
		doc.selection.scrollToSelectedPattern();
		doc.notifier.changed();
	}
}

export class ChangeReplacePatterns extends ChangeGroup {
	constructor(
		doc: SongDocument,
		pitchChannels: Channel[],
		noiseChannels: Channel[],
		modChannels: Channel[],
	) {
		super();

		const song: Song = doc.song;

		function removeExtraSparseChannels(channels: Channel[], maxLength: number): void {
			while (channels.length > maxLength) {
				let sparsestIndex: number = channels.length - 1;
				let mostZeroes: number = 0;
				for (
					let channelIndex: number = 0;
					channelIndex < channels.length - 1;
					channelIndex++
				) {
					let zeroes: number = 0;
					for (const bar of channels[channelIndex].bars) {
						if (bar === 0) zeroes++;
					}
					if (zeroes >= mostZeroes) {
						sparsestIndex = channelIndex;
						mostZeroes = zeroes;
					}
				}
				channels.splice(sparsestIndex, 1);
			}
		}

		removeExtraSparseChannels(pitchChannels, Config.pitchChannelCountMax);
		removeExtraSparseChannels(noiseChannels, Config.noiseChannelCountMax);
		removeExtraSparseChannels(modChannels, Config.modChannelCountMax);

		while (pitchChannels.length < Config.pitchChannelCountMin)
			pitchChannels.push(new Channel());
		while (noiseChannels.length < Config.noiseChannelCountMin)
			noiseChannels.push(new Channel());
		while (modChannels.length < Config.modChannelCountMin) modChannels.push(new Channel());

		// Set minimum counts.
		song.barCount = 1;
		song.patternsPerChannel = 8;
		const combinedChannels: Channel[] = pitchChannels.concat(noiseChannels.concat(modChannels));
		for (let channelIndex: number = 0; channelIndex < combinedChannels.length; channelIndex++) {
			const channel: Channel = combinedChannels[channelIndex];
			song.barCount = Math.max(song.barCount, channel.bars.length);
			song.patternsPerChannel = Math.max(song.patternsPerChannel, channel.patterns.length);
			song.channels[channelIndex] = channel;
		}
		song.channels.length = combinedChannels.length;
		song.pitchChannelCount = pitchChannels.length;
		song.noiseChannelCount = noiseChannels.length;
		song.modChannelCount = modChannels.length;

		song.barCount = Math.min(Config.barCountMax, song.barCount);
		song.patternsPerChannel = Math.min(Config.barCountMax, song.patternsPerChannel);
		for (let channelIndex: number = 0; channelIndex < song.channels.length; channelIndex++) {
			const channel: Channel = song.channels[channelIndex];

			for (let barIndex: number = 0; barIndex < channel.bars.length; barIndex++) {
				if (
					channel.bars[barIndex] > song.patternsPerChannel ||
					channel.bars[barIndex] < 0
				) {
					channel.bars[barIndex] = 0;
				}
			}
			while (channel.bars.length < song.barCount) {
				channel.bars.push(0);
			}
			channel.bars.length = song.barCount;

			if (channel.instruments.length > song.getMaxInstrumentsPerChannel()) {
				channel.instruments.length = song.getMaxInstrumentsPerChannel();
			}

			for (const pattern of channel.patterns) {
				discardInvalidPatternInstruments(pattern.instruments, song, channelIndex);
			}
			while (channel.patterns.length < song.patternsPerChannel) {
				channel.patterns.push(new Pattern());
			}

			channel.patterns.length = song.patternsPerChannel;
		}

		song.loopStart = Math.max(0, Math.min(song.barCount - 1, song.loopStart));
		song.loopLength = Math.min(song.barCount - song.loopStart, song.loopLength);

		this.append(new ChangeValidateTrackSelection(doc));
		doc.notifier.changed();
		this._didSomething();

		ColorConfig.resetColors();
	}
}

export function comparePatternNotes(a: Note[], b: Note[]): boolean {
	if (a.length !== b.length) return false;

	for (let noteIndex: number = 0; noteIndex < a.length; noteIndex++) {
		const oldNote: Note = a[noteIndex];
		const newNote: Note = b[noteIndex];
		const noteShapeChanged =
			newNote.start !== oldNote.start ||
			newNote.end !== oldNote.end ||
			newNote.pitches.length !== oldNote.pitches.length ||
			newNote.pins.length !== oldNote.pins.length ||
			newNote.velocity !== oldNote.velocity ||
			newNote.continuesLastPattern !== oldNote.continuesLastPattern;
		if (noteShapeChanged) return false;

		for (let pitchIndex: number = 0; pitchIndex < oldNote.pitches.length; pitchIndex++) {
			if (newNote.pitches[pitchIndex] !== oldNote.pitches[pitchIndex]) {
				return false;
			}
		}

		for (let pinIndex: number = 0; pinIndex < oldNote.pins.length; pinIndex++) {
			if (
				newNote.pins[pinIndex].interval !== oldNote.pins[pinIndex].interval ||
				newNote.pins[pinIndex].time !== oldNote.pins[pinIndex].time ||
				newNote.pins[pinIndex].size !== oldNote.pins[pinIndex].size
			) {
				return false;
			}
		}
	}

	return true;
}

export function removeDuplicatePatterns(channels: Channel[]): void {
	for (const channel of channels) {
		const newPatterns: Pattern[] = [];
		for (let bar: number = 0; bar < channel.bars.length; bar++) {
			if (channel.bars[bar] === 0) continue;

			const oldPattern: Pattern = channel.patterns[channel.bars[bar] - 1];

			let foundMatchingPattern: boolean = false;
			for (
				let newPatternIndex: number = 0;
				newPatternIndex < newPatterns.length;
				newPatternIndex++
			) {
				const newPattern: Pattern = newPatterns[newPatternIndex];

				if (
					!patternsContainSameInstruments(
						oldPattern.instruments,
						newPattern.instruments,
					) ||
					newPattern.notes.length !== oldPattern.notes.length
				) {
					continue;
				}

				if (comparePatternNotes(oldPattern.notes, newPattern.notes)) {
					foundMatchingPattern = true;
					channel.bars[bar] = newPatternIndex + 1;
					break;
				}
			}

			if (!foundMatchingPattern) {
				newPatterns.push(oldPattern);
				channel.bars[bar] = newPatterns.length;
			}
		}

		for (let patternIndex: number = 0; patternIndex < newPatterns.length; patternIndex++) {
			channel.patterns[patternIndex] = newPatterns[patternIndex];
		}
		channel.patterns.length = newPatterns.length;
	}
}

export class ChangeCleanChannelPatterns extends Change {
	constructor(doc: SongDocument, channelIndex: number) {
		super();
		const channel: Channel = doc.song.channels[channelIndex];
		const patternsPerChannel: number = doc.song.patternsPerChannel;

		removeDuplicatePatterns([channel]);

		// Restore empty pattern slots up to patternsPerChannel so numbering
		// stays consistent across channels.
		for (let j: number = channel.patterns.length; j < patternsPerChannel; j++) {
			channel.patterns[j] = new Pattern();
		}
		channel.patterns.length = patternsPerChannel;

		doc.notifier.changed();
		this._didSomething();
	}
}

export class ChangeCleanChannelInstruments extends Change {
	constructor(doc: SongDocument, channelIndex: number) {
		super();
		const channel: Channel = doc.song.channels[channelIndex];
		const maxInstruments: number = doc.song.getMaxInstrumentsPerChannel();

		// Collect instrument indices referenced by any pattern on this channel
		const usedIndices: Set<number> = new Set();
		for (const pattern of channel.patterns) {
			for (const instIndex of pattern.instruments) {
				if (instIndex >= 0 && instIndex < channel.instruments.length) {
					usedIndices.add(instIndex);
				}
			}
		}

		if (usedIndices.size === 0) {
			// No instruments used — keep one blank instrument at minimum
			const isNoise: boolean = doc.song.getChannelIsNoise(channelIndex);
			const isMod: boolean = doc.song.getChannelIsMod(channelIndex);
			channel.instruments.length = 0;
			channel.instruments.push(new Instrument(isNoise, isMod));
			doc.viewedInstrument[channelIndex] = 0;
			doc.notifier.changed();
			this._didSomething();
			return;
		}

		// Build fingerprint→newIndex mapping (sorted by original index for
		// stable numbering — first-appearance in index order)
		const sortedUsed: number[] = Array.from(usedIndices).sort((a, b) => a - b);
		const fingerprintToNew: Map<string, number> = new Map();
		const oldToNew: number[] = new Array(channel.instruments.length).fill(-1);

		for (const oldIndex of sortedUsed) {
			const fingerprint: string = JSON.stringify(
				channel.instruments[oldIndex].toJsonObject(),
			);
			let newIndex: number | undefined = fingerprintToNew.get(fingerprint);
			if (newIndex === undefined) {
				newIndex = fingerprintToNew.size;
				fingerprintToNew.set(fingerprint, newIndex);
			}
			oldToNew[oldIndex] = newIndex;
		}

		// Rebuild instrument array — place each unique instrument at its new index
		const newInstruments: Instrument[] = new Array(fingerprintToNew.size);
		for (let oldIdx: number = 0; oldIdx < oldToNew.length; oldIdx++) {
			const newIdx: number = oldToNew[oldIdx];
			if (newIdx >= 0 && newInstruments[newIdx] === undefined) {
				newInstruments[newIdx] = channel.instruments[oldIdx];
			}
		}

		// Truncate to max, pad to min
		const finalCount: number = Math.max(
			Config.instrumentCountMin,
			Math.min(maxInstruments, newInstruments.length),
		);
		channel.instruments.length = 0;
		for (let i: number = 0; i < finalCount; i++) {
			if (i < newInstruments.length && newInstruments[i] !== undefined) {
				channel.instruments[i] = newInstruments[i];
			} else {
				const isNoise: boolean = doc.song.getChannelIsNoise(channelIndex);
				const isMod: boolean = doc.song.getChannelIsMod(channelIndex);
				channel.instruments[i] = new Instrument(isNoise, isMod);
			}
		}

		// Remap pattern instrument references
		for (const pattern of channel.patterns) {
			for (let i: number = 0; i < pattern.instruments.length; i++) {
				const oldIdx: number = pattern.instruments[i];
				if (oldIdx >= 0 && oldIdx < oldToNew.length && oldToNew[oldIdx] >= 0) {
					pattern.instruments[i] = oldToNew[oldIdx];
				}
			}
			discardInvalidPatternInstruments(pattern.instruments, doc.song, channelIndex);
		}

		// Update mod instrument references on other channels that target
		// this channel's instruments. If the old index was dropped (maps to
		// -1), reset the modulator to "none".
		for (
			let modChannelIdx: number = doc.song.pitchChannelCount + doc.song.noiseChannelCount;
			modChannelIdx < doc.song.getChannelCount();
			modChannelIdx++
		) {
			for (const modInstrument of doc.song.channels[modChannelIdx].instruments) {
				for (let mod: number = 0; mod < Config.modCount; mod++) {
					if (modInstrument.modChannels[mod] !== channelIndex) continue;
					const oldRef: number = modInstrument.modInstruments[mod];
					if (oldRef >= 0 && oldRef < oldToNew.length) {
						const newRef: number = oldToNew[oldRef];
						if (newRef >= 0) {
							modInstrument.modInstruments[mod] = newRef;
						} else {
							// Instrument was dropped — reset to none
							modInstrument.modInstruments[mod] = 0;
							modInstrument.modulators[mod] = Config.modulators.dictionary.none.index;
						}
					}
				}
			}
		}

		// Clamp viewed instrument
		doc.viewedInstrument[channelIndex] = Math.min(
			doc.viewedInstrument[channelIndex],
			channel.instruments.length - 1,
		);

		doc.synth.computeLatestModValues();
		doc.notifier.changed();
		this._didSomething();
	}
}

export class ChangeNoteAdded extends UndoableChange {
	private _doc: SongDocument;
	private _pattern: Pattern;
	private _note: Note;
	private _index: number;
	constructor(
		doc: SongDocument,
		pattern: Pattern,
		note: Note,
		index: number,
		deletion: boolean = false,
	) {
		super(deletion);
		this._doc = doc;
		this._pattern = pattern;
		this._note = note;
		this._index = index;
		this._didSomething();
		this.redo();
	}

	protected _doForwards(): void {
		this._pattern.notes.splice(this._index, 0, this._note);
		this._doc.notifier.changed();
	}

	protected _doBackwards(): void {
		this._pattern.notes.splice(this._index, 1);
		this._doc.notifier.changed();
	}
}

export class ChangeNoteLength extends ChangePins {
	constructor(doc: SongDocument | null, note: Note, truncStart: number, truncEnd: number) {
		super(doc, note);
		const continuesLastPattern: boolean =
			(this._oldStart < 0 || note.continuesLastPattern) && truncStart === 0;

		truncStart -= this._oldStart;
		truncEnd -= this._oldStart;
		let setStart: boolean = false;
		let prevSize: number = this._oldPins[0].size;
		let prevInterval: number = this._oldPins[0].interval;
		let pushLastPin: boolean = true;
		let i: number;
		for (i = 0; i < this._oldPins.length; i++) {
			const oldPin: NotePin = this._oldPins[i];
			if (oldPin.time < truncStart) {
				prevSize = oldPin.size;
				prevInterval = oldPin.interval;
			} else {
				if (oldPin.time > truncStart && !setStart) {
					this._newPins.push(makeNotePin(prevInterval, truncStart, prevSize));
					setStart = true;
				}
				if (oldPin.time <= truncEnd) {
					this._newPins.push(makeNotePin(oldPin.interval, oldPin.time, oldPin.size));
					if (oldPin.time === truncEnd) {
						pushLastPin = false;
						break;
					}
				} else {
					break;
				}
			}
		}

		if (pushLastPin) {
			// Extending past the last pin holds that pin's values.
			const endPin: NotePin = this._oldPins[Math.min(i, this._oldPins.length - 1)];
			this._newPins.push(makeNotePin(endPin.interval, truncEnd, endPin.size));
		}

		this._finishSetup(continuesLastPattern);
	}
}

export class ChangeNoteTruncate extends ChangeSequence {
	constructor(
		doc: SongDocument,
		pattern: Pattern,
		start: number,
		end: number,
		skipNote: Note | null = null,
		force: boolean = false,
	) {
		super();
		let i: number = 0;
		while (i < pattern.notes.length) {
			const note: Note = pattern.notes[i];
			if (note === skipNote && skipNote != null) {
				i++;
			} else if (note.end <= start) {
				i++;
			} else if (note.start >= end) {
				// Allow out-of-order notes for mods so that all get checked.
				if (!doc.song.getChannelIsMod(doc.channel)) {
					break;
				} else {
					i++;
				}
			} else if (note.start < start && note.end > end) {
				if (
					!doc.song.getChannelIsMod(doc.channel) ||
					force ||
					(skipNote != null && note.pitches[0] === skipNote.pitches[0])
				) {
					const copy: Note = note.clone();
					this.append(new ChangeNoteLength(doc, note, note.start, start));
					i++;
					this.append(new ChangeNoteAdded(doc, pattern, copy, i, false));
					this.append(new ChangeNoteLength(doc, copy, end, copy.end));
				}
				i++;
			} else if (note.start < start) {
				if (
					!doc.song.getChannelIsMod(doc.channel) ||
					force ||
					(skipNote != null && note.pitches[0] === skipNote.pitches[0])
				) {
					this.append(new ChangeNoteLength(doc, note, note.start, start));
				}
				i++;
			} else if (note.end > end) {
				if (
					!doc.song.getChannelIsMod(doc.channel) ||
					force ||
					(skipNote != null && note.pitches[0] === skipNote.pitches[0])
				) {
					this.append(new ChangeNoteLength(doc, note, end, note.end));
				}
				i++;
			} else {
				if (
					!doc.song.getChannelIsMod(doc.channel) ||
					force ||
					(skipNote != null && note.pitches[0] === skipNote.pitches[0])
				) {
					this.append(new ChangeNoteAdded(doc, pattern, note, i, true));
				} else {
					i++;
				}
			}
		}
	}
}

class ChangeSplitNotesAtSelection extends ChangeSequence {
	constructor(doc: SongDocument, pattern: Pattern) {
		super();
		let i: number = 0;
		while (i < pattern.notes.length) {
			const note: Note = pattern.notes[i];
			if (
				note.start < doc.selection.patternSelectionStart &&
				doc.selection.patternSelectionStart < note.end
			) {
				const copy: Note = note.clone();
				this.append(
					new ChangeNoteLength(
						doc,
						note,
						note.start,
						doc.selection.patternSelectionStart,
					),
				);
				i++;
				this.append(new ChangeNoteAdded(doc, pattern, copy, i, false));
				this.append(
					new ChangeNoteLength(doc, copy, doc.selection.patternSelectionStart, copy.end),
				);
				// i++; // The second note might be split again at the end of the selection. Check it again.
			} else if (
				note.start < doc.selection.patternSelectionEnd &&
				doc.selection.patternSelectionEnd < note.end
			) {
				const copy: Note = note.clone();
				this.append(
					new ChangeNoteLength(doc, note, note.start, doc.selection.patternSelectionEnd),
				);
				i++;
				this.append(new ChangeNoteAdded(doc, pattern, copy, i, false));
				this.append(
					new ChangeNoteLength(doc, copy, doc.selection.patternSelectionEnd, copy.end),
				);
				i++;
			} else {
				i++;
			}
		}
	}
}

class ChangeTransposeNote extends UndoableChange {
	protected _doc: SongDocument;
	protected _note: Note;
	protected _oldStart: number;
	protected _newStart: number;
	protected _oldEnd: number;
	protected _newEnd: number;
	protected _oldPins: NotePin[];
	protected _newPins: NotePin[];
	protected _oldPitches: number[];
	protected _newPitches: number[];
	constructor(
		doc: SongDocument,
		channelIndex: number,
		note: Note,
		upward: boolean,
		ignoreScale: boolean = false,
		octave: boolean = false,
	) {
		super(false);
		this._doc = doc;
		this._note = note;
		this._oldPins = note.pins;
		this._newPins = [];
		this._oldPitches = note.pitches;
		this._newPitches = [];

		// Pitch transposing is disabled for noise channels to avoid
		// accidentally messing up noise channels when pitch shifting all
		// channels at once.
		const isNoise: boolean = doc.song.getChannelIsNoise(channelIndex);
		if (isNoise !== doc.song.getChannelIsNoise(doc.channel)) return;

		// Can't transpose mods
		if (doc.song.getChannelIsMod(doc.channel)) return;

		const maxPitch: number = isNoise ? Config.drumCount - 1 : Config.maxPitch;

		for (let i: number = 0; i < this._oldPitches.length; i++) {
			let pitch: number = this._oldPitches[i];
			if (octave && !isNoise) {
				if (upward) {
					pitch = Math.min(maxPitch, pitch + 12);
				} else {
					pitch = Math.max(0, pitch - 12);
				}
			} else {
				const scale =
					doc.song.scale === Config.scales.dictionary.Custom.index
						? doc.song.scaleCustom
						: Config.scales[doc.song.scale].flags;
				if (upward) {
					for (let j: number = pitch + 1; j <= maxPitch; j++) {
						if (isNoise || ignoreScale || scale[j % 12]) {
							pitch = j;
							break;
						}
					}
				} else {
					for (let j: number = pitch - 1; j >= 0; j--) {
						if (isNoise || ignoreScale || scale[j % 12]) {
							pitch = j;
							break;
						}
					}
				}
			}

			let foundMatch: boolean = false;
			for (let j: number = 0; j < this._newPitches.length; j++) {
				if (this._newPitches[j] === pitch) {
					foundMatch = true;
					break;
				}
			}
			if (!foundMatch) this._newPitches.push(pitch);
		}

		let min: number = 0;
		let max: number = maxPitch;

		for (let i: number = 1; i < this._newPitches.length; i++) {
			const diff: number = this._newPitches[0] - this._newPitches[i];
			if (min < diff) min = diff;
			if (max > diff + maxPitch) max = diff + maxPitch;
		}

		for (const oldPin of this._oldPins) {
			let interval: number = oldPin.interval + this._oldPitches[0];

			if (interval < min) interval = min;
			if (interval > max) interval = max;
			if (octave && !isNoise) {
				if (upward) {
					interval = Math.min(max, interval + 12);
				} else {
					interval = Math.max(min, interval - 12);
				}
			} else {
				const scale =
					doc.song.scale === Config.scales.dictionary.Custom.index
						? doc.song.scaleCustom
						: Config.scales[doc.song.scale].flags;
				if (upward) {
					for (let i: number = interval + 1; i <= max; i++) {
						if (isNoise || ignoreScale || scale[i % 12]) {
							interval = i;
							break;
						}
					}
				} else {
					for (let i: number = interval - 1; i >= min; i--) {
						if (isNoise || ignoreScale || scale[i % 12]) {
							interval = i;
							break;
						}
					}
				}
			}
			interval -= this._newPitches[0];
			this._newPins.push(makeNotePin(interval, oldPin.time, oldPin.size));
		}

		if (this._newPins[0].interval !== 0) throw new Error("wrong pin start interval");

		for (let i: number = 1; i < this._newPins.length - 1; ) {
			if (
				this._newPins[i - 1].interval === this._newPins[i].interval &&
				this._newPins[i].interval === this._newPins[i + 1].interval &&
				this._newPins[i - 1].size === this._newPins[i].size &&
				this._newPins[i].size === this._newPins[i + 1].size
			) {
				this._newPins.splice(i, 1);
			} else {
				i++;
			}
		}

		this._doForwards();
		this._didSomething();
	}

	protected _doForwards(): void {
		this._note.pins = this._newPins;
		this._note.pitches = this._newPitches;
		this._doc.notifier.changed();
	}

	protected _doBackwards(): void {
		this._note.pins = this._oldPins;
		this._note.pitches = this._oldPitches;
		this._doc.notifier.changed();
	}
}

export class ChangeTranspose extends ChangeSequence {
	constructor(
		doc: SongDocument,
		channelIndex: number,
		pattern: Pattern,
		upward: boolean,
		ignoreScale: boolean = false,
		octave: boolean = false,
	) {
		super();
		if (doc.selection.patternSelectionActive) {
			this.append(new ChangeSplitNotesAtSelection(doc, pattern));
		}
		for (const note of pattern.notes) {
			if (
				doc.selection.patternSelectionActive &&
				(note.end <= doc.selection.patternSelectionStart ||
					note.start >= doc.selection.patternSelectionEnd)
			) {
				continue;
			}
			this.append(
				new ChangeTransposeNote(doc, channelIndex, note, upward, ignoreScale, octave),
			);
		}
	}
}

export class ChangeTrackSelection extends Change {
	constructor(doc: SongDocument, newX0: number, newX1: number, newY0: number, newY1: number) {
		super();
		doc.selection.boxSelectionX0 = newX0;
		doc.selection.boxSelectionX1 = newX1;
		doc.selection.boxSelectionY0 = newY0;
		doc.selection.boxSelectionY1 = newY1;
		doc.notifier.changed();
		this._didSomething();
	}
}

export class ChangePatternSelection extends UndoableChange {
	private _doc: SongDocument;
	private _oldStart: number;
	private _oldEnd: number;
	private _oldActive: boolean;
	private _newStart: number;
	private _newEnd: number;
	private _newActive: boolean;

	constructor(doc: SongDocument, newStart: number, newEnd: number) {
		super(false);
		this._doc = doc;
		this._oldStart = doc.selection.patternSelectionStart;
		this._oldEnd = doc.selection.patternSelectionEnd;
		this._oldActive = doc.selection.patternSelectionActive;
		this._newStart = newStart;
		this._newEnd = newEnd;
		this._newActive = newStart < newEnd;
		this._doForwards();
		this._didSomething();
	}

	protected _doForwards(): void {
		this._doc.selection.patternSelectionStart = this._newStart;
		this._doc.selection.patternSelectionEnd = this._newEnd;
		this._doc.selection.patternSelectionActive = this._newActive;
		this._doc.notifier.changed();
	}

	protected _doBackwards(): void {
		this._doc.selection.patternSelectionStart = this._oldStart;
		this._doc.selection.patternSelectionEnd = this._oldEnd;
		this._doc.selection.patternSelectionActive = this._oldActive;
		this._doc.notifier.changed();
	}
}

export class ChangeDragSelectedNotes extends ChangeSequence {
	constructor(
		doc: SongDocument,
		channelIndex: number,
		pattern: Pattern,
		parts: number,
		transpose: number,
	) {
		super();

		if (parts === 0 && transpose === 0) return;

		if (doc.selection.patternSelectionActive) {
			this.append(new ChangeSplitNotesAtSelection(doc, pattern));
		}

		const oldStart: number = doc.selection.patternSelectionStart;
		const oldEnd: number = doc.selection.patternSelectionEnd;
		const newStart: number = Math.max(
			0,
			Math.min(doc.song.beatsPerBar * Config.partsPerBeat, oldStart + parts),
		);
		const newEnd: number = Math.max(
			0,
			Math.min(doc.song.beatsPerBar * Config.partsPerBeat, oldEnd + parts),
		);
		if (newStart === newEnd) {
			// Just erase the current contents of the selection:
			this.append(new ChangeNoteTruncate(doc, pattern, oldStart, oldEnd, null, true));
		} else if (parts < 0) {
			// Clear space for the dragged notes:
			this.append(
				new ChangeNoteTruncate(
					doc,
					pattern,
					newStart,
					Math.min(oldStart, newEnd),
					null,
					true,
				),
			);
		} else {
			// Clear space for the dragged notes:
			this.append(
				new ChangeNoteTruncate(
					doc,
					pattern,
					Math.max(oldEnd, newStart),
					newEnd,
					null,
					true,
				),
			);
		}

		this.append(new ChangePatternSelection(doc, newStart, newEnd));
		const draggedNotes: Note[] = [];
		let noteInsertionIndex: number = 0;
		let i: number = 0;
		while (i < pattern.notes.length) {
			const note: Note = pattern.notes[i];
			if (note.end <= oldStart || note.start >= oldEnd) {
				i++;
				if (note.end <= newStart) noteInsertionIndex = i;
			} else {
				draggedNotes.push(note.clone());
				this.append(new ChangeNoteAdded(doc, pattern, note, i, true));
			}
		}

		for (const note of draggedNotes) {
			note.start += parts;
			note.end += parts;
			if (note.end <= newStart) continue;
			if (note.start >= newEnd) continue;

			this.append(new ChangeNoteAdded(doc, pattern, note, noteInsertionIndex++, false));

			this.append(
				new ChangeNoteLength(
					doc,
					note,
					Math.max(note.start, newStart),
					Math.min(newEnd, note.end),
				),
			);

			for (let i: number = 0; i < Math.abs(transpose); i++) {
				this.append(
					new ChangeTransposeNote(
						doc,
						channelIndex,
						note,
						transpose > 0,
						doc.prefs.notesOutsideScale,
					),
				);
			}
		}
	}
}

export class ChangeHoldingModRecording extends Change {
	public storedChange: Change | null;
	public storedValues: number[] | null;
	public storedSlider: Slider | null;
	constructor(
		_doc: SongDocument,
		storedChange: Change | null,
		storedValues: number[] | null,
		slider: Slider | null,
	) {
		super();
		this.storedChange = storedChange;
		this.storedValues = storedValues;
		this.storedSlider = slider;
		this._didSomething();
	}
}

export class ChangeDuplicateSelectedReusedPatterns extends ChangeGroup {
	constructor(
		doc: SongDocument,
		barStart: number,
		barWidth: number,
		channelStart: number,
		channelHeight: number,
		_replaceUnused: boolean,
	) {
		super();
		for (
			let channelIndex: number = channelStart;
			channelIndex < channelStart + channelHeight;
			channelIndex++
		) {
			const reusablePatterns: Dictionary<number> = {};

			for (let bar: number = barStart; bar < barStart + barWidth; bar++) {
				const currentPatternIndex: number = doc.song.channels[channelIndex].bars[bar];
				if (currentPatternIndex === 0) continue;
				if (reusablePatterns[String(currentPatternIndex)] === undefined) {
					let isUsedElsewhere = false;
					for (let bar2: number = 0; bar2 < doc.song.barCount; bar2++) {
						if (bar2 < barStart || bar2 >= barStart + barWidth) {
							if (
								doc.song.channels[channelIndex].bars[bar2] === currentPatternIndex
							) {
								isUsedElsewhere = true;
								break;
							}
						}
					}
					if (isUsedElsewhere) {
						// Need to duplicate the pattern.
						const copiedPattern: Pattern = doc.song.getPattern(channelIndex, bar)!;
						this.append(new ChangePatternNumbers(doc, 0, bar, channelIndex, 1, 1));
						this.append(new ChangeEnsurePatternExists(doc, channelIndex, bar));
						const newPattern: Pattern | null = doc.song.getPattern(channelIndex, bar);
						if (newPattern == null) throw new Error();
						this.append(
							new ChangePaste(
								doc,
								newPattern,
								copiedPattern.notes,
								0,
								Config.partsPerBeat * doc.song.beatsPerBar,
								Config.partsPerBeat * doc.song.beatsPerBar,
							),
						);

						// Copy the instruments into the new pattern.
						newPattern.instruments.length = 0;
						newPattern.instruments.push(...copiedPattern.instruments);

						reusablePatterns[String(currentPatternIndex)] =
							doc.song.channels[channelIndex].bars[bar];
					} else {
						reusablePatterns[String(currentPatternIndex)] = currentPatternIndex;
					}
				}

				this.append(
					new ChangePatternNumbers(
						doc,
						reusablePatterns[String(currentPatternIndex)],
						bar,
						channelIndex,
						1,
						1,
					),
				);
			}
		}
	}
}

export class ChangePatternScale extends Change {
	constructor(doc: SongDocument, pattern: Pattern, scaleMap: number[]) {
		super();
		if (doc.selection.patternSelectionActive) {
			new ChangeSplitNotesAtSelection(doc, pattern);
		}
		const maxPitch: number = Config.maxPitch;
		for (const note of pattern.notes) {
			if (
				doc.selection.patternSelectionActive &&
				(note.end <= doc.selection.patternSelectionStart ||
					note.start >= doc.selection.patternSelectionEnd)
			) {
				continue;
			}

			const newPitches: number[] = [];
			const newPins: NotePin[] = [];
			for (let i: number = 0; i < note.pitches.length; i++) {
				const pitch: number = note.pitches[i];
				const transformedPitch: number = scaleMap[pitch % 12] + (pitch - (pitch % 12));
				if (newPitches.indexOf(transformedPitch) === -1) {
					newPitches.push(transformedPitch);
				}
			}

			let min: number = 0;
			let max: number = maxPitch;

			for (let i: number = 1; i < newPitches.length; i++) {
				const diff: number = newPitches[0] - newPitches[i];
				if (min < diff) min = diff;
				if (max > diff + maxPitch) max = diff + maxPitch;
			}

			for (const oldPin of note.pins) {
				let interval: number = oldPin.interval + note.pitches[0];
				if (interval < min) interval = min;
				if (interval > max) interval = max;
				const transformedInterval: number =
					scaleMap[interval % 12] + (interval - (interval % 12));
				newPins.push(
					makeNotePin(transformedInterval - newPitches[0], oldPin.time, oldPin.size),
				);
			}

			if (newPins[0].interval !== 0) throw new Error("wrong pin start interval");

			for (let i: number = 1; i < newPins.length - 1; ) {
				if (
					newPins[i - 1].interval === newPins[i].interval &&
					newPins[i].interval === newPins[i + 1].interval &&
					newPins[i - 1].size === newPins[i].size &&
					newPins[i].size === newPins[i + 1].size
				) {
					newPins.splice(i, 1);
				} else {
					i++;
				}
			}

			note.pitches = newPitches;
			note.pins = newPins;
		}
		this._didSomething();
		doc.notifier.changed();
	}
}

export class ChangeSizeBend extends UndoableChange {
	private _doc: SongDocument;
	private _note: Note;
	private _oldPins: NotePin[];
	private _newPins: NotePin[];
	constructor(
		doc: SongDocument,
		note: Note,
		bendPart: number,
		bendSize: number,
		bendInterval: number,
		uniformSize: boolean,
	) {
		super(false);
		this._doc = doc;
		this._note = note;
		this._oldPins = note.pins;
		this._newPins = [];

		let inserted: boolean = false;

		for (const pin of note.pins) {
			if (pin.time < bendPart) {
				if (uniformSize) {
					this._newPins.push(makeNotePin(pin.interval, pin.time, bendSize));
				} else {
					this._newPins.push(pin);
				}
			} else if (pin.time === bendPart) {
				this._newPins.push(makeNotePin(bendInterval, bendPart, bendSize));
				inserted = true;
			} else {
				if (!uniformSize && !inserted) {
					this._newPins.push(makeNotePin(bendInterval, bendPart, bendSize));
					inserted = true;
				}
				if (uniformSize) {
					this._newPins.push(makeNotePin(pin.interval, pin.time, bendSize));
				} else {
					this._newPins.push(pin);
				}
			}
		}

		removeRedundantPins(this._newPins);

		this._doForwards();
		this._didSomething();
	}

	protected _doForwards(): void {
		this._note.pins = this._newPins;
		this._doc.notifier.changed();
	}

	protected _doBackwards(): void {
		this._note.pins = this._oldPins;
		this._doc.notifier.changed();
	}
}

export class ChangePaste extends ChangeGroup {
	constructor(
		doc: SongDocument,
		pattern: Pattern,
		// biome-ignore lint/suspicious/noExplicitAny: notes from clipboard data
		notes: any[],
		selectionStart: number,
		selectionEnd: number,
		oldPartDuration: number,
	) {
		super();

		// Erase the current contents of the selection:
		this.append(new ChangeNoteTruncate(doc, pattern, selectionStart, selectionEnd, null, true));

		// Mods don't follow this sequence, so skipping for now.
		let noteInsertionIndex: number = 0;
		if (!doc.song.getChannelIsMod(doc.channel)) {
			for (let i: number = 0; i < pattern.notes.length; i++) {
				if (pattern.notes[i].start < selectionStart) {
					if (pattern.notes[i].end > selectionStart) throw new Error();

					noteInsertionIndex = i + 1;
				} else if (pattern.notes[i].start < selectionEnd) {
					throw new Error();
				}
			}
		} else {
			noteInsertionIndex = pattern.notes.length;
		}

		while (selectionStart < selectionEnd) {
			for (const noteObject of notes) {
				const noteStart: number = noteObject.start + selectionStart;
				const noteEnd: number = noteObject.end + selectionStart;
				if (noteStart >= selectionEnd) break;
				const note: Note = new Note(
					noteObject.pitches[0],
					noteStart,
					noteEnd,
					noteObject.pins[0].size,
					false,
				);
				note.pitches.length = 0;
				for (const pitch of noteObject.pitches) {
					note.pitches.push(pitch);
				}
				note.pins.length = 0;
				for (const pin of noteObject.pins) {
					note.pins.push(makeNotePin(pin.interval, pin.time, pin.size));
				}
				note.continuesLastPattern =
					noteObject.continuesLastPattern === true && note.start === 0;
				pattern.notes.splice(noteInsertionIndex++, 0, note);
				if (note.end > selectionEnd) {
					this.append(new ChangeNoteLength(doc, note, note.start, selectionEnd));
				}
			}

			selectionStart += oldPartDuration;
		}

		// Need to re-sort the notes by start time as they might change order because of paste.
		if (pattern != null && doc.song.getChannelIsMod(doc.channel)) {
			pattern.notes.sort((a, b) =>
				a.start === b.start ? a.pitches[0] - b.pitches[0] : a.start - b.start,
			);
		}

		doc.notifier.changed();
		this._didSomething();
	}
}

export class ChangePasteInstrument extends ChangeGroup {
	// biome-ignore lint/suspicious/noExplicitAny: instrumentCopy is JSON object
	constructor(doc: SongDocument, instrument: Instrument, instrumentCopy: any) {
		super();
		instrument.fromJsonObject(
			instrumentCopy,
			instrumentCopy.isDrum,
			instrumentCopy.isMod,
			false,
			false,
		);
		tagInstrumentWithModule(instrument);
		doc.notifier.changed();
		this._didSomething();
	}
}

export class ChangeAppendInstrument extends ChangeGroup {
	// biome-ignore lint/suspicious/noExplicitAny: instrument is JSON data
	constructor(doc: SongDocument, channel: Channel, instrument: any) {
		super();
		const newInstrument: Instrument = new Instrument(instrument.isDrum, instrument.isMod);
		newInstrument.fromJsonObject(instrument, instrument.isDrum, instrument.isMod, false, false);
		tagInstrumentWithModule(newInstrument);
		channel.instruments.push(newInstrument);
		this._didSomething();
		doc.notifier.changed();
	}
}

export class ChangeSetPatternInstruments extends Change {
	constructor(doc: SongDocument, channelIndex: number, instruments: number[], pattern: Pattern) {
		super();
		if (!patternsContainSameInstruments(instruments, pattern.instruments)) {
			pattern.instruments.length = 0;
			pattern.instruments.push(...instruments);
			discardInvalidPatternInstruments(pattern.instruments, doc.song, channelIndex);
			this._didSomething();
			doc.notifier.changed();
		}
	}
}
