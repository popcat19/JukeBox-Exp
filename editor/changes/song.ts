// Changes - Song
//
// Purpose: Implements undoable changes for song-level settings and structure
//
// This module:
// - Provides change classes for tempo, key, scale, and rhythm
// - Handles channel add, clone, remove, reorder, and bar manipulation
// - Manages song metadata and loop region changes

// Copyright (c) 2012-2022 John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

import { ColorConfig } from "../../shared/color-config";
import { Channel, Instrument, type Note, type NotePin, Pattern, Song } from "../../synth";
import {
	preserveOrTagInstrumentWithModule,
	tagInstrumentWithModule,
} from "../../synth/socket/instrument-tagging";
import { Config, EffectType, InstrumentType } from "../../synth/synth-config";
import {
	EditorConfig,
	fullTagList,
	type Preset,
	type PresetCategory,
} from "../config/editor-config";
import { Change, ChangeGroup, ChangeSequence } from "../core/change";
import { createCustomSampleHandler, decodeEditorSong } from "../song-custom-samples";
import type { SongDocument } from "../song-document";
import { ChangeFieldValue } from "./field-value";
import { ChangeToggleEffects } from "./instruments";
import {
	ChangeMoveAndOverflowNotes,
	ChangeNoteAdded,
	ChangeNoteTruncate,
	ChangePatternSelection,
	ChangeRhythmNote,
	ChangeValidateTrackSelection,
} from "./notes";
import { discardInvalidPatternInstruments } from "./util";

export { ChangeFieldValue } from "./field-value";

// True when a preset is eligible for random selection: it carries settings,
// matches the requested noise/non-noise category, and matches every tag in
// tagList (a "!tag" entry means the preset must NOT have that tag).
function presetMatchesFilter(preset: Preset, isNoise: boolean, tagList: string[]): boolean {
	if (preset.settings === undefined) return false;
	if ((preset.isNoise === true) !== isNoise) return false;
	if (tagList.length === 0) return true;
	if (!preset.tags) return false;
	return tagList.every((tag) =>
		tag.startsWith("!") ? !preset.tags.includes(tag.slice(1)) : preset.tags.includes(tag),
	);
}

export class ChangeBarCount extends Change {
	constructor(doc: SongDocument, newValue: number, atBeginning: boolean) {
		super();
		if (doc.song.barCount !== newValue) {
			for (const channel of doc.song.channels) {
				if (atBeginning) {
					while (channel.bars.length < newValue) {
						channel.bars.unshift(0);
					}
					if (doc.song.barCount > newValue) {
						channel.bars.splice(0, doc.song.barCount - newValue);
					}
				} else {
					while (channel.bars.length < newValue) {
						channel.bars.push(0);
					}
					channel.bars.length = newValue;
				}
			}

			if (atBeginning) {
				const diff: number = newValue - doc.song.barCount;
				doc.bar = Math.max(0, doc.bar + diff);
				if (diff < 0 || doc.barScrollPos > 0) {
					doc.barScrollPos = Math.max(0, doc.barScrollPos + diff);
				}
				doc.song.loopStart = Math.max(0, doc.song.loopStart + diff);
			}
			doc.bar = Math.min(doc.bar, newValue - 1);
			doc.song.loopLength = Math.min(newValue, doc.song.loopLength);
			doc.song.loopStart = Math.min(newValue - doc.song.loopLength, doc.song.loopStart);
			doc.song.barCount = newValue;
			doc.notifier.changed();

			this._didSomething();
		}
	}
}

export class ChangeInsertBars extends Change {
	constructor(doc: SongDocument, start: number, count: number) {
		super();

		const newLength: number = Math.min(Config.barCountMax, doc.song.barCount + count);
		count = newLength - doc.song.barCount;
		if (count === 0) return;

		for (const channel of doc.song.channels) {
			while (channel.bars.length < newLength) {
				channel.bars.splice(start, 0, 0);
			}
		}
		doc.song.barCount = newLength;

		doc.bar += count;
		doc.barScrollPos += count;
		if (doc.song.loopStart >= start) {
			doc.song.loopStart += count;
		} else if (doc.song.loopStart + doc.song.loopLength >= start) {
			doc.song.loopLength += count;
		}

		doc.notifier.changed();
		this._didSomething();
	}
}

export class ChangeDeleteBars extends Change {
	constructor(doc: SongDocument, start: number, count: number) {
		super();

		for (const channel of doc.song.channels) {
			channel.bars.splice(start, count);
			if (channel.bars.length === 0) channel.bars.push(0);
		}
		doc.song.barCount = Math.max(1, doc.song.barCount - count);

		doc.bar = Math.max(0, doc.bar - count);

		doc.barScrollPos = Math.max(0, doc.barScrollPos - count);
		if (doc.song.loopStart >= start) {
			doc.song.loopStart = Math.max(0, doc.song.loopStart - count);
		} else if (doc.song.loopStart + doc.song.loopLength > start) {
			doc.song.loopLength -= count;
		}
		doc.song.loopLength = Math.max(
			1,
			Math.min(doc.song.barCount - doc.song.loopStart, doc.song.loopLength),
		);

		doc.notifier.changed();
		this._didSomething();
	}
}

export class ChangeLimiterSettings extends Change {
	constructor(
		doc: SongDocument,
		limitRatio: number,
		compressionRatio: number,
		limitThreshold: number,
		compressionThreshold: number,
		limitRise: number,
		limitDecay: number,
		masterGain: number,
	) {
		super();

		// This check causes state reversion when the limiter prompt closes; the notifier change must happen immediately.

		doc.song.limitRatio = limitRatio;
		doc.song.compressionRatio = compressionRatio;
		doc.song.limitThreshold = limitThreshold;
		doc.song.compressionThreshold = compressionThreshold;
		doc.song.limitRise = limitRise;
		doc.song.limitDecay = limitDecay;
		doc.song.masterGain = masterGain;

		doc.notifier.changed();
		this._didSomething();
		// }
	}
}

export class ChangeChannelOrder extends Change {
	constructor(doc: SongDocument, selectionMin: number, selectionMax: number, offset: number) {
		super();
		// Change the order of two channels by swapping.
		doc.song.channels.splice(
			selectionMin + offset,
			0,
			...doc.song.channels.splice(selectionMin, selectionMax - selectionMin + 1),
		);

		// Update mods for each channel
		selectionMax = Math.max(selectionMax, selectionMin);
		for (
			let channelIndex: number = doc.song.pitchChannelCount + doc.song.noiseChannelCount;
			channelIndex < doc.song.getChannelCount();
			channelIndex++
		) {
			for (
				let instrumentIdx: number = 0;
				instrumentIdx < doc.song.channels[channelIndex].instruments.length;
				instrumentIdx++
			) {
				const instrument: Instrument =
					doc.song.channels[channelIndex].instruments[instrumentIdx];
				for (let i: number = 0; i < Config.modCount; i++) {
					if (
						instrument.modChannels[i] >= selectionMin &&
						instrument.modChannels[i] <= selectionMax
					) {
						instrument.modChannels[i] += offset;
					} else if (
						instrument.modChannels[i] >= selectionMin + offset &&
						instrument.modChannels[i] <= selectionMax + offset
					) {
						instrument.modChannels[i] -= offset * (selectionMax - selectionMin + 1);
					}
				}
			}
		}

		doc.notifier.changed();
		this._didSomething();
	}
}

export class ChangeCustomScale extends Change {
	constructor(doc: SongDocument, flags: boolean[]) {
		super();

		for (let i: number = 0; i < Config.pitchesPerOctave; i++) {
			doc.song.scaleCustom[i] = flags[i];
		}

		doc.notifier.changed();
		this._didSomething();
	}
}

export class ChangeChannelCount extends Change {
	constructor(
		doc: SongDocument,
		newPitchChannelCount: number,
		newNoiseChannelCount: number,
		newModChannelCount: number,
	) {
		super();
		if (
			doc.song.pitchChannelCount !== newPitchChannelCount ||
			doc.song.noiseChannelCount !== newNoiseChannelCount ||
			doc.song.modChannelCount !== newModChannelCount
		) {
			const newChannels: Channel[] = [];

			function changeGroup(
				newCount: number,
				oldCount: number,
				newStart: number,
				oldStart: number,
				octave: number,
				isNoise: boolean,
				isMod: boolean,
			): void {
				for (let i: number = 0; i < newCount; i++) {
					const channelIndex = i + newStart;
					const oldChannel = i + oldStart;
					if (i < oldCount) {
						newChannels[channelIndex] = doc.song.channels[oldChannel];
					} else {
						newChannels[channelIndex] = new Channel();
						newChannels[channelIndex].octave = octave;
						for (let j: number = 0; j < Config.instrumentCountMin; j++) {
							const instrument: Instrument = new Instrument(isNoise, isMod);
							if (!isMod) {
								const presetValue: number = pickRandomPresetValue(isNoise, false);
								const preset: Preset = EditorConfig.valueToPreset(presetValue)!;
								instrument.fromJsonObject(
									preset.settings,
									isNoise,
									isMod,
									doc.song.rhythm === 0 || doc.song.rhythm === 2,
									doc.song.rhythm >= 2,
								);
								instrument.preset = presetValue;
								instrument.effects |= 1 << EffectType.panning;
							} else {
								instrument.setTypeAndReset(InstrumentType.mod, isNoise, isMod);
							}
							tagInstrumentWithModule(instrument);
							newChannels[channelIndex].instruments[j] = instrument;
						}
						for (let j: number = 0; j < doc.song.patternsPerChannel; j++) {
							newChannels[channelIndex].patterns[j] = new Pattern();
						}
						for (let j: number = 0; j < doc.song.barCount; j++) {
							newChannels[channelIndex].bars[j] = 0;
						}
					}
				}
			}

			changeGroup(newPitchChannelCount, doc.song.pitchChannelCount, 0, 0, 3, false, false);
			changeGroup(
				newNoiseChannelCount,
				doc.song.noiseChannelCount,
				newPitchChannelCount,
				doc.song.pitchChannelCount,
				0,
				true,
				false,
			);
			changeGroup(
				newModChannelCount,
				doc.song.modChannelCount,
				newNoiseChannelCount + newPitchChannelCount,
				doc.song.pitchChannelCount + doc.song.noiseChannelCount,
				0,
				false,
				true,
			);

			const oldPitchCount: number = doc.song.pitchChannelCount;
			doc.song.pitchChannelCount = newPitchChannelCount;
			doc.song.noiseChannelCount = newNoiseChannelCount;
			doc.song.modChannelCount = newModChannelCount;

			for (
				let channelIndex: number = 0;
				channelIndex < doc.song.getChannelCount();
				channelIndex++
			) {
				doc.song.channels[channelIndex] = newChannels[channelIndex];
			}
			doc.song.channels.length = doc.song.getChannelCount();

			doc.channel = Math.min(
				doc.channel,
				newPitchChannelCount + newNoiseChannelCount + newModChannelCount - 1,
			);

			// Determine if any mod instruments now refer to an invalid channel. Unset them if so
			for (
				let channelIndex: number = doc.song.pitchChannelCount + doc.song.noiseChannelCount;
				channelIndex < doc.song.getChannelCount();
				channelIndex++
			) {
				for (
					let instrumentIdx: number = 0;
					instrumentIdx < doc.song.channels[channelIndex].instruments.length;
					instrumentIdx++
				) {
					for (let mod: number = 0; mod < Config.modCount; mod++) {
						const instrument: Instrument =
							doc.song.channels[channelIndex].instruments[instrumentIdx];
						const modChannel: number = instrument.modChannels[mod];

						// Boundary checking
						if (
							(modChannel >= doc.song.pitchChannelCount &&
								modChannel < oldPitchCount) ||
							modChannel >= doc.song.pitchChannelCount + doc.song.noiseChannelCount
						) {
							instrument.modulators[mod] = Config.modulators.dictionary.none.index;
						}

						// Bump indices - new pitch channel added, bump all noise mods.
						if (modChannel >= oldPitchCount && oldPitchCount < newPitchChannelCount) {
							instrument.modChannels[mod] += newPitchChannelCount - oldPitchCount;
						}
					}
				}
			}

			doc.notifier.changed();

			ColorConfig.resetColors();

			this._didSomething();
		}
	}
}

export class ChangeAddChannel extends ChangeGroup {
	constructor(doc: SongDocument, index: number, isNoise: boolean, isMod: boolean) {
		super();
		const newPitchChannelCount: number =
			doc.song.pitchChannelCount + (isNoise || isMod ? 0 : 1);
		const newNoiseChannelCount: number =
			doc.song.noiseChannelCount + (!isNoise || isMod ? 0 : 1);
		const newModChannelCount: number = doc.song.modChannelCount + (isNoise || !isMod ? 0 : 1);

		if (
			newPitchChannelCount <= Config.pitchChannelCountMax &&
			newNoiseChannelCount <= Config.noiseChannelCountMax &&
			newModChannelCount <= Config.modChannelCountMax
		) {
			const addedChannelIndex: number = isMod
				? doc.song.pitchChannelCount + doc.song.noiseChannelCount + doc.song.modChannelCount
				: isNoise
					? doc.song.pitchChannelCount + doc.song.noiseChannelCount
					: doc.song.pitchChannelCount;
			this.append(
				new ChangeChannelCount(
					doc,
					newPitchChannelCount,
					newNoiseChannelCount,
					newModChannelCount,
				),
			);
			if (addedChannelIndex - 1 >= index) {
				this.append(new ChangeChannelOrder(doc, index, addedChannelIndex - 1, 1));
			}

			doc.synth.computeLatestModValues();
			doc.recalcChannelNames = true;
		}
	}
}

export class ChangeCloneChannel extends ChangeGroup {
	constructor(doc: SongDocument, sourceIndex: number) {
		super();
		const isNoise: boolean = doc.song.getChannelIsNoise(sourceIndex);
		const isMod: boolean = doc.song.getChannelIsMod(sourceIndex);
		const destIndex: number = sourceIndex + 1;

		const newPitchChannelCount: number =
			doc.song.pitchChannelCount + (isNoise || isMod ? 0 : 1);
		const newNoiseChannelCount: number =
			doc.song.noiseChannelCount + (!isNoise || isMod ? 0 : 1);
		const newModChannelCount: number = doc.song.modChannelCount + (isNoise || !isMod ? 0 : 1);

		if (
			newPitchChannelCount <= Config.pitchChannelCountMax &&
			newNoiseChannelCount <= Config.noiseChannelCountMax &&
			newModChannelCount <= Config.modChannelCountMax
		) {
			// Add a blank channel of the same type at destIndex
			this.append(new ChangeAddChannel(doc, destIndex, isNoise, isMod));

			// Deep-copy source channel data into the new destination channel
			const src: Channel = doc.song.channels[sourceIndex];
			const dst: Channel = doc.song.channels[destIndex];

			dst.name = src.name;
			dst.octave = src.octave;
			dst.muted = src.muted;

			// Copy bars (pattern index references)
			dst.bars.length = 0;
			for (let i: number = 0; i < src.bars.length; i++) {
				dst.bars[i] = src.bars[i];
			}

			// Deep-copy instruments via JSON roundtrip
			dst.instruments.length = 0;
			for (const instrument of src.instruments) {
				const instrumentCopy: Record<string, unknown> = instrument.toJsonObject() as Record<
					string,
					unknown
				>;
				instrumentCopy.isDrum = isNoise;
				instrumentCopy.isMod = isMod;
				const newInstrument: Instrument = new Instrument(isNoise, isMod);
				newInstrument.fromJsonObject(
					instrumentCopy,
					isNoise,
					isMod,
					doc.song.rhythm === 0 || doc.song.rhythm === 2,
					doc.song.rhythm >= 2,
				);
				preserveOrTagInstrumentWithModule(newInstrument, instrument);
				dst.instruments.push(newInstrument);
			}

			// Deep-copy patterns (notes + instrument references)
			dst.patterns.length = 0;
			for (const pattern of src.patterns) {
				const newPattern: Pattern = new Pattern();
				newPattern.notes = pattern.cloneNotes();
				newPattern.instruments.length = 0;
				newPattern.instruments.push(...pattern.instruments);
				dst.patterns.push(newPattern);
			}

			doc.synth.computeLatestModValues();
			doc.recalcChannelNames = true;
			doc.notifier.changed();
		}
	}
}

export class ChangeRemoveChannel extends ChangeGroup {
	constructor(doc: SongDocument, minIndex: number, maxIndex: number) {
		super();

		const oldMax: number = maxIndex;

		// Update modulators - if a higher index was removed, shift down
		for (
			let modChannel: number = doc.song.pitchChannelCount + doc.song.noiseChannelCount;
			modChannel < doc.song.channels.length;
			modChannel++
		) {
			for (
				let instrumentIndex: number = 0;
				instrumentIndex < doc.song.channels[modChannel].instruments.length;
				instrumentIndex++
			) {
				const modInstrument: Instrument =
					doc.song.channels[modChannel].instruments[instrumentIndex];
				for (let mod: number = 0; mod < Config.modCount; mod++) {
					if (
						modInstrument.modChannels[mod] >= minIndex &&
						modInstrument.modChannels[mod] <= oldMax
					) {
						this.append(new ChangeModChannel(doc, mod, 0, modInstrument));
					} else if (modInstrument.modChannels[mod] > oldMax) {
						this.append(
							new ChangeModChannel(
								doc,
								mod,
								modInstrument.modChannels[mod] - (oldMax - minIndex + 1) + 2,
								modInstrument,
							),
						);
					}
				}
			}
		}

		while (maxIndex >= minIndex) {
			const isNoise: boolean = doc.song.getChannelIsNoise(maxIndex);
			const isMod: boolean = doc.song.getChannelIsMod(maxIndex);
			doc.song.channels.splice(maxIndex, 1);
			if (isNoise) {
				doc.song.noiseChannelCount--;
			} else if (isMod) {
				doc.song.modChannelCount--;
			} else {
				doc.song.pitchChannelCount--;
			}
			maxIndex--;
		}

		if (doc.song.pitchChannelCount < Config.pitchChannelCountMin) {
			this.append(
				new ChangeChannelCount(
					doc,
					Config.pitchChannelCountMin,
					doc.song.noiseChannelCount,
					doc.song.modChannelCount,
				),
			);
		}

		ColorConfig.resetColors();
		doc.recalcChannelNames = true;

		this.append(new ChangeChannelBar(doc, Math.max(0, minIndex - 1), doc.bar));

		doc.synth.computeLatestModValues();

		this._didSomething();
		doc.notifier.changed();
	}
}

export class ChangeChannelBar extends Change {
	constructor(doc: SongDocument, newChannel: number, newBar: number, silently: boolean = false) {
		super();
		const oldChannel: number = doc.channel;
		const oldBar: number = doc.bar;
		doc.channel = newChannel;
		doc.bar = newBar;
		if (!silently) {
			doc.selection.scrollToSelectedPattern();
		}
		// Mod channels always jump to viewing the active instrument for the mod.
		if (doc.song.getChannelIsMod(doc.channel)) {
			const pattern: Pattern | null = doc.song.getPattern(doc.channel, doc.bar);
			if (pattern != null) {
				doc.viewedInstrument[doc.channel] = pattern.instruments[0];
			}
		}
		doc.notifier.changed();
		if (oldChannel !== newChannel || oldBar !== newBar) {
			this._didSomething();
		}
	}
}

export class ChangeOctave extends ChangeFieldValue<number> {
	constructor(
		doc: SongDocument,
		public oldValue: number,
		newValue: number,
	) {
		super(doc, {
			target: doc.song.channels[doc.channel],
			property: "octave",
			oldValue,
			newValue,
		});
	}
}

export class ChangeRhythm extends ChangeGroup {
	constructor(doc: SongDocument, newValue: number) {
		super();

		if (doc.song.rhythm !== newValue) {
			doc.song.rhythm = newValue;
			doc.notifier.changed();
			this._didSomething();
		}
	}
}

export class ChangeKey extends ChangeFieldValue<number> {
	constructor(doc: SongDocument, newValue: number) {
		super(doc, {
			target: doc.song,
			property: "key",
			oldValue: doc.song.key,
			newValue,
		});
	}
}

export class ChangeLoop extends Change {
	constructor(
		private _doc: SongDocument,
		public oldStart: number,
		public oldLength: number,
		public newStart: number,
		public newLength: number,
	) {
		super();
		this._doc.song.loopStart = this.newStart;
		this._doc.song.loopLength = this.newLength;
		this._doc.notifier.changed();
		if (this.oldStart !== this.newStart || this.oldLength !== this.newLength) {
			this._didSomething();
		}
	}
}

export class ChangeKeyOctave extends ChangeFieldValue<number> {
	constructor(doc: SongDocument, oldValue: number, newValue: number) {
		super(doc, {
			target: doc.song,
			property: "octave",
			oldValue,
			newValue,
			clamp: { min: Config.octaveMin, max: Config.octaveMax },
		});
	}
}

export class ChangeTempo extends ChangeFieldValue<number> {
	constructor(doc: SongDocument, oldValue: number, newValue: number) {
		super(doc, {
			target: doc.song,
			property: "tempo",
			oldValue,
			newValue,
			clamp: { min: Config.tempoMin, max: Config.tempoMax },
			unsetModKey: Config.modulators.dictionary.tempo.index,
		});
	}
}

export class ChangeSongReverb extends ChangeFieldValue<number> {
	constructor(doc: SongDocument, oldValue: number, newValue: number) {
		super(doc, {
			target: doc.song,
			property: "reverb",
			oldValue,
			newValue,
			unsetModKey: Config.modulators.dictionary["song reverb"].index,
		});
	}
}

export class ChangeVolume extends ChangeFieldValue<number> {
	constructor(doc: SongDocument, oldValue: number, newValue: number) {
		super(doc, {
			target: doc.getCurrentInstrumentObj(),
			property: "volume",
			oldValue,
			newValue,
		});
	}
}

export class ChangeSongTitle extends ChangeFieldValue<string> {
	constructor(doc: SongDocument, oldValue: string, newValue: string) {
		super(doc, {
			target: doc.song,
			property: "title",
			oldValue,
			newValue,
			maxLength: 30,
			afterSet: () => {
				document.title = `${doc.song.title} - ${EditorConfig.versionDisplayName}`;
			},
		});
	}
}

export class ChangeChannelName extends ChangeFieldValue<string> {
	constructor(doc: SongDocument, oldValue: string, newValue: string) {
		super(doc, {
			target: doc.song.channels[doc.muteEditorChannel],
			property: "name",
			oldValue,
			newValue,
			maxLength: 15,
			afterSet: () => {
				doc.recalcChannelNames = true;
			},
		});
	}
}

export class ChangePan extends ChangeFieldValue<number> {
	constructor(doc: SongDocument, oldValue: number, newValue: number) {
		super(doc, {
			target: doc.getCurrentInstrumentObj(),
			property: "pan",
			oldValue,
			newValue,
			unsetModKey: Config.modulators.dictionary.pan.index,
		});
	}
}

export class ChangePanDelay extends ChangeFieldValue<number> {
	constructor(doc: SongDocument, oldValue: number, newValue: number) {
		super(doc, {
			target: doc.getCurrentInstrumentObj(),
			property: "panDelay",
			oldValue,
			newValue,
		});
	}
}

export class ChangeViewInstrument extends Change {
	constructor(doc: SongDocument, index: number) {
		super();
		if (doc.viewedInstrument[doc.channel] !== index) {
			doc.viewedInstrument[doc.channel] = index;
			if (doc.channel >= doc.song.pitchChannelCount + doc.song.noiseChannelCount) {
				doc.recentPatternInstruments[doc.channel] = [index];
			}
			doc.notifier.changed();
			this._didSomething();
		}
	}
}

export class ChangeInstrumentsFlags extends Change {
	constructor(doc: SongDocument, newLayeredInstruments: boolean, newPatternInstruments: boolean) {
		super();
		const oldLayeredInstruments: boolean = doc.song.layeredInstruments;
		const oldPatternInstruments: boolean = doc.song.patternInstruments;
		if (
			oldLayeredInstruments === newLayeredInstruments &&
			oldPatternInstruments === newPatternInstruments
		)
			return;
		doc.song.layeredInstruments = newLayeredInstruments;
		doc.song.patternInstruments = newPatternInstruments;

		for (
			let channelIndex: number = 0;
			channelIndex < doc.song.getChannelCount();
			channelIndex++
		) {
			const channel: Channel = doc.song.channels[channelIndex];
			if (channel.instruments.length > doc.song.getMaxInstrumentsPerChannel()) {
				channel.instruments.length = doc.song.getMaxInstrumentsPerChannel();
			}
			for (let j: number = 0; j < doc.song.patternsPerChannel; j++) {
				const pattern: Pattern = channel.patterns[j];
				if (!oldPatternInstruments && newPatternInstruments) {
					// patternInstruments was enabled, set up pattern instruments as appropriate.
					for (let i: number = 0; i < channel.instruments.length; i++) {
						pattern.instruments[i] = i;
					}
					pattern.instruments.length = channel.instruments.length;
				}
				discardInvalidPatternInstruments(pattern.instruments, doc.song, channelIndex);
			}
		}

		doc.notifier.changed();
		this._didSomething();
	}
}

export class ChangeModChannel extends Change {
	constructor(doc: SongDocument, mod: number, index: number, useInstrument?: Instrument) {
		super();
		let instrument: Instrument = doc.getCurrentInstrumentObj();
		if (useInstrument !== undefined) {
			instrument = useInstrument;
		}

		// None, or swapping from song to instrument/vice-versa
		const modulator = Config.modulators[instrument.modulators[mod]];
		const resetsToNone =
			index === 0 || (modulator.forSong && index >= 2) || (!modulator.forSong && index < 2);
		if (resetsToNone) {
			instrument.modulators[mod] = Config.modulators.dictionary.none.index;
		}

		instrument.modChannels[mod] = index - 2;

		doc.notifier.changed();
		this._didSomething();
	}
}

export class ChangeModInstrument extends Change {
	constructor(doc: SongDocument, mod: number, tgtInstrument: number) {
		super();

		const instrument: Instrument = doc.getCurrentInstrumentObj();

		if (instrument.modInstruments[mod] !== tgtInstrument) {
			instrument.modInstruments[mod] = tgtInstrument;

			doc.notifier.changed();
			this._didSomething();
		}
	}
}

export class ChangeModSetting extends Change {
	constructor(doc: SongDocument, mod: number, text: string) {
		super();

		const instrument: Instrument = doc.getCurrentInstrumentObj();

		// Populate all instruments that could be targeted by this mod setting.
		const tgtChannel: number = instrument.modChannels[mod];
		let usedInstruments: Instrument[] = [];
		if (tgtChannel >= 0) {
			// Ignore song/none.
			if (
				instrument.modInstruments[mod] === doc.song.channels[tgtChannel].instruments.length
			) {
				// All - Populate list of all instruments
				usedInstruments = usedInstruments.concat(doc.song.channels[tgtChannel].instruments);
			} else if (
				instrument.modInstruments[mod] > doc.song.channels[tgtChannel].instruments.length
			) {
				// Active - Populate list of only used instruments
				const tgtPattern: Pattern | null = doc.song.getPattern(tgtChannel, doc.bar);
				if (tgtPattern != null) {
					for (let i: number = 0; i < tgtPattern.instruments.length; i++) {
						usedInstruments.push(
							doc.song.channels[tgtChannel].instruments[tgtPattern.instruments[i]],
						);
					}
				}
			} else {
				// Single instrument used.
				usedInstruments.push(
					doc.song.channels[tgtChannel].instruments[instrument.modInstruments[mod]],
				);
			}
		}

		// Check if a new effect is being added - if so add the proper associated effect to the instrument(s), and truncate "+ " from start of text.
		if (text.startsWith("+ ")) {
			text = text.substr(2);
			for (let i: number = 0; i < usedInstruments.length; i++) {
				const tgtInstrument: Instrument = usedInstruments[i];
				if (
					!(
						tgtInstrument.effects &
						(1 << Config.modulators.dictionary[text].associatedEffect)
					)
				) {
					doc.record(
						new ChangeToggleEffects(
							doc,
							Config.modulators.dictionary[text].associatedEffect,
							tgtInstrument,
						),
					);
				}
			}
		}

		const setting: number = Config.modulators.dictionary[text].index;

		if (instrument.modulators[mod] !== setting) {
			instrument.modulators[mod] = setting;

			// Go through each pattern where this instrument is set, and clean up any notes that are out of bounds
			const cap: number = Config.modulators[setting].maxRawVol;

			for (let i: number = 0; i < doc.song.patternsPerChannel; i++) {
				const pattern: Pattern = doc.song.channels[doc.channel].patterns[i];
				if (pattern.instruments[0] === doc.getCurrentInstrument()) {
					for (let j: number = 0; j < pattern.notes.length; j++) {
						const note: Note = pattern.notes[j];
						if (note.pitches[0] === Config.modCount - mod - 1) {
							for (let k: number = 0; k < note.pins.length; k++) {
								const pin: NotePin = note.pins[k];
								if (pin.size > cap) {
									pin.size = cap;
								}
							}
						}
					}
				}
			}

			doc.notifier.changed();
			this._didSomething();
		}
	}
}

export class ChangeModFilter extends Change {
	constructor(doc: SongDocument, mod: number, type: number) {
		super();

		const instrument: Instrument = doc.getCurrentInstrumentObj();

		if (instrument.modFilterTypes[mod] !== type) {
			instrument.modFilterTypes[mod] = type;

			// Go through each pattern where this instrument is set, and clean up any notes that are out of bounds
			const cap: number = doc.song.getVolumeCapForSetting(
				true,
				instrument.modulators[mod],
				instrument.modFilterTypes[mod],
			);

			for (let i: number = 0; i < doc.song.patternsPerChannel; i++) {
				const pattern: Pattern = doc.song.channels[doc.channel].patterns[i];
				if (pattern.instruments[0] === doc.getCurrentInstrument()) {
					for (let j: number = 0; j < pattern.notes.length; j++) {
						const note: Note = pattern.notes[j];
						if (note.pitches[0] === Config.modCount - mod - 1) {
							for (let k: number = 0; k < note.pins.length; k++) {
								const pin: NotePin = note.pins[k];
								if (pin.size > cap) {
									pin.size = cap;
								}
							}
						}
					}
				}
			}

			doc.notifier.changed();
			this._didSomething();
		}
	}
}

export class ChangeModEnvelope extends Change {
	constructor(doc: SongDocument, mod: number, envelope: number) {
		super();

		const instrument: Instrument = doc.getCurrentInstrumentObj();

		if (instrument.modEnvelopeNumbers[mod] !== envelope) {
			instrument.modEnvelopeNumbers[mod] = envelope;

			// Go through each pattern where this instrument is set, and clean up any notes that are out of bounds
			const cap: number = doc.song.getVolumeCapForSetting(
				true,
				instrument.modulators[mod],
				instrument.modEnvelopeNumbers[mod],
			);

			for (let i: number = 0; i < doc.song.patternsPerChannel; i++) {
				const pattern: Pattern = doc.song.channels[doc.channel].patterns[i];
				if (pattern.instruments[0] === doc.getCurrentInstrument()) {
					for (let j: number = 0; j < pattern.notes.length; j++) {
						const note: Note = pattern.notes[j];
						if (note.pitches[0] === Config.modCount - mod - 1) {
							for (let k: number = 0; k < note.pins.length; k++) {
								const pin: NotePin = note.pins[k];
								if (pin.size > cap) {
									pin.size = cap;
								}
							}
						}
					}
				}
			}

			doc.notifier.changed();
			this._didSomething();
		}
	}
}

export class ChangeAddChannelInstrument extends Change {
	constructor(doc: SongDocument) {
		super();
		const channel: Channel = doc.song.channels[doc.channel];
		const isNoise: boolean = doc.song.getChannelIsNoise(doc.channel);
		const isMod: boolean = doc.song.getChannelIsMod(doc.channel);
		const maxInstruments: number = doc.song.getMaxInstrumentsPerChannel();
		if (channel.instruments.length >= maxInstruments) return;
		const presetValue: number = pickRandomPresetValue(isNoise, false);
		const preset: Preset = EditorConfig.valueToPreset(presetValue)!;
		const instrument: Instrument = new Instrument(isNoise, isMod);
		instrument.fromJsonObject(preset.settings, isNoise, isMod, false, false, 1);
		instrument.preset = presetValue;
		instrument.effects |= 1 << EffectType.panning;
		instrument.volume = 0;
		tagInstrumentWithModule(instrument);
		channel.instruments.push(instrument);
		if (!isMod) {
			// Mod channels lose information when changing set instrument
			doc.viewedInstrument[doc.channel] = channel.instruments.length - 1;
		}

		// Determine if any mod instruments were setting 'all' or 'active'. If so, bump indices since there is now a new instrument in the list.
		for (
			let channelIndex: number = doc.song.pitchChannelCount + doc.song.noiseChannelCount;
			channelIndex < doc.song.getChannelCount();
			channelIndex++
		) {
			for (
				let instrumentIndex: number = 0;
				instrumentIndex < doc.song.channels[channelIndex].instruments.length;
				instrumentIndex++
			) {
				for (let mod: number = 0; mod < Config.modCount; mod++) {
					const instrument: Instrument =
						doc.song.channels[channelIndex].instruments[instrumentIndex];
					const modInstrument: number = instrument.modInstruments[mod];
					const modChannel: number = instrument.modChannels[mod];

					if (
						modChannel === doc.channel &&
						modInstrument >= doc.song.channels[modChannel].instruments.length - 1
					) {
						// BUGFIX FROM JUMMBOX
						instrument.modInstruments[mod]++;
					}
				}
			}
		}
		// Also, make synth re-compute mod values, since 'all'/'active' mods now retroactively apply to this new instrument.
		doc.synth.computeLatestModValues();

		doc.notifier.changed();
		this._didSomething();
	}
}

export class ChangeRemoveChannelInstrument extends Change {
	constructor(doc: SongDocument) {
		super();
		const channel: Channel = doc.song.channels[doc.channel];
		if (channel.instruments.length <= Config.instrumentCountMin) return;
		const removedIndex: number = doc.viewedInstrument[doc.channel];
		channel.instruments.splice(removedIndex, 1);
		if (doc.song.patternInstruments) {
			for (const pattern of channel.patterns) {
				for (let i: number = 0; i < pattern.instruments.length; i++) {
					if (pattern.instruments[i] === removedIndex) {
						pattern.instruments.splice(i, 1);
						i--;
					} else if (pattern.instruments[i] > removedIndex) {
						pattern.instruments[i]--;
					}
				}
				if (pattern.instruments.length <= 0) {
					pattern.instruments[0] = 0;
				}
			}
		}

		// Determine if any mod instruments now refer to an invalid instrument number. Unset them if so
		for (
			let channelIndex: number = doc.song.pitchChannelCount + doc.song.noiseChannelCount;
			channelIndex < doc.song.getChannelCount();
			channelIndex++
		) {
			for (
				let instrumentIdx: number = 0;
				instrumentIdx < doc.song.channels[channelIndex].instruments.length;
				instrumentIdx++
			) {
				for (let mod: number = 0; mod < Config.modCount; mod++) {
					const instrument: Instrument =
						doc.song.channels[channelIndex].instruments[instrumentIdx];
					const modInstrument: number = instrument.modInstruments[mod];
					const modChannel: number = instrument.modChannels[mod];

					if (modChannel === doc.channel) {
						// Boundary checking - check if setting was 'all' or 'active' previously
						if (modInstrument > removedIndex) {
							instrument.modInstruments[mod]--;
						} // Boundary checking - check if setting was set to the last instrument before splice
						else if (modInstrument === removedIndex) {
							instrument.modInstruments[mod] = 0;
							instrument.modulators[mod] = 0;
						}
					}
				}
			}
		}

		doc.notifier.changed();
		this._didSomething();
	}
}

export class ChangeBeatsPerBar extends ChangeGroup {
	constructor(doc: SongDocument, newValue: number, strategy: string) {
		super();
		if (doc.song.beatsPerBar !== newValue) {
			switch (strategy) {
				case "splice":
					{
						if (doc.song.beatsPerBar > newValue) {
							const sequence: ChangeSequence = new ChangeSequence();
							for (let i: number = 0; i < doc.song.getChannelCount(); i++) {
								for (
									let j: number = 0;
									j < doc.song.channels[i].patterns.length;
									j++
								) {
									sequence.append(
										new ChangeNoteTruncate(
											doc,
											doc.song.channels[i].patterns[j],
											newValue * Config.partsPerBeat,
											doc.song.beatsPerBar * Config.partsPerBeat,
											null,
											true,
										),
									);
								}
							}
						}
					}
					break;
				case "stretch":
					{
						const changeRhythm = (oldTime: number): number =>
							Math.round((oldTime * newValue) / doc.song.beatsPerBar);
						for (
							let channelIndex: number = 0;
							channelIndex < doc.song.getChannelCount();
							channelIndex++
						) {
							for (
								let patternIndex: number = 0;
								patternIndex < doc.song.channels[channelIndex].patterns.length;
								patternIndex++
							) {
								const pattern: Pattern =
									doc.song.channels[channelIndex].patterns[patternIndex];
								let noteIndex: number = 0;
								while (noteIndex < pattern.notes.length) {
									const note: Note = pattern.notes[noteIndex];
									if (changeRhythm(note.start) >= changeRhythm(note.end)) {
										this.append(
											new ChangeNoteAdded(
												doc,
												pattern,
												note,
												noteIndex,
												true,
											),
										);
									} else {
										this.append(new ChangeRhythmNote(doc, note, changeRhythm));
										noteIndex++;
									}
								}
							}
						}
						this.append(
							new ChangeTempo(
								doc,
								doc.song.tempo,
								(doc.song.tempo * newValue) / doc.song.beatsPerBar,
							),
						);
					}
					break;
				case "overflow":
					{
						this.append(new ChangeMoveAndOverflowNotes(doc, newValue, 0));
						doc.song.loopStart = 0;
						doc.song.loopLength = doc.song.barCount;
					}
					break;
				default:
					throw new Error("Unrecognized beats-per-bar conversion strategy.");
			}

			doc.song.beatsPerBar = newValue;
			doc.notifier.changed();
			this._didSomething();
		}
	}
}

export function pickRandomPresetValue(isNoise: boolean, rollNoveltyPresets: boolean): number {
	const eligiblePresetValues: number[] = [];
	const _presetTagsInputBox = document.getElementById(
		"presetTagsInputBox",
	) as HTMLInputElement | null;

	const tagList: string[] = _presetTagsInputBox
		? _presetTagsInputBox.value
				.toLowerCase()
				.split(/\s+/)
				.filter((t) => t !== "")
		: [];

	// checking for valid tags
	if (
		tagList.length > 0 &&
		!tagList.every(
			(tag) =>
				fullTagList.includes(tag) ||
				(tag.startsWith("!") && fullTagList.includes(tag.slice(1))),
		)
	) {
		return -2;
	}

	for (
		let categoryIndex: number = 0;
		categoryIndex < EditorConfig.presetCategories.length;
		categoryIndex++
	) {
		const category: PresetCategory = EditorConfig.presetCategories[categoryIndex];
		if (
			(category.name.includes("Novelty") && !rollNoveltyPresets) ||
			category.name === "Unmodified"
		)
			continue;
		for (let presetIndex: number = 0; presetIndex < category.presets.length; presetIndex++) {
			const preset: Preset = category.presets[presetIndex];
			if (presetMatchesFilter(preset, isNoise, tagList)) {
				eligiblePresetValues.push((categoryIndex << 12) + presetIndex);
			}
		}
	}
	if (eligiblePresetValues.length > 0) {
		return eligiblePresetValues[(Math.random() * eligiblePresetValues.length) | 0];
	} else {
		return -1; // no results
	}
}

export function pickNextPresetValue(isNoise: boolean, rollNoveltyPresets: boolean): number {
	const eligiblePresetValues: number[] = [];
	const _presetTagsInputBox = document.getElementById(
		"presetTagsInputBox",
	) as HTMLInputElement | null;
	const _pitchedPresetSelect = document.getElementById(
		"pitchPresetSelect",
	) as HTMLInputElement | null;
	const _drumPresetSelect = document.getElementById(
		"drumPresetSelect",
	) as HTMLInputElement | null;

	let currentPresetValue: string | number = 0;
	let nextPresetIndex: string | number = 0;

	if (isNoise) currentPresetValue = _drumPresetSelect?.value ?? 0;
	else currentPresetValue = _pitchedPresetSelect?.value ?? 0;

	const tagList: string[] = _presetTagsInputBox
		? _presetTagsInputBox.value
				.toLowerCase()
				.split(/\s+/)
				.filter((t) => t !== "")
		: [];

	// checking for valid tags
	if (
		tagList.length > 0 &&
		!tagList.every(
			(tag) =>
				fullTagList.includes(tag) ||
				(tag.startsWith("!") && fullTagList.includes(tag.slice(1))),
		)
	) {
		return -2;
	}

	for (
		let categoryIndex: number = 0;
		categoryIndex < EditorConfig.presetCategories.length;
		categoryIndex++
	) {
		const category: PresetCategory = EditorConfig.presetCategories[categoryIndex];
		if (
			(category.name.includes("Novelty") && !rollNoveltyPresets) ||
			category.name === "Unmodified"
		)
			continue;
		for (let presetIndex: number = 0; presetIndex < category.presets.length; presetIndex++) {
			const preset: Preset = category.presets[presetIndex];

			if (presetMatchesFilter(preset, isNoise, tagList)) {
				eligiblePresetValues.push((categoryIndex << 12) + presetIndex);
				if ((categoryIndex << 12) + presetIndex === currentPresetValue) {
					nextPresetIndex = eligiblePresetValues.length;
				}
			}
		}
	}

	if (eligiblePresetValues.length > 0) {
		if (eligiblePresetValues[nextPresetIndex] === undefined) nextPresetIndex = 0; // wraparound behavior
		return eligiblePresetValues[nextPresetIndex];
	} else {
		return -1; // no results
	}
}

export function setDefaultInstruments(song: Song): void {
	for (let channelIndex: number = 0; channelIndex < song.channels.length; channelIndex++) {
		for (const instrument of song.channels[channelIndex].instruments) {
			const isNoise: boolean = song.getChannelIsNoise(channelIndex);
			const isMod: boolean = song.getChannelIsMod(channelIndex);
			const presetValue: number =
				channelIndex === song.pitchChannelCount
					? EditorConfig.nameToPresetValue(
							Math.random() > 0.5 ? "chip noise" : "standard drumset",
						)!
					: pickRandomPresetValue(isNoise, false);
			const preset: Preset = EditorConfig.valueToPreset(presetValue)!;
			instrument.fromJsonObject(
				preset.settings,
				isNoise,
				isMod,
				song.rhythm === 0 || song.rhythm === 2,
				song.rhythm >= 2,
				1,
			);
			instrument.preset = presetValue;
			instrument.effects |= 1 << EffectType.panning;
			tagInstrumentWithModule(instrument);
		}
	}
}

export class ChangeSong extends ChangeGroup {
	constructor(doc: SongDocument, newHash: string, jsonFormat: string = "auto") {
		super();
		const oldSong: Song = doc.song;
		const pitchChannelCount = oldSong.pitchChannelCount;
		const noiseChannelCount = oldSong.noiseChannelCount;
		const modChannelCount = oldSong.modChannelCount;
		const oldBar: number = doc.bar;
		const oldChannel: number = doc.channel;
		const oldViewedInstrument: number[] = doc.viewedInstrument?.slice() ?? [];
		const oldRecentPatternInstruments: number[][] =
			doc.recentPatternInstruments?.map((instruments) => instruments.slice()) ?? [];
		const oldSelection = doc.selection?.toJSON?.();
		const oldBarScrollPos: number = doc.barScrollPos;
		const oldChannelScrollPos: number = doc.channelScrollPos;
		let swapped: boolean = false;
		try {
			const decodedSong = decodeEditorSong(
				newHash,
				oldSong.customSampleHandler ?? createCustomSampleHandler(),
				jsonFormat,
			);
			doc.song = decodedSong;
			swapped = true;
			doc.synth.setSong(decodedSong);
			if (
				pitchChannelCount !== doc.song.pitchChannelCount ||
				noiseChannelCount !== doc.song.noiseChannelCount ||
				modChannelCount !== doc.song.modChannelCount
			) {
				ColorConfig.resetColors();
			}
			doc.bar = 0;
			doc.channel = 0;
			doc.barScrollPos = 0;
			doc.channelScrollPos = 0;
			this.append(new ChangePatternSelection(doc, 0, 0));
			doc.selection.resetBoxSelection();
			const channelCount: number = doc.song.channels.length;
			doc.viewedInstrument.length = 0;
			doc.recentPatternInstruments.length = 0;
			for (let i: number = 0; i < channelCount; i++) {
				doc.viewedInstrument[i] = 0;
				doc.recentPatternInstruments[i] = [0];
			}
			if (newHash === "") {
				setDefaultInstruments(doc.song);
				doc.song.scale = doc.prefs.defaultScale;
			} else {
				this.append(new ChangeValidateTrackSelection(doc));
			}
			doc.synth.computeLatestModValues();
			doc.notifier.changed();
			this._didSomething();
		} catch (error) {
			if (swapped) {
				doc.song = oldSong;
				doc.synth.setSong(oldSong);
				doc.bar = oldBar;
				doc.channel = oldChannel;
				doc.barScrollPos = oldBarScrollPos;
				doc.channelScrollPos = oldChannelScrollPos;
				if (doc.viewedInstrument != null) {
					doc.viewedInstrument.splice(
						0,
						doc.viewedInstrument.length,
						...oldViewedInstrument,
					);
				}
				if (doc.recentPatternInstruments != null) {
					doc.recentPatternInstruments.splice(
						0,
						doc.recentPatternInstruments.length,
						...oldRecentPatternInstruments,
					);
				}
				if (oldSelection != null) doc.selection.fromJSON(oldSelection);
				doc.synth.computeLatestModValues();
			}
			throw error;
		}

		// Commit point: decoding, validation, synth sync, and notification all
		// succeeded. Transport mutation destructively releases live audio state
		// and must never be followed by scalar rollback.
		doc.synth.pause();
		doc.synth.goToBar(0);
	}
}

export class ChangeOctaveCount extends Change {
	constructor(doc: SongDocument, newValue: number) {
		super();
		if (doc.song.octaveCount !== newValue) {
			doc.song.octaveCount = newValue;
			doc.notifier.changed();
			this._didSomething();
		}
	}
}
