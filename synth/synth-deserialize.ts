// synth-deserialize.ts
//
// Purpose: URL hash decoding for songs (fromBase64StringImpl)
//
// This module:
// - Reads a base64 URL hash string and populates a SongLike with decoded data
// - Handles version compatibility across BeepBox, JummBox, GoldBox, UltraBox, SlarmoosBox, JukeBox formats
// - Extracted from song-serialization.ts

import { Channel } from "./channels";
import { Deque } from "./deque";
import { decodeVariant } from "./deserialize/decode-variant";
import { loadCustomSamples } from "./deserialize/load-custom-samples";
import { FilterControlPoint, FilterSettings, Instrument, LegacySettings } from "./instruments";
import { makeNotePin, Note, NotePin, Pattern } from "./notes";
import { getPlugin } from "./plugins";
import {
	BitFieldReader,
	base64CharCodeToInt,
	CharCode,
	decode32BitNumber,
	SongTagCode,
} from "./serialization";
import { JsonFieldReader } from "./socket/json-serde-adapter";
import { getInstrument } from "./socket/registry";
import { getNeededBits, type SongLike } from "./song-serialization";
import {
	ENV_LFO,
	ENV_NONE,
	ENV_NOTESIZE,
	ENV_PITCH,
	ENV_PUNCH,
	ENV_RANDOM,
} from "./song-serialization-shared";
import { clearSamples, envelopeFromLegacyIndex } from "./song-utilities";
import {
	Config,
	EffectType,
	EnvelopeType,
	effectsIncludeBitcrusher,
	effectsIncludeChord,
	effectsIncludeChorus,
	effectsIncludeDetune,
	effectsIncludeDistortion,
	effectsIncludeEcho,
	effectsIncludeGranular,
	effectsIncludeInvertWave,
	effectsIncludeNoteFilter,
	effectsIncludeNoteRange,
	effectsIncludePanning,
	effectsIncludePhaser,
	effectsIncludePitchShift,
	effectsIncludeReverb,
	effectsIncludeRingModulation,
	effectsIncludeTransition,
	effectsIncludeVibrato,
	FilterType,
	getRegisteredInstrumentTypeCount,
	InstrumentType,
	LFOEnvelopeTypes,
	loadBuiltInSamples,
	RandomEnvelopeTypes,
	SustainType,
} from "./synth-config";
import {
	clamp,
	convertLegacyKeyToKeyAndOctave,
	secondsToFadeInSetting,
	ticksToFadeOutSetting,
	validateRange,
} from "./util";

export class SongDataError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SongDataError";
	}
}

function malformed(message: string): never {
	throw new SongDataError(message);
}

function decodeSongText(value: string, label: string): string {
	try {
		return decodeURIComponent(value);
	} catch (error) {
		if (error instanceof URIError) throw new SongDataError(`Invalid ${label} encoding.`);
		throw error;
	}
}

function decodeJsonBlob(
	compressed: string,
	charIndex: number,
	label: string,
): { value: Record<string, unknown>; nextIndex: number } {
	if (charIndex + 6 > compressed.length) malformed(`Invalid ${label} length.`);
	for (let i: number = 0; i < 6; i++) {
		const digit: number = base64CharCodeToInt[compressed.charCodeAt(charIndex + i)];
		if (!Number.isInteger(digit) || digit < 0 || digit > 63 || (i === 0 && digit > 3)) {
			malformed(`Invalid ${label} length.`);
		}
	}
	const [blobLength, blobIndex] = decode32BitNumber(compressed, charIndex);
	const nextIndex: number = blobIndex + blobLength;
	if (!Number.isSafeInteger(blobLength) || blobLength < 0 || nextIndex > compressed.length) {
		malformed(`Invalid ${label} length.`);
	}
	try {
		const decoded: unknown = JSON.parse(atob(compressed.substring(blobIndex, nextIndex)));
		if (typeof decoded !== "object" || decoded == null || Array.isArray(decoded)) {
			malformed(`Invalid ${label} structure.`);
		}
		return { value: decoded as Record<string, unknown>, nextIndex };
	} catch (error) {
		if (error instanceof SongDataError) throw error;
		if (
			error instanceof SyntaxError ||
			error instanceof DOMException ||
			(typeof error === "object" &&
				error != null &&
				"name" in error &&
				error.name === "InvalidCharacterError")
		) {
			throw new SongDataError(`Invalid ${label}.`);
		}
		throw error;
	}
}

function validateSongJsonShape(value: unknown, jsonFormat: string): asserts value is object {
	if (typeof value !== "object" || value == null || Array.isArray(value)) {
		malformed("Song JSON must be an object.");
	}
	const record = value as Record<string, unknown>;
	if (jsonFormat === "auto" && typeof record.format !== "string") {
		malformed("Song JSON format must be a string.");
	}
	if (record.channels !== undefined && !Array.isArray(record.channels)) {
		malformed("Song JSON channels must be an array.");
	}
	if (
		record.customSamples !== undefined &&
		(!Array.isArray(record.customSamples) ||
			record.customSamples.some((sample) => typeof sample !== "string"))
	) {
		malformed("Song JSON custom samples must be an array of strings.");
	}
	if (record.format === "JukeboxExp" && record.version !== 1 && record.version !== 2) {
		malformed("Unsupported JukeboxExp JSON version.");
	}
}

export function repairModulatorIndex(index: number): number {
	return Config.modulators[index] == null ? Config.modulators.dictionary.none.index : index;
}

export function repairModTarget(
	channelIndex: number,
	instrumentIndex: number,
	song: SongLike,
): { channelIndex: number; instrumentIndex: number } {
	const channel = song.channels[channelIndex];
	if (
		channelIndex >= song.pitchChannelCount + song.noiseChannelCount ||
		channel == null ||
		instrumentIndex < 0 ||
		instrumentIndex >= channel.instruments.length + 2
	) {
		return { channelIndex: -2, instrumentIndex: 0 };
	}
	return { channelIndex, instrumentIndex };
}

export function fromBase64StringImpl(
	song: SongLike,
	compressed: string,
	jsonFormat: string = "auto",
): void {
	if (compressed == null || compressed === "") {
		if (song.customSampleHandler?.deferSampleLoading) {
			song.customSampleHandler.clearSamples();
		} else {
			clearSamples(song.customSampleHandler);
		}

		song.initToDefault(true);
		return;
	}

	let charIndex: number = 0;
	// skip whitespace.
	while (compressed.charCodeAt(charIndex) <= CharCode.SPACE) charIndex++;
	// skip hash mark.
	if (compressed.charCodeAt(charIndex) === CharCode.HASH) charIndex++;
	// if it starts with curly brace, treat it as JSON.
	if (compressed.charCodeAt(charIndex) === CharCode.LEFT_CURLY_BRACE) {
		let parsed: unknown;
		try {
			parsed = JSON.parse(charIndex === 0 ? compressed : compressed.substring(charIndex));
		} catch (error) {
			if (error instanceof SyntaxError) throw new SongDataError("Invalid song JSON.");
			throw error;
		}
		validateSongJsonShape(parsed, jsonFormat);
		try {
			song.fromJsonObject(parsed, jsonFormat);
		} catch (error) {
			if (error instanceof SongDataError) throw error;
			if (
				error instanceof TypeError ||
				error instanceof RangeError ||
				error instanceof URIError
			) {
				throw new SongDataError("Invalid song JSON structure.");
			}
			throw error;
		}
		return;
	}

	const result = decodeVariant(compressed, charIndex);
	if (result === null) {
		throw new SongDataError("Unsupported or invalid song version.");
	}
	charIndex = result.charIndex;
	const {
		fromBeepBox,
		fromJummBox,
		fromGoldBox,
		fromUltraBox,
		fromSlarmoosBox,
		fromJukeBox,
		beforeTwo,
		beforeThree,
		beforeFour,
		beforeFive,
		beforeSix,
		beforeSeven,
		beforeEight,
		beforeNine,
		forceSimpleFilter,
	} = result;

	song.initToDefault(
		(fromBeepBox && beforeNine) || (fromJummBox && beforeFive) || (beforeFour && fromGoldBox),
	);
	let willLoadLegacySamplesForOldSongs: boolean = false;

	if (fromJukeBox || fromSlarmoosBox || fromUltraBox || fromGoldBox) {
		compressed = loadCustomSamples(compressed, beforeThree, song);
	}

	if (beforeThree && fromBeepBox) {
		for (const channel of song.channels) {
			channel.instruments[0].transition = Config.transitions.dictionary.interrupt.index;
			channel.instruments[0].effects |= 1 << EffectType.transition;
		}
		song.channels[3].instruments[0].chipNoise = 0;
	}

	let legacySettingsCache: LegacySettings[][] | null = null;
	if ((fromBeepBox && beforeNine) || (fromJummBox && beforeFive) || (beforeFour && fromGoldBox)) {
		legacySettingsCache = [];
		for (let i: number = legacySettingsCache.length; i < song.getChannelCount(); i++) {
			legacySettingsCache[i] = [];
			for (let j: number = 0; j < Config.instrumentCountMin; j++)
				legacySettingsCache[i][j] = {};
		}
	}

	let legacyGlobalReverb: number = 0;

	let instrumentChannelIterator: number = 0;
	let instrumentIndexIterator: number = -1;
	let useSlowerArpSpeed: boolean = false;
	let useFastTwoNoteArp: boolean = false;
	while (charIndex < compressed.length) {
		switch (compressed.charCodeAt(charIndex++)) {
			case SongTagCode.songTitle:
				{
					// Length of song name string
					const songNameLength =
						(base64CharCodeToInt[compressed.charCodeAt(charIndex++)] << 6) +
						base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
					song.title = decodeSongText(
						compressed.substring(charIndex, charIndex + songNameLength),
						"song title",
					);
					song.customSampleHandler?.setDocumentTitle(song.title);

					charIndex += songNameLength;
				}
				break;
			case SongTagCode.octaveCount:
				{
					song.octaveCount = base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
				}
				break;
			case SongTagCode.channelCount:
				{
					song.pitchChannelCount =
						base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
					song.noiseChannelCount =
						base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
					if (fromBeepBox || (fromJummBox && beforeTwo)) {
						// No mod channel support before jummbox v2
						song.modChannelCount = 0;
					} else {
						song.modChannelCount =
							base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
					}
					song.pitchChannelCount = validateRange(
						Config.pitchChannelCountMin,
						Config.pitchChannelCountMax,
						song.pitchChannelCount,
					);
					song.noiseChannelCount = validateRange(
						Config.noiseChannelCountMin,
						Config.noiseChannelCountMax,
						song.noiseChannelCount,
					);
					song.modChannelCount = validateRange(
						Config.modChannelCountMin,
						Config.modChannelCountMax,
						song.modChannelCount,
					);

					for (
						let channelIndex = song.channels.length;
						channelIndex < song.getChannelCount();
						channelIndex++
					) {
						song.channels[channelIndex] = new Channel();
					}
					song.channels.length = song.getChannelCount();
					if (
						(fromBeepBox && beforeNine) ||
						(fromJummBox && beforeFive) ||
						(beforeFour && fromGoldBox)
					) {
						for (
							let i: number = legacySettingsCache!.length;
							i < song.getChannelCount();
							i++
						) {
							legacySettingsCache![i] = [];
							for (let j: number = 0; j < Config.instrumentCountMin; j++)
								legacySettingsCache![i][j] = {};
						}
					}
				}
				break;
			case SongTagCode.scale:
				{
					song.scale = clamp(
						0,
						Config.scales.length,
						base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
					);
					// All the scales were jumbled around by Jummbox. Just convert to free.
					if (song.scale === Config.scales.dictionary.Custom.index) {
						for (let i = 1; i < Config.pitchesPerOctave; i++) {
							song.scaleCustom[i] =
								base64CharCodeToInt[compressed.charCodeAt(charIndex++)] === 1; // ineffiecent? yes, but this is all that's needed for now
						}
					}
					if (fromBeepBox) song.scale = 0;
				}
				break;
			case SongTagCode.key:
				{
					if (beforeSeven && fromBeepBox) {
						song.key = clamp(
							0,
							Config.keys.length,
							11 - base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
						);
						song.octave = 0;
					} else if (fromBeepBox || fromJummBox) {
						song.key = clamp(
							0,
							Config.keys.length,
							base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
						);
						song.octave = 0;
					} else if (fromGoldBox || (beforeThree && fromUltraBox)) {
						// GoldBox (so far) didn't introduce any new keys, but old
						// songs made with early versions of UltraBox share the
						// same URL format, and those can have more keys. This
						// shouldn't really result in anything other than 0-11 for
						// the key and 0 for the octave for GoldBox songs.
						const rawKeyIndex: number =
							base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
						const [key, octave]: [number, number] =
							convertLegacyKeyToKeyAndOctave(rawKeyIndex);
						song.key = key;
						song.octave = octave;
					} else {
						song.key = clamp(
							0,
							Config.keys.length,
							base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
						);
						song.octave = clamp(
							Config.octaveMin,
							Config.octaveMax + 1,
							base64CharCodeToInt[compressed.charCodeAt(charIndex++)] +
								Config.octaveMin,
						);
					}
				}
				break;
			case SongTagCode.loopStart:
				{
					if (beforeFive && fromBeepBox) {
						song.loopStart = base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
					} else {
						song.loopStart =
							(base64CharCodeToInt[compressed.charCodeAt(charIndex++)] << 6) +
							base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
					}
				}
				break;
			case SongTagCode.loopEnd:
				{
					if (beforeFive && fromBeepBox) {
						song.loopLength = base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
					} else {
						song.loopLength =
							(base64CharCodeToInt[compressed.charCodeAt(charIndex++)] << 6) +
							base64CharCodeToInt[compressed.charCodeAt(charIndex++)] +
							1;
					}
				}
				break;
			case SongTagCode.tempo:
				{
					if (beforeFour && fromBeepBox) {
						song.tempo = [95, 120, 151, 190][
							base64CharCodeToInt[compressed.charCodeAt(charIndex++)]
						];
					} else if (beforeSeven && fromBeepBox) {
						song.tempo = [
							88, 95, 103, 111, 120, 130, 140, 151, 163, 176, 190, 206, 222, 240, 259,
						][base64CharCodeToInt[compressed.charCodeAt(charIndex++)]];
					} else {
						song.tempo =
							(base64CharCodeToInt[compressed.charCodeAt(charIndex++)] << 6) |
							base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
					}
					song.tempo = clamp(Config.tempoMin, Config.tempoMax + 1, song.tempo);
				}
				break;
			case SongTagCode.reverb:
				{
					if (beforeNine && fromBeepBox) {
						legacyGlobalReverb =
							base64CharCodeToInt[compressed.charCodeAt(charIndex++)] * 12;
						legacyGlobalReverb = clamp(0, Config.reverbRange, legacyGlobalReverb);
					} else if ((fromJummBox && beforeFive) || (beforeFour && fromGoldBox)) {
						legacyGlobalReverb =
							base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
						legacyGlobalReverb = clamp(0, Config.reverbRange, legacyGlobalReverb);
					} else {
						// Do nothing, BeepBox v9+ do not support song-wide reverb - JummBox still does via modulator.
					}
				}
				break;
			case SongTagCode.beatCount:
				{
					if (beforeThree && fromBeepBox) {
						song.beatsPerBar = [6, 7, 8, 9, 10][
							base64CharCodeToInt[compressed.charCodeAt(charIndex++)]
						];
					} else {
						song.beatsPerBar =
							base64CharCodeToInt[compressed.charCodeAt(charIndex++)] + 1;
					}
					song.beatsPerBar = Math.max(
						Config.beatsPerBarMin,
						Math.min(Config.beatsPerBarMax, song.beatsPerBar),
					);
				}
				break;
			case SongTagCode.barCount:
				{
					const barCount: number =
						(base64CharCodeToInt[compressed.charCodeAt(charIndex++)] << 6) +
						base64CharCodeToInt[compressed.charCodeAt(charIndex++)] +
						1;
					song.barCount = validateRange(Config.barCountMin, Config.barCountMax, barCount);
					for (
						let channelIndex: number = 0;
						channelIndex < song.getChannelCount();
						channelIndex++
					) {
						for (
							let bar = song.channels[channelIndex].bars.length;
							bar < song.barCount;
							bar++
						) {
							song.channels[channelIndex].bars[bar] = bar < 4 ? 1 : 0;
						}
						song.channels[channelIndex].bars.length = song.barCount;
					}
				}
				break;
			case SongTagCode.patternCount:
				{
					let patternsPerChannel: number;
					if (beforeEight && fromBeepBox) {
						patternsPerChannel =
							base64CharCodeToInt[compressed.charCodeAt(charIndex++)] + 1;
					} else {
						patternsPerChannel =
							(base64CharCodeToInt[compressed.charCodeAt(charIndex++)] << 6) +
							base64CharCodeToInt[compressed.charCodeAt(charIndex++)] +
							1;
					}
					song.patternsPerChannel = validateRange(
						1,
						Config.barCountMax,
						patternsPerChannel,
					);
					const channelCount: number = song.getChannelCount();
					for (
						let channelIndex: number = 0;
						channelIndex < channelCount;
						channelIndex++
					) {
						const patterns: Pattern[] = song.channels[channelIndex].patterns;
						for (
							let pattern = patterns.length;
							pattern < song.patternsPerChannel;
							pattern++
						) {
							patterns[pattern] = new Pattern();
						}
						patterns.length = song.patternsPerChannel;
					}
				}
				break;
			case SongTagCode.instrumentCount:
				{
					if (
						(beforeNine && fromBeepBox) ||
						(fromJummBox && beforeFive) ||
						(beforeFour && fromGoldBox)
					) {
						const instrumentsPerChannel: number = validateRange(
							Config.instrumentCountMin,
							Config.patternInstrumentCountMax,
							base64CharCodeToInt[compressed.charCodeAt(charIndex++)] +
								Config.instrumentCountMin,
						);
						song.layeredInstruments = false;
						song.patternInstruments = instrumentsPerChannel > 1;

						for (
							let channelIndex: number = 0;
							channelIndex < song.getChannelCount();
							channelIndex++
						) {
							const isNoiseChannel: boolean =
								channelIndex >= song.pitchChannelCount &&
								channelIndex < song.pitchChannelCount + song.noiseChannelCount;
							const isModChannel: boolean =
								channelIndex >= song.pitchChannelCount + song.noiseChannelCount;

							for (
								let instrumentIndex: number =
									song.channels[channelIndex].instruments.length;
								instrumentIndex < instrumentsPerChannel;
								instrumentIndex++
							) {
								song.channels[channelIndex].instruments[instrumentIndex] =
									new Instrument(isNoiseChannel, isModChannel);
							}
							song.channels[channelIndex].instruments.length = instrumentsPerChannel;
							if (beforeSix && fromBeepBox) {
								for (
									let instrumentIndex: number = 0;
									instrumentIndex < instrumentsPerChannel;
									instrumentIndex++
								) {
									song.channels[channelIndex].instruments[
										instrumentIndex
									].setTypeAndReset(
										isNoiseChannel ? InstrumentType.noise : InstrumentType.chip,
										isNoiseChannel,
										isModChannel,
									);
								}
							}

							for (
								let j: number = legacySettingsCache![channelIndex].length;
								j < instrumentsPerChannel;
								j++
							) {
								legacySettingsCache![channelIndex][j] = {};
							}
						}
					} else {
						const instrumentsFlagBits: number =
							base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
						song.layeredInstruments = (instrumentsFlagBits & (1 << 1)) !== 0;
						song.patternInstruments = (instrumentsFlagBits & (1 << 0)) !== 0;
						for (
							let channelIndex: number = 0;
							channelIndex < song.getChannelCount();
							channelIndex++
						) {
							let instrumentCount: number = 1;
							if (song.layeredInstruments || song.patternInstruments) {
								instrumentCount = validateRange(
									Config.instrumentCountMin,
									song.getMaxInstrumentsPerChannel(),
									base64CharCodeToInt[compressed.charCodeAt(charIndex++)] +
										Config.instrumentCountMin,
								);
							}
							const channel: Channel = song.channels[channelIndex];
							const isNoiseChannel: boolean = song.getChannelIsNoise(channelIndex);
							const isModChannel: boolean = song.getChannelIsMod(channelIndex);
							for (
								let i: number = channel.instruments.length;
								i < instrumentCount;
								i++
							) {
								channel.instruments[i] = new Instrument(
									isNoiseChannel,
									isModChannel,
								);
							}
							channel.instruments.length = instrumentCount;
						}
					}
				}
				break;
			case SongTagCode.rhythm:
				{
					if (!fromUltraBox && !fromSlarmoosBox && !fromJukeBox) {
						const newRhythm = base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
						song.rhythm = clamp(0, Config.rhythms.length, newRhythm);
						if ((fromJummBox && beforeThree) || fromBeepBox) {
							if (
								song.rhythm === Config.rhythms.dictionary["÷3 (triplets)"].index ||
								song.rhythm === Config.rhythms.dictionary["÷6"].index
							) {
								useSlowerArpSpeed = true;
							}
							if (song.rhythm >= Config.rhythms.dictionary["÷6"].index) {
								// @TODO: This assumes that 6 and 8 are in that order, but
								// if someone reorders Config.rhythms that may not be true,
								// so this check probably should instead look for those
								// specific rhythms.
								useFastTwoNoteArp = true;
							}
						}
					} else if ((fromSlarmoosBox && beforeFour) || (fromUltraBox && beforeFive)) {
						const rhythmMap = [1, 1, 0, 1, 2, 3, 4, 5];
						song.rhythm = clamp(
							0,
							Config.rhythms.length,
							rhythmMap[base64CharCodeToInt[compressed.charCodeAt(charIndex++)]],
						);
					} else {
						song.rhythm = clamp(
							0,
							Config.rhythms.length,
							base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
						);
					}
				}
				break;
			case SongTagCode.channelOctave:
				{
					if (beforeThree && fromBeepBox) {
						const channelIndex: number =
							base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
						song.channels[channelIndex].octave = clamp(
							0,
							song.octaveCount,
							base64CharCodeToInt[compressed.charCodeAt(charIndex++)] + 1,
						);
						if (channelIndex >= song.pitchChannelCount)
							song.channels[channelIndex].octave = 0;
					} else if (
						(beforeNine && fromBeepBox) ||
						(fromJummBox && beforeFive) ||
						(beforeFour && fromGoldBox)
					) {
						for (
							let channelIndex: number = 0;
							channelIndex < song.getChannelCount();
							channelIndex++
						) {
							song.channels[channelIndex].octave = clamp(
								0,
								song.octaveCount,
								base64CharCodeToInt[compressed.charCodeAt(charIndex++)] + 1,
							);
							if (channelIndex >= song.pitchChannelCount)
								song.channels[channelIndex].octave = 0;
						}
					} else {
						for (
							let channelIndex: number = 0;
							channelIndex < song.pitchChannelCount;
							channelIndex++
						) {
							song.channels[channelIndex].octave = clamp(
								0,
								song.octaveCount,
								base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
							);
						}
						for (
							let channelIndex: number = song.pitchChannelCount;
							channelIndex < song.getChannelCount();
							channelIndex++
						) {
							song.channels[channelIndex].octave = 0;
						}
					}
				}
				break;
			case SongTagCode.startInstrument:
				{
					instrumentIndexIterator++;
					if (
						instrumentIndexIterator >=
						song.channels[instrumentChannelIterator].instruments.length
					) {
						instrumentChannelIterator++;
						instrumentIndexIterator = 0;
					}
					if (instrumentChannelIterator >= song.channels.length) {
						// Corrupted data — more instrument tags than header
						// indicated. Skip remaining instrument data safely.
						charIndex = compressed.length;
						break;
					}
					const instrument: Instrument =
						song.channels[instrumentChannelIterator].instruments[
							instrumentIndexIterator
						];
					// JB before v5 had custom chip and mod before pickedString and supersaw were added. Index +2.
					let instrumentType: number =
						base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
					if (
						instrumentType < 0 ||
						instrumentType >= getRegisteredInstrumentTypeCount()
					) {
						// Corrupted data (e.g. cross-type paste artifact) —
						// fall back to channel-appropriate default and skip
						// instrument deserialization to avoid cascading errors.
						const isNoise: boolean =
							instrumentChannelIterator >= song.pitchChannelCount &&
							instrumentChannelIterator <
								song.pitchChannelCount + song.noiseChannelCount;
						const isMod: boolean =
							instrumentChannelIterator >=
							song.pitchChannelCount + song.noiseChannelCount;
						instrumentType = isMod
							? InstrumentType.mod
							: isNoise
								? InstrumentType.noise
								: InstrumentType.chip;
					}
					if ((fromJummBox && beforeFive) || (beforeFour && fromGoldBox)) {
						if (
							instrumentType === InstrumentType.pickedString ||
							instrumentType === InstrumentType.supersaw
						) {
							instrumentType += 2;
						}
					} // Similar story here, JB before v5 had custom chip and mod before supersaw was added. Index +1.
					else if (
						(fromJummBox && beforeSix) ||
						(fromGoldBox && !beforeFour) ||
						(fromUltraBox && beforeFive)
					) {
						if (
							instrumentType === InstrumentType.supersaw ||
							instrumentType === InstrumentType.customChipWave ||
							instrumentType === InstrumentType.mod
						) {
							instrumentType += 1;
						}
					}
					instrument.setTypeAndReset(
						instrumentType,
						instrumentChannelIterator >= song.pitchChannelCount &&
							instrumentChannelIterator <
								song.pitchChannelCount + song.noiseChannelCount,
						instrumentChannelIterator >=
							song.pitchChannelCount + song.noiseChannelCount,
					);

					// Anti-aliasing was added in BeepBox 3.0 (v6->v7) and JummBox 1.3 (v1->v2 roughly but some leakage possible)
					if (
						((beforeSeven && fromBeepBox) || (beforeTwo && fromJummBox)) &&
						(instrumentType === InstrumentType.chip ||
							instrumentType === InstrumentType.customChipWave ||
							instrumentType === InstrumentType.pwm)
					) {
						instrument.aliases = true;
						instrument.distortion = 0;
						instrument.effects |= 1 << EffectType.distortion;
					}
					if (useSlowerArpSpeed) {
						instrument.arpeggioSpeed = 9; // x3/4 speed. This used to be tied to rhythm, but now it is decoupled to each instrument's arp speed slider. This flag gets set when importing older songs to keep things consistent.
					}
					if (useFastTwoNoteArp) {
						instrument.fastTwoNoteArp = true;
					}

					if (beforeSeven && fromBeepBox) {
						// instrument.effects = 0;
						// Chip/noise instruments had arpeggio and FM had custom interval but neither
						// explicitly saved the chorus setting beforeSeven so enable it here.
						if (instrument.chord !== Config.chords.dictionary.simultaneous.index) {
							// Enable chord if it was used.
							instrument.effects |= 1 << EffectType.chord;
						}
					}
				}
				break;
			case SongTagCode.preset:
				{
					let presetValue: number;
					if (!fromJukeBox) {
						presetValue =
							(base64CharCodeToInt[compressed.charCodeAt(charIndex++)] << 12) |
							base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
					} else {
						presetValue =
							(base64CharCodeToInt[compressed.charCodeAt(charIndex++)] << 18) |
							(base64CharCodeToInt[compressed.charCodeAt(charIndex++)] << 12) |
							(base64CharCodeToInt[compressed.charCodeAt(charIndex++)] << 6) |
							base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
					}
					song.channels[instrumentChannelIterator].instruments[
						instrumentIndexIterator
					].preset = presetValue;
					// Picked string was inserted before custom chip in JB v5, so bump up preset index.
					if ((fromJummBox && beforeFive) || (beforeFour && fromGoldBox)) {
						if (
							song.channels[instrumentChannelIterator].instruments[
								instrumentIndexIterator
							].preset === InstrumentType.pickedString
						) {
							song.channels[instrumentChannelIterator].instruments[
								instrumentIndexIterator
							].preset = InstrumentType.customChipWave;
							song.channels[instrumentChannelIterator].instruments[
								instrumentIndexIterator
							].type = InstrumentType.customChipWave;
						}
					} // Similar story, supersaw is also before custom chip (and mod, but mods can't have presets).
					else if ((fromJummBox && beforeSix) || (fromUltraBox && beforeFive)) {
						if (
							song.channels[instrumentChannelIterator].instruments[
								instrumentIndexIterator
							].preset === InstrumentType.supersaw
						) {
							song.channels[instrumentChannelIterator].instruments[
								instrumentIndexIterator
							].preset = InstrumentType.customChipWave;
							song.channels[instrumentChannelIterator].instruments[
								instrumentIndexIterator
							].type = InstrumentType.customChipWave;
						}
						// ultra code for 6-op fm maybe
						if (
							song.channels[instrumentChannelIterator].instruments[
								instrumentIndexIterator
							].preset === InstrumentType.mod
						) {
							song.channels[instrumentChannelIterator].instruments[
								instrumentIndexIterator
							].preset = InstrumentType.fm6op;
							song.channels[instrumentChannelIterator].instruments[
								instrumentIndexIterator
							].type = InstrumentType.fm6op;
						}
					}
					// BeepBox directly tweaked "grand piano", but JB kept it the same. The most up to date version is now "grand piano 3"
					if (
						fromBeepBox &&
						presetValue === song.customSampleHandler?.nameToPresetValue("grand piano 1")
					) {
						const gp3Preset =
							song.customSampleHandler?.nameToPresetValue("grand piano 3");
						if (gp3Preset != null) {
							song.channels[instrumentChannelIterator].instruments[
								instrumentIndexIterator
							].preset = gp3Preset;
						}
					}
				}
				break;
			case SongTagCode.wave:
				{
					if (beforeThree && fromBeepBox) {
						const legacyWaves: number[] = [1, 2, 3, 4, 5, 6, 7, 8, 0];
						const channelIndex: number =
							base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
						const instrument: Instrument = song.channels[channelIndex].instruments[0];
						instrument.chipWave = clamp(
							0,
							Config.chipWaves.length,
							legacyWaves[base64CharCodeToInt[compressed.charCodeAt(charIndex++)]] |
								0,
						);

						// Version 2 didn't save any settings for settings for filters, or envelopes,
						// just waves, so they are initialized here.
						instrument.convertLegacySettings(
							legacySettingsCache![channelIndex][0],
							forceSimpleFilter,
						);
					} else if (beforeSix && fromBeepBox) {
						const legacyWaves: number[] = [1, 2, 3, 4, 5, 6, 7, 8, 0];
						for (
							let channelIndex: number = 0;
							channelIndex < song.getChannelCount();
							channelIndex++
						) {
							for (const instrument of song.channels[channelIndex].instruments) {
								if (channelIndex >= song.pitchChannelCount) {
									instrument.chipNoise = clamp(
										0,
										Config.chipNoises.length,
										base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
									);
								} else {
									instrument.chipWave = clamp(
										0,
										Config.chipWaves.length,
										legacyWaves[
											base64CharCodeToInt[compressed.charCodeAt(charIndex++)]
										] | 0,
									);
								}
							}
						}
					} else if (beforeSeven && fromBeepBox) {
						const legacyWaves: number[] = [1, 2, 3, 4, 5, 6, 7, 8, 0];
						if (instrumentChannelIterator >= song.pitchChannelCount) {
							song.channels[instrumentChannelIterator].instruments[
								instrumentIndexIterator
							].chipNoise = clamp(
								0,
								Config.chipNoises.length,
								base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
							);
						} else {
							song.channels[instrumentChannelIterator].instruments[
								instrumentIndexIterator
							].chipWave = clamp(
								0,
								Config.chipWaves.length,
								legacyWaves[
									base64CharCodeToInt[compressed.charCodeAt(charIndex++)]
								] | 0,
							);
						}
					} else {
						if (
							song.channels[instrumentChannelIterator].instruments[
								instrumentIndexIterator
							].type === InstrumentType.noise
						) {
							song.channels[instrumentChannelIterator].instruments[
								instrumentIndexIterator
							].chipNoise = clamp(
								0,
								Config.chipNoises.length,
								base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
							);
						} else {
							if (fromJukeBox || fromSlarmoosBox || fromUltraBox) {
								const chipWaveReal =
									base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
								const chipWaveCounter =
									base64CharCodeToInt[compressed.charCodeAt(charIndex++)];

								if (chipWaveCounter === 3) {
									song.channels[instrumentChannelIterator].instruments[
										instrumentIndexIterator
									].chipWave = clamp(
										0,
										Config.chipWaves.length,
										chipWaveReal + 186,
									);
								} else if (chipWaveCounter === 2) {
									song.channels[instrumentChannelIterator].instruments[
										instrumentIndexIterator
									].chipWave = clamp(
										0,
										Config.chipWaves.length,
										chipWaveReal + 124,
									);
								} else if (chipWaveCounter === 1) {
									song.channels[instrumentChannelIterator].instruments[
										instrumentIndexIterator
									].chipWave = clamp(
										0,
										Config.chipWaves.length,
										chipWaveReal + 62,
									);
								} else {
									song.channels[instrumentChannelIterator].instruments[
										instrumentIndexIterator
									].chipWave = clamp(0, Config.chipWaves.length, chipWaveReal);
								}
							} else {
								song.channels[instrumentChannelIterator].instruments[
									instrumentIndexIterator
								].chipWave = clamp(
									0,
									Config.chipWaves.length,
									base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
								);
							}
						}
					}
				}
				break;
			case SongTagCode.eqFilter:
				{
					if (
						(beforeNine && fromBeepBox) ||
						(beforeFive && fromJummBox) ||
						(beforeFour && fromGoldBox)
					) {
						if (beforeSeven && fromBeepBox) {
							const legacyToCutoff: number[] = [10, 6, 3, 0, 8, 5, 2];
							const legacyToEnvelope: string[] = [
								"none",
								"none",
								"none",
								"none",
								"decay 1",
								"decay 2",
								"decay 3",
							];

							if (beforeThree && fromBeepBox) {
								const channelIndex: number =
									base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
								const instrument: Instrument =
									song.channels[channelIndex].instruments[0];
								const legacySettings: LegacySettings =
									legacySettingsCache![channelIndex][0];
								const legacyFilter: number = [1, 3, 4, 5][
									clamp(
										0,
										legacyToCutoff.length,
										base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
									)
								];
								legacySettings.filterCutoff = legacyToCutoff[legacyFilter];
								legacySettings.filterResonance = 0;
								legacySettings.filterEnvelope =
									Config.envelopes.dictionary[legacyToEnvelope[legacyFilter]];
								instrument.convertLegacySettings(legacySettings, forceSimpleFilter);
							} else if (beforeSix && fromBeepBox) {
								for (
									let channelIndex: number = 0;
									channelIndex < song.getChannelCount();
									channelIndex++
								) {
									for (
										let i: number = 0;
										i < song.channels[channelIndex].instruments.length;
										i++
									) {
										const instrument: Instrument =
											song.channels[channelIndex].instruments[i];
										const legacySettings: LegacySettings =
											legacySettingsCache![channelIndex][i];
										const legacyFilter: number = clamp(
											0,
											legacyToCutoff.length,
											base64CharCodeToInt[
												compressed.charCodeAt(charIndex++)
											] + 1,
										);
										if (channelIndex < song.pitchChannelCount) {
											legacySettings.filterCutoff =
												legacyToCutoff[legacyFilter];
											legacySettings.filterResonance = 0;
											legacySettings.filterEnvelope =
												Config.envelopes.dictionary[
													legacyToEnvelope[legacyFilter]
												];
										} else {
											legacySettings.filterCutoff = 10;
											legacySettings.filterResonance = 0;
											legacySettings.filterEnvelope =
												Config.envelopes.dictionary.none;
										}
										instrument.convertLegacySettings(
											legacySettings,
											forceSimpleFilter,
										);
									}
								}
							} else {
								const legacyFilter: number = clamp(
									0,
									legacyToCutoff.length,
									base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
								);
								const instrument: Instrument =
									song.channels[instrumentChannelIterator].instruments[
										instrumentIndexIterator
									];
								const legacySettings: LegacySettings =
									legacySettingsCache![instrumentChannelIterator][
										instrumentIndexIterator
									];
								legacySettings.filterCutoff = legacyToCutoff[legacyFilter];
								legacySettings.filterResonance = 0;
								legacySettings.filterEnvelope =
									Config.envelopes.dictionary[legacyToEnvelope[legacyFilter]];
								instrument.convertLegacySettings(legacySettings, forceSimpleFilter);
							}
						} else {
							const filterCutoffRange: number = 11;
							const instrument: Instrument =
								song.channels[instrumentChannelIterator].instruments[
									instrumentIndexIterator
								];
							const legacySettings: LegacySettings =
								legacySettingsCache![instrumentChannelIterator][
									instrumentIndexIterator
								];
							legacySettings.filterCutoff = clamp(
								0,
								filterCutoffRange,
								base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
							);
							instrument.convertLegacySettings(legacySettings, forceSimpleFilter);
						}
					} else {
						const instrument: Instrument =
							song.channels[instrumentChannelIterator].instruments[
								instrumentIndexIterator
							];
						let typeCheck: number =
							base64CharCodeToInt[compressed.charCodeAt(charIndex++)];

						if (fromBeepBox || typeCheck === 0) {
							instrument.eqFilterType = false;
							if (
								fromJukeBox ||
								fromJummBox ||
								fromGoldBox ||
								fromUltraBox ||
								fromSlarmoosBox
							) {
								typeCheck = base64CharCodeToInt[compressed.charCodeAt(charIndex++)]; // Skip to next to get control point count
							}
							const originalControlPointCount: number = typeCheck;
							instrument.eqFilter.controlPointCount = clamp(
								0,
								Config.filterMaxPoints + 1,
								originalControlPointCount,
							);
							for (
								let i: number = instrument.eqFilter.controlPoints.length;
								i < instrument.eqFilter.controlPointCount;
								i++
							) {
								instrument.eqFilter.controlPoints[i] = new FilterControlPoint();
							}
							for (
								let i: number = 0;
								i < instrument.eqFilter.controlPointCount;
								i++
							) {
								const point: FilterControlPoint =
									instrument.eqFilter.controlPoints[i];
								point.type = clamp(
									0,
									FilterType.length,
									base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
								);
								point.freq = clamp(
									0,
									Config.filterFreqRange,
									base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
								);
								point.gain = clamp(
									0,
									Config.filterGainRange,
									base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
								);
							}
							for (
								let i: number = instrument.eqFilter.controlPointCount;
								i < originalControlPointCount;
								i++
							) {
								charIndex += 3;
							}

							// Get subfilters as well. Skip Index 0, is a copy of the base filter.
							instrument.eqSubFilters[0] = instrument.eqFilter;
							if (
								(fromJummBox && !beforeFive) ||
								(fromGoldBox && !beforeFour) ||
								fromUltraBox ||
								fromSlarmoosBox ||
								fromJukeBox
							) {
								const usingSubFilterBitfield: number =
									(base64CharCodeToInt[compressed.charCodeAt(charIndex++)] << 6) |
									base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
								for (let j: number = 0; j < Config.filterMorphCount - 1; j++) {
									if (usingSubFilterBitfield & (1 << j)) {
										// Number of control points
										const originalSubfilterControlPointCount: number =
											base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
										if (instrument.eqSubFilters[j + 1] == null) {
											instrument.eqSubFilters[j + 1] = new FilterSettings();
										}
										instrument.eqSubFilters[j + 1]!.controlPointCount = clamp(
											0,
											Config.filterMaxPoints + 1,
											originalSubfilterControlPointCount,
										);
										for (
											let i: number =
												instrument.eqSubFilters[j + 1]!.controlPoints
													.length;
											i < instrument.eqSubFilters[j + 1]!.controlPointCount;
											i++
										) {
											instrument.eqSubFilters[j + 1]!.controlPoints[i] =
												new FilterControlPoint();
										}
										for (
											let i: number = 0;
											i < instrument.eqSubFilters[j + 1]!.controlPointCount;
											i++
										) {
											const point: FilterControlPoint =
												instrument.eqSubFilters[j + 1]!.controlPoints[i];
											point.type = clamp(
												0,
												FilterType.length,
												base64CharCodeToInt[
													compressed.charCodeAt(charIndex++)
												],
											);
											point.freq = clamp(
												0,
												Config.filterFreqRange,
												base64CharCodeToInt[
													compressed.charCodeAt(charIndex++)
												],
											);
											point.gain = clamp(
												0,
												Config.filterGainRange,
												base64CharCodeToInt[
													compressed.charCodeAt(charIndex++)
												],
											);
										}
										for (
											let i: number =
												instrument.eqSubFilters[j + 1]!.controlPointCount;
											i < originalSubfilterControlPointCount;
											i++
										) {
											charIndex += 3;
										}
									}
								}
							}
						} else {
							instrument.eqFilterType = true;
							instrument.eqFilterSimpleCut = clamp(
								0,
								Config.filterSimpleCutRange,
								base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
							);
							instrument.eqFilterSimplePeak = clamp(
								0,
								Config.filterSimplePeakRange,
								base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
							);
						}
					}
				}
				break;
			case SongTagCode.loopControls:
				{
					if (fromJukeBox || fromSlarmoosBox || fromUltraBox) {
						if (beforeThree && fromUltraBox) {
							// Still have to support the old and bad loop control data format written as a test, sigh.
							const [sampleLoopInfoEncodedLength, afterLengthIndex] =
								decode32BitNumber(compressed, charIndex);
							charIndex = afterLengthIndex;
							const sampleLoopInfoEncoded = compressed.slice(
								charIndex,
								charIndex + sampleLoopInfoEncodedLength,
							);
							charIndex += sampleLoopInfoEncodedLength;
							interface SampleLoopInfo {
								isUsingAdvancedLoopControls: boolean;
								chipWaveLoopStart: number;
								chipWaveLoopEnd: number;
								chipWaveLoopMode: number;
								chipWavePlayBackwards: boolean;
								chipWaveStartOffset: number;
							}
							interface SampleLoopInfoEntry {
								channel: number;
								instrument: number;
								info: SampleLoopInfo;
							}
							let sampleLoopInfo: SampleLoopInfoEntry[];
							try {
								sampleLoopInfo = JSON.parse(atob(sampleLoopInfoEncoded));
							} catch (error) {
								if (error instanceof SyntaxError || error instanceof DOMException) {
									throw new SongDataError("Invalid sample loop metadata.");
								}
								throw error;
							}
							for (const entry of sampleLoopInfo) {
								const channelIndex: number = entry.channel;
								const instrumentIndex: number = entry.instrument;
								const info: SampleLoopInfo = entry.info;
								const instrument: Instrument =
									song.channels[channelIndex].instruments[instrumentIndex];
								instrument.isUsingAdvancedLoopControls =
									info.isUsingAdvancedLoopControls;
								instrument.chipWaveLoopStart = info.chipWaveLoopStart;
								instrument.chipWaveLoopEnd = info.chipWaveLoopEnd;
								instrument.chipWaveLoopMode = info.chipWaveLoopMode;
								instrument.chipWavePlayBackwards = info.chipWavePlayBackwards;
								instrument.chipWaveStartOffset = info.chipWaveStartOffset;
								// @TODO: Whenever chipWaveReleaseMode is implemented, it should be set here to the default.
							}
						} else {
							// Read the new loop control data format.
							// See Song.toBase64String for details on the encodings used here.
							const encodedLoopMode: number =
								base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
							const isUsingAdvancedLoopControls: boolean = Boolean(
								encodedLoopMode & 1,
							);
							const chipWaveLoopMode: number = encodedLoopMode >> 1;
							const encodedReleaseMode: number =
								base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
							const chipWavePlayBackwards: boolean = Boolean(encodedReleaseMode & 1);
							const [chipWaveLoopStart, loopStartIndex] = decode32BitNumber(
								compressed,
								charIndex,
							);
							const [chipWaveLoopEnd, loopEndIndex] = decode32BitNumber(
								compressed,
								loopStartIndex,
							);
							const [chipWaveStartOffset, offsetIndex] = decode32BitNumber(
								compressed,
								loopEndIndex,
							);
							charIndex = offsetIndex;
							const instrument: Instrument =
								song.channels[instrumentChannelIterator].instruments[
									instrumentIndexIterator
								];
							instrument.isUsingAdvancedLoopControls = isUsingAdvancedLoopControls;
							instrument.chipWaveLoopStart = chipWaveLoopStart;
							instrument.chipWaveLoopEnd = chipWaveLoopEnd;
							instrument.chipWaveLoopMode = chipWaveLoopMode;
							instrument.chipWavePlayBackwards = chipWavePlayBackwards;
							instrument.chipWaveStartOffset = chipWaveStartOffset;
							// instrument.chipWaveReleaseMode = chipWaveReleaseMode;
						}
					} else if (fromGoldBox && !beforeFour && beforeSix) {
						if (
							document.URL.substring(document.URL.length - 13).toLowerCase() !==
							"legacysamples"
						) {
							if (!willLoadLegacySamplesForOldSongs) {
								willLoadLegacySamplesForOldSongs = true;
								song.customSampleHandler?.setCustomSamples(["legacySamples"]);
								if (!song.customSampleHandler?.deferSampleLoading) {
									Config.willReloadForCustomSamples = true;
									loadBuiltInSamples(0);
								}
							}
						}
						song.channels[instrumentChannelIterator].instruments[
							instrumentIndexIterator
						].chipWave = clamp(
							0,
							Config.chipWaves.length,
							base64CharCodeToInt[compressed.charCodeAt(charIndex++)] + 125,
						);
					} else if (
						(beforeNine && fromBeepBox) ||
						(fromJummBox && beforeFive) ||
						(beforeFour && fromGoldBox)
					) {
						const filterResonanceRange: number = 8;
						const instrument: Instrument =
							song.channels[instrumentChannelIterator].instruments[
								instrumentIndexIterator
							];
						const legacySettings: LegacySettings =
							legacySettingsCache![instrumentChannelIterator][
								instrumentIndexIterator
							];
						legacySettings.filterResonance = clamp(
							0,
							filterResonanceRange,
							base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
						);
						instrument.convertLegacySettings(legacySettings, forceSimpleFilter);
					}
				}
				break;
			case SongTagCode.drumsetEnvelopes:
				{
					const instrument: Instrument =
						song.channels[instrumentChannelIterator].instruments[
							instrumentIndexIterator
						];
					const pregoldToEnvelope: number[] = [
						0, 1, 2, 4, 5, 6, 8, 9, 10, 12, 13, 14, 16, 17, 18, 19, 20, 21, 23, 24, 25,
						27, 28, 29, 32, 33, 34, 31, 11,
					];
					if (
						(beforeNine && fromBeepBox) ||
						(beforeFive && fromJummBox) ||
						(beforeFour && fromGoldBox)
					) {
						if (
							(beforeTwo && fromGoldBox) ||
							(!fromGoldBox && !fromUltraBox && !fromSlarmoosBox && !fromJukeBox)
						) {
							/* version gate — no-op fallthrough */
						}
						if (instrument.type === InstrumentType.drumset) {
							for (let i: number = 0; i < Config.drumCount; i++) {
								let aa: number =
									base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
								if (
									(beforeTwo && fromGoldBox) ||
									(!fromGoldBox &&
										!fromUltraBox &&
										!fromSlarmoosBox &&
										!fromJukeBox)
								)
									aa = pregoldToEnvelope[aa];
								instrument.drumsetEnvelopes[i] = envelopeFromLegacyIndex(aa).index;
							}
						} else {
							// This used to be used for general filter envelopes.
							// The presence of an envelope affects how convertLegacySettings
							// decides the closest possible approximation, so update it.
							const legacySettings: LegacySettings =
								legacySettingsCache![instrumentChannelIterator][
									instrumentIndexIterator
								];
							let aa: number =
								base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
							if (
								(beforeTwo && fromGoldBox) ||
								(!fromGoldBox && !fromUltraBox && !fromSlarmoosBox && !fromJukeBox)
							)
								aa = pregoldToEnvelope[aa];
							legacySettings.filterEnvelope = envelopeFromLegacyIndex(aa);
							instrument.convertLegacySettings(legacySettings, forceSimpleFilter);
						}
					} else {
						// This tag is now only used for drumset filter envelopes.
						for (let i: number = 0; i < Config.drumCount; i++) {
							let aa: number =
								base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
							if (
								(beforeTwo && fromGoldBox) ||
								(!fromGoldBox && !fromUltraBox && !fromSlarmoosBox && !fromJukeBox)
							)
								aa = pregoldToEnvelope[aa];
							if (!fromSlarmoosBox && !fromJukeBox && aa >= 2) aa++; // 2 for pitch
							instrument.drumsetEnvelopes[i] = clamp(0, Config.envelopes.length, aa);
						}
					}
				}
				break;
			case SongTagCode.pulseWidth:
				{
					const instrument: Instrument =
						song.channels[instrumentChannelIterator].instruments[
							instrumentIndexIterator
						];
					instrument.pulseWidth = clamp(
						0,
						Config.pulseWidthRange + +fromJummBox + 1,
						base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
					);
					if (fromBeepBox) {
						// BeepBox formula
						instrument.pulseWidth = Math.round(
							0.5 ** ((7 - instrument.pulseWidth) * Config.pulseWidthStepPower) *
								Config.pulseWidthRange,
						);
					}

					if (
						(beforeNine && fromBeepBox) ||
						(beforeFive && fromJummBox) ||
						(beforeFour && fromGoldBox)
					) {
						const pregoldToEnvelope: number[] = [
							0, 1, 2, 4, 5, 6, 8, 9, 10, 12, 13, 14, 16, 17, 18, 19, 20, 21, 23, 24,
							25, 27, 28, 29, 32, 33, 34, 31, 11,
						];
						const legacySettings: LegacySettings =
							legacySettingsCache![instrumentChannelIterator][
								instrumentIndexIterator
							];
						let aa: number = base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
						if (
							(beforeTwo && fromGoldBox) ||
							(!fromGoldBox && !fromUltraBox && !fromSlarmoosBox && !fromJukeBox)
						) {
							aa = pregoldToEnvelope[aa];
						}
						legacySettings.pulseEnvelope = envelopeFromLegacyIndex(aa);
						instrument.convertLegacySettings(legacySettings, forceSimpleFilter);
					}

					if ((fromUltraBox && !beforeFour) || fromSlarmoosBox || fromJukeBox) {
						instrument.decimalOffset = clamp(
							0,
							99 + 1,
							(base64CharCodeToInt[compressed.charCodeAt(charIndex++)] << 6) +
								base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
						);
					}
				}
				break;
			case SongTagCode.stringSustain:
				{
					const instrument: Instrument =
						song.channels[instrumentChannelIterator].instruments[
							instrumentIndexIterator
						];
					const sustainValue: number =
						base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
					instrument.stringSustain = clamp(
						0,
						Config.stringSustainRange,
						sustainValue & 0x1f,
					);
					instrument.stringSustainType = Config.enableAcousticSustain
						? clamp(0, SustainType.length, sustainValue >> 5)
						: SustainType.bright;
				}
				break;
			case SongTagCode.fadeInOut:
				{
					if (
						(beforeNine && fromBeepBox) ||
						(fromJummBox && beforeFive) ||
						(beforeFour && fromGoldBox)
					) {
						// this tag was used for a combination of transition and fade in/out.
						const legacySettings = [
							{ transition: "interrupt", fadeInSeconds: 0.0, fadeOutTicks: -1 },
							{ transition: "normal", fadeInSeconds: 0.0, fadeOutTicks: -3 },
							{ transition: "normal", fadeInSeconds: 0.025, fadeOutTicks: -3 },
							{
								transition: "slide in pattern",
								fadeInSeconds: 0.025,
								fadeOutTicks: -3,
							},
							{ transition: "normal", fadeInSeconds: 0.04, fadeOutTicks: 6 },
							{ transition: "normal", fadeInSeconds: 0.0, fadeOutTicks: 48 },
							{ transition: "normal", fadeInSeconds: 0.0125, fadeOutTicks: 72 },
							{ transition: "normal", fadeInSeconds: 0.06, fadeOutTicks: 96 },
							{
								transition: "slide in pattern",
								fadeInSeconds: 0.025,
								fadeOutTicks: -3,
							},
						];
						if (beforeThree && fromBeepBox) {
							const channelIndex: number =
								base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
							const settings =
								legacySettings[
									clamp(
										0,
										legacySettings.length,
										base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
									)
								];
							const instrument: Instrument =
								song.channels[channelIndex].instruments[0];
							instrument.fadeIn = secondsToFadeInSetting(settings.fadeInSeconds);
							instrument.fadeOut = ticksToFadeOutSetting(settings.fadeOutTicks);
							instrument.transition =
								Config.transitions.dictionary[settings.transition].index;
							if (
								instrument.transition !== Config.transitions.dictionary.normal.index
							) {
								// Enable transition if it was used.
								instrument.effects |= 1 << EffectType.transition;
							}
						} else if (beforeSix && fromBeepBox) {
							for (
								let channelIndex: number = 0;
								channelIndex < song.getChannelCount();
								channelIndex++
							) {
								for (const instrument of song.channels[channelIndex].instruments) {
									const settings =
										legacySettings[
											clamp(
												0,
												legacySettings.length,
												base64CharCodeToInt[
													compressed.charCodeAt(charIndex++)
												],
											)
										];
									instrument.fadeIn = secondsToFadeInSetting(
										settings.fadeInSeconds,
									);
									instrument.fadeOut = ticksToFadeOutSetting(
										settings.fadeOutTicks,
									);
									instrument.transition =
										Config.transitions.dictionary[settings.transition].index;
									if (
										instrument.transition !==
										Config.transitions.dictionary.normal.index
									) {
										// Enable transition if it was used.
										instrument.effects |= 1 << EffectType.transition;
									}
								}
							}
						} else if (
							(beforeFour &&
								!fromGoldBox &&
								!fromUltraBox &&
								!fromSlarmoosBox &&
								!fromJukeBox) ||
							fromBeepBox
						) {
							const settings =
								legacySettings[
									clamp(
										0,
										legacySettings.length,
										base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
									)
								];
							const instrument: Instrument =
								song.channels[instrumentChannelIterator].instruments[
									instrumentIndexIterator
								];
							instrument.fadeIn = secondsToFadeInSetting(settings.fadeInSeconds);
							instrument.fadeOut = ticksToFadeOutSetting(settings.fadeOutTicks);
							instrument.transition =
								Config.transitions.dictionary[settings.transition].index;
							if (
								instrument.transition !== Config.transitions.dictionary.normal.index
							) {
								// Enable transition if it was used.
								instrument.effects |= 1 << EffectType.transition;
							}
						} else {
							const settings =
								legacySettings[
									clamp(
										0,
										legacySettings.length,
										base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
									)
								];
							const instrument: Instrument =
								song.channels[instrumentChannelIterator].instruments[
									instrumentIndexIterator
								];
							instrument.fadeIn = secondsToFadeInSetting(settings.fadeInSeconds);
							instrument.fadeOut = ticksToFadeOutSetting(settings.fadeOutTicks);
							instrument.transition =
								Config.transitions.dictionary[settings.transition].index;

							// Read tie-note
							if (base64CharCodeToInt[compressed.charCodeAt(charIndex++)] > 0) {
								// Set legacy tie over flag, which is only used to port notes in patterns using this instrument as tying.
								instrument.legacyTieOver = true;
							}
							instrument.clicklessTransition =
								!!base64CharCodeToInt[compressed.charCodeAt(charIndex++)];

							if (
								instrument.transition !==
									Config.transitions.dictionary.normal.index ||
								instrument.clicklessTransition
							) {
								// Enable transition if it was used.
								instrument.effects |= 1 << EffectType.transition;
							}
						}
					} else {
						const instrument: Instrument =
							song.channels[instrumentChannelIterator].instruments[
								instrumentIndexIterator
							];
						instrument.fadeIn = clamp(
							0,
							Config.fadeInRange,
							base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
						);
						instrument.fadeOut = clamp(
							0,
							Config.fadeOutTicks.length,
							base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
						);
						if (
							fromJummBox ||
							fromGoldBox ||
							fromUltraBox ||
							fromSlarmoosBox ||
							fromJukeBox
						) {
							instrument.clicklessTransition =
								!!base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
						}
					}
				}
				break;
			case SongTagCode.songEq:
				{
					// deprecated vibrato tag repurposed for songEq
					if (
						(beforeNine && fromBeepBox) ||
						(fromJummBox && beforeFive) ||
						(beforeFour && fromGoldBox)
					) {
						if (beforeSeven && fromBeepBox) {
							if (beforeThree && fromBeepBox) {
								const legacyEffects: number[] = [0, 3, 2, 0];
								const legacyEnvelopes: string[] = [
									"none",
									"none",
									"none",
									"tremolo2",
								];
								const channelIndex: number =
									base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
								const effect: number = clamp(
									0,
									legacyEffects.length,
									base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
								);
								const instrument: Instrument =
									song.channels[channelIndex].instruments[0];
								const legacySettings: LegacySettings =
									legacySettingsCache![channelIndex][0];
								instrument.vibrato = legacyEffects[effect];
								if (
									legacySettings.filterEnvelope === undefined ||
									legacySettings.filterEnvelope.type === EnvelopeType.none
								) {
									// Imitate the legacy tremolo with a filter envelope.
									legacySettings.filterEnvelope =
										Config.envelopes.dictionary[legacyEnvelopes[effect]];
									instrument.convertLegacySettings(
										legacySettings,
										forceSimpleFilter,
									);
								}
								if (instrument.vibrato !== Config.vibratos.dictionary.none.index) {
									// Enable vibrato if it was used.
									instrument.effects |= 1 << EffectType.vibrato;
								}
							} else if (beforeSix && fromBeepBox) {
								const legacyEffects: number[] = [0, 1, 2, 3, 0, 0];
								const legacyEnvelopes: string[] = [
									"none",
									"none",
									"none",
									"none",
									"tremolo5",
									"tremolo2",
								];
								for (
									let channelIndex: number = 0;
									channelIndex < song.getChannelCount();
									channelIndex++
								) {
									for (
										let i: number = 0;
										i < song.channels[channelIndex].instruments.length;
										i++
									) {
										const effect: number = clamp(
											0,
											legacyEffects.length,
											base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
										);
										const instrument: Instrument =
											song.channels[channelIndex].instruments[i];
										const legacySettings: LegacySettings =
											legacySettingsCache![channelIndex][i];
										instrument.vibrato = legacyEffects[effect];
										if (
											legacySettings.filterEnvelope === undefined ||
											legacySettings.filterEnvelope.type === EnvelopeType.none
										) {
											// Imitate the legacy tremolo with a filter envelope.
											legacySettings.filterEnvelope =
												Config.envelopes.dictionary[
													legacyEnvelopes[effect]
												];
											instrument.convertLegacySettings(
												legacySettings,
												forceSimpleFilter,
											);
										}
										if (
											instrument.vibrato !==
											Config.vibratos.dictionary.none.index
										) {
											// Enable vibrato if it was used.
											instrument.effects |= 1 << EffectType.vibrato;
										}
										if (
											(legacyGlobalReverb !== 0 ||
												(fromJummBox && beforeFive) ||
												(beforeFour && fromGoldBox)) &&
											!song.getChannelIsNoise(channelIndex)
										) {
											// Enable reverb if it was used globaly before. (Global reverb was added before the effects option, so instrument reverb initialization was placed in the vibrato command.)
											instrument.effects |= 1 << EffectType.reverb;
											instrument.reverb = legacyGlobalReverb;
										}
									}
								}
							} else {
								const legacyEffects: number[] = [0, 1, 2, 3, 0, 0];
								const legacyEnvelopes: string[] = [
									"none",
									"none",
									"none",
									"none",
									"tremolo5",
									"tremolo2",
								];
								const effect: number = clamp(
									0,
									legacyEffects.length,
									base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
								);
								const instrument: Instrument =
									song.channels[instrumentChannelIterator].instruments[
										instrumentIndexIterator
									];
								const legacySettings: LegacySettings =
									legacySettingsCache![instrumentChannelIterator][
										instrumentIndexIterator
									];
								instrument.vibrato = legacyEffects[effect];
								if (
									legacySettings.filterEnvelope === undefined ||
									legacySettings.filterEnvelope.type === EnvelopeType.none
								) {
									// Imitate the legacy tremolo with a filter envelope.
									legacySettings.filterEnvelope =
										Config.envelopes.dictionary[legacyEnvelopes[effect]];
									instrument.convertLegacySettings(
										legacySettings,
										forceSimpleFilter,
									);
								}
								if (instrument.vibrato !== Config.vibratos.dictionary.none.index) {
									// Enable vibrato if it was used.
									instrument.effects |= 1 << EffectType.vibrato;
								}
								if (
									legacyGlobalReverb !== 0 ||
									(fromJummBox && beforeFive) ||
									(beforeFour && fromGoldBox)
								) {
									// Enable reverb if it was used globaly before. (Global reverb was added before the effects option, so instrument reverb initialization was placed in the vibrato command.)
									instrument.effects |= 1 << EffectType.reverb;
									instrument.reverb = legacyGlobalReverb;
								}
							}
						} else {
							const instrument: Instrument =
								song.channels[instrumentChannelIterator].instruments[
									instrumentIndexIterator
								];
							const vibrato: number = clamp(
								0,
								Config.vibratos.length + 1,
								base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
							);
							instrument.vibrato = vibrato;
							if (instrument.vibrato !== Config.vibratos.dictionary.none.index) {
								// Enable vibrato if it was used.
								instrument.effects |= 1 << EffectType.vibrato;
							}
							// Custom vibrato
							if (vibrato === Config.vibratos.length) {
								instrument.vibratoDepth =
									clamp(
										0,
										Config.modulators.dictionary["vibrato depth"].maxRawVol + 1,
										base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
									) / 50;
								instrument.vibratoSpeed = clamp(
									0,
									Config.modulators.dictionary["vibrato speed"].maxRawVol + 1,
									base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
								);
								instrument.vibratoDelay =
									clamp(
										0,
										Config.modulators.dictionary["vibrato delay"].maxRawVol + 1,
										base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
									) / 2;
								instrument.vibratoType = clamp(
									0,
									Config.vibratoTypes.length,
									base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
								);
								instrument.effects |= 1 << EffectType.vibrato;
							} // Enforce standard vibrato settings
							else {
								instrument.vibratoDepth =
									Config.vibratos[instrument.vibrato].amplitude;
								instrument.vibratoSpeed = 10; // Normal speed
								instrument.vibratoDelay =
									Config.vibratos[instrument.vibrato].delayTicks / 2;
								instrument.vibratoType = Config.vibratos[instrument.vibrato].type;
							}
						}
					} else {
						// songeq
						if (fromJukeBox || (fromSlarmoosBox && !beforeFour)) {
							// double check that it's from a valid version
							const originalControlPointCount: number =
								base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
							song.eqFilter.controlPointCount = clamp(
								0,
								Config.filterMaxPoints + 1,
								originalControlPointCount,
							);
							for (
								let i: number = song.eqFilter.controlPoints.length;
								i < song.eqFilter.controlPointCount;
								i++
							) {
								song.eqFilter.controlPoints[i] = new FilterControlPoint();
							}
							for (let i: number = 0; i < song.eqFilter.controlPointCount; i++) {
								const point: FilterControlPoint = song.eqFilter.controlPoints[i];
								point.type = clamp(
									0,
									FilterType.length,
									base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
								);
								point.freq = clamp(
									0,
									Config.filterFreqRange,
									base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
								);
								point.gain = clamp(
									0,
									Config.filterGainRange,
									base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
								);
							}
							for (
								let i: number = song.eqFilter.controlPointCount;
								i < originalControlPointCount;
								i++
							) {
								charIndex += 3;
							}

							// Get subfilters as well. Skip Index 0, is a copy of the base filter.
							song.eqSubFilters[0] = song.eqFilter;
							const usingSubFilterBitfield: number =
								(base64CharCodeToInt[compressed.charCodeAt(charIndex++)] << 6) |
								base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
							for (let j: number = 0; j < Config.filterMorphCount - 1; j++) {
								if (usingSubFilterBitfield & (1 << j)) {
									// Number of control points
									const originalSubfilterControlPointCount: number =
										base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
									if (song.eqSubFilters[j + 1] == null) {
										song.eqSubFilters[j + 1] = new FilterSettings();
									}
									song.eqSubFilters[j + 1]!.controlPointCount = clamp(
										0,
										Config.filterMaxPoints + 1,
										originalSubfilterControlPointCount,
									);
									for (
										let i: number =
											song.eqSubFilters[j + 1]!.controlPoints.length;
										i < song.eqSubFilters[j + 1]!.controlPointCount;
										i++
									) {
										song.eqSubFilters[j + 1]!.controlPoints[i] =
											new FilterControlPoint();
									}
									for (
										let i: number = 0;
										i < song.eqSubFilters[j + 1]!.controlPointCount;
										i++
									) {
										const point: FilterControlPoint =
											song.eqSubFilters[j + 1]!.controlPoints[i];
										point.type = clamp(
											0,
											FilterType.length,
											base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
										);
										point.freq = clamp(
											0,
											Config.filterFreqRange,
											base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
										);
										point.gain = clamp(
											0,
											Config.filterGainRange,
											base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
										);
									}
									for (
										let i: number = song.eqSubFilters[j + 1]!.controlPointCount;
										i < originalSubfilterControlPointCount;
										i++
									) {
										charIndex += 3;
									}
								}
							}
						}
					}
				}
				break;
			case SongTagCode.arpeggioSpeed:
				{
					// Deprecated, but supported for legacy purposes
					if ((fromJummBox && beforeFive) || (beforeFour && fromGoldBox)) {
						const instrument: Instrument =
							song.channels[instrumentChannelIterator].instruments[
								instrumentIndexIterator
							];
						instrument.arpeggioSpeed = clamp(
							0,
							Config.modulators.dictionary["arp speed"].maxRawVol + 1,
							base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
						);
						instrument.fastTwoNoteArp =
							!!base64CharCodeToInt[compressed.charCodeAt(charIndex++)]; // Two note arp setting piggybacks on this
					} else {
						// Do nothing, deprecated for now
					}
				}
				break;
			case SongTagCode.unison:
				{
					if (beforeThree && fromBeepBox) {
						const channelIndex: number =
							base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
						const instrument = song.channels[channelIndex].instruments[0];
						instrument.unison = clamp(
							0,
							Config.unisons.length,
							base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
						);
						instrument.unisonVoices = Config.unisons[instrument.unison].voices;
						instrument.unisonSpread = Config.unisons[instrument.unison].spread;
						instrument.unisonOffset = Config.unisons[instrument.unison].offset;
						instrument.unisonExpression = Config.unisons[instrument.unison].expression;
						instrument.unisonSign = Config.unisons[instrument.unison].sign;
					} else if (beforeSix && fromBeepBox) {
						for (
							let channelIndex: number = 0;
							channelIndex < song.getChannelCount();
							channelIndex++
						) {
							for (const instrument of song.channels[channelIndex].instruments) {
								const originalValue: number =
									base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
								let unison: number = clamp(0, Config.unisons.length, originalValue);
								if (originalValue === 8) {
									// original "custom harmony" now maps to "hum" and "custom interval".
									unison = 2;
									instrument.chord = 3;
								}
								instrument.unison = unison;
								instrument.unisonVoices = Config.unisons[instrument.unison].voices;
								instrument.unisonSpread = Config.unisons[instrument.unison].spread;
								instrument.unisonOffset = Config.unisons[instrument.unison].offset;
								instrument.unisonExpression =
									Config.unisons[instrument.unison].expression;
								instrument.unisonSign = Config.unisons[instrument.unison].sign;
							}
						}
					} else if (beforeSeven && fromBeepBox) {
						const originalValue: number =
							base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
						let unison: number = clamp(0, Config.unisons.length, originalValue);
						const instrument =
							song.channels[instrumentChannelIterator].instruments[
								instrumentIndexIterator
							];
						if (originalValue === 8) {
							// original "custom harmony" now maps to "hum" and "custom interval".
							unison = 2;
							instrument.chord = 3;
						}
						instrument.unison = unison;
						instrument.unisonVoices = Config.unisons[instrument.unison].voices;
						instrument.unisonSpread = Config.unisons[instrument.unison].spread;
						instrument.unisonOffset = Config.unisons[instrument.unison].offset;
						instrument.unisonExpression = Config.unisons[instrument.unison].expression;
						instrument.unisonSign = Config.unisons[instrument.unison].sign;
					} else {
						const instrument =
							song.channels[instrumentChannelIterator].instruments[
								instrumentIndexIterator
							];
						instrument.unison = clamp(
							0,
							Config.unisons.length + 1,
							base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
						);
						const unisonLength =
							(beforeFive || !fromSlarmoosBox) && !fromJukeBox
								? 27
								: Config.unisons.length; // 27 was the old length before >2 voice presets were added

						if (
							((fromUltraBox && !beforeFive) || fromSlarmoosBox || fromJukeBox) &&
							instrument.unison === unisonLength
						) {
							instrument.unison = Config.unisons.length;
							instrument.unisonVoices =
								base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
							const bundledSigns =
								base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
							const unisonSpreadNegative = (bundledSigns >> 3) & 1;
							const unisonOffsetNegative = (bundledSigns >> 2) & 1;
							const unisonExpressionNegative = (bundledSigns >> 1) & 1;
							const unisonSignNegative = bundledSigns & 1;
							const unisonSpread: number =
								base64CharCodeToInt[compressed.charCodeAt(charIndex++)] +
								(base64CharCodeToInt[compressed.charCodeAt(charIndex++)] +
									base64CharCodeToInt[compressed.charCodeAt(charIndex++)] * 63) *
									63;

							const unisonOffset: number =
								base64CharCodeToInt[compressed.charCodeAt(charIndex++)] +
								(base64CharCodeToInt[compressed.charCodeAt(charIndex++)] +
									base64CharCodeToInt[compressed.charCodeAt(charIndex++)] * 63) *
									63;

							const unisonExpression: number =
								base64CharCodeToInt[compressed.charCodeAt(charIndex++)] +
								base64CharCodeToInt[compressed.charCodeAt(charIndex++)] * 63;

							const unisonSign: number =
								base64CharCodeToInt[compressed.charCodeAt(charIndex++)] +
								base64CharCodeToInt[compressed.charCodeAt(charIndex++)] * 63;

							instrument.unisonSpread = unisonSpread / 1000;
							if (unisonSpreadNegative === 0) instrument.unisonSpread *= -1;

							instrument.unisonOffset = unisonOffset / 1000;
							if (unisonOffsetNegative === 0) instrument.unisonOffset *= -1;

							instrument.unisonExpression = unisonExpression / 1000;
							if (unisonExpressionNegative === 0) instrument.unisonExpression *= -1;

							instrument.unisonSign = unisonSign / 1000;
							if (unisonSignNegative === 0) instrument.unisonSign *= -1;
						} else {
							instrument.unisonVoices = Config.unisons[instrument.unison].voices;
							instrument.unisonSpread = Config.unisons[instrument.unison].spread;
							instrument.unisonOffset = Config.unisons[instrument.unison].offset;
							instrument.unisonExpression =
								Config.unisons[instrument.unison].expression;
							instrument.unisonSign = Config.unisons[instrument.unison].sign;
						}
					}
				}
				break;
			case SongTagCode.chord:
				{
					if (
						(beforeNine && fromBeepBox) ||
						(fromJummBox && beforeFive) ||
						(beforeFour && fromGoldBox)
					) {
						const instrument: Instrument =
							song.channels[instrumentChannelIterator].instruments[
								instrumentIndexIterator
							];
						instrument.chord = clamp(
							0,
							Config.chords.length,
							base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
						);
						if (instrument.chord !== Config.chords.dictionary.simultaneous.index) {
							// Enable chord if it was used.
							instrument.effects |= 1 << EffectType.chord;
						}
					} else {
						// Do nothing? This song tag code is deprecated for now.
					}
				}
				break;
			case SongTagCode.effects:
				{
					const instrument: Instrument =
						song.channels[instrumentChannelIterator].instruments[
							instrumentIndexIterator
						];
					if (
						(beforeNine && fromBeepBox) ||
						(fromJummBox && beforeFive) ||
						(beforeFour && fromGoldBox)
					) {
						instrument.effects =
							base64CharCodeToInt[compressed.charCodeAt(charIndex++)] &
							((1 << EffectType.length) - 1);
						if (
							legacyGlobalReverb === 0 &&
							!((fromJummBox && beforeFive) || (beforeFour && fromGoldBox))
						) {
							// Disable reverb if legacy song reverb was zero.
							instrument.effects &= ~(1 << EffectType.reverb);
						} else if (effectsIncludeReverb(instrument.effects)) {
							instrument.reverb = legacyGlobalReverb;
						}
						// @jummbus - Enabling pan effect on song import no matter what to make it a default.
						instrument.effects |= 1 << EffectType.panning;
						if (instrument.vibrato !== Config.vibratos.dictionary.none.index) {
							// Enable vibrato if it was used.
							instrument.effects |= 1 << EffectType.vibrato;
						}
						if (instrument.detune !== Config.detuneCenter) {
							// Enable detune if it was used.
							instrument.effects |= 1 << EffectType.detune;
						}
						if (instrument.aliases) {
							instrument.effects |= 1 << EffectType.distortion;
						} else {
							instrument.effects &= ~(1 << EffectType.distortion);
						}

						// convertLegacySettings may need to force-enable note filter, call
						// it again here to make sure that this override takes precedence.
						const legacySettings: LegacySettings =
							legacySettingsCache![instrumentChannelIterator][
								instrumentIndexIterator
							];
						instrument.convertLegacySettings(legacySettings, forceSimpleFilter);
					} else {
						// BeepBox currently uses three base64 characters at 6 bits each for a bitfield representing all the enabled effects.
						if (EffectType.compressor !== 18 || EffectType.length !== 19)
							throw new Error();
						if (fromJukeBox || (fromSlarmoosBox && !beforeFive)) {
							instrument.effects =
								(base64CharCodeToInt[compressed.charCodeAt(charIndex++)] << 12) |
								(base64CharCodeToInt[compressed.charCodeAt(charIndex++)] << 6) |
								base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
						} else {
							instrument.effects =
								(base64CharCodeToInt[compressed.charCodeAt(charIndex++)] << 6) |
								base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
						}

						if (effectsIncludeNoteFilter(instrument.effects)) {
							let typeCheck: number =
								base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
							if (fromBeepBox || typeCheck === 0) {
								instrument.noteFilterType = false;
								if (
									fromJummBox ||
									fromGoldBox ||
									fromUltraBox ||
									fromSlarmoosBox ||
									fromJukeBox
								) {
									typeCheck =
										base64CharCodeToInt[compressed.charCodeAt(charIndex++)]; // Skip to next index in jummbox to get actual count
								}
								instrument.noteFilter.controlPointCount = clamp(
									0,
									Config.filterMaxPoints + 1,
									typeCheck,
								);
								for (
									let i: number = instrument.noteFilter.controlPoints.length;
									i < instrument.noteFilter.controlPointCount;
									i++
								) {
									instrument.noteFilter.controlPoints[i] =
										new FilterControlPoint();
								}
								for (
									let i: number = 0;
									i < instrument.noteFilter.controlPointCount;
									i++
								) {
									const point: FilterControlPoint =
										instrument.noteFilter.controlPoints[i];
									point.type = clamp(
										0,
										FilterType.length,
										base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
									);
									point.freq = clamp(
										0,
										Config.filterFreqRange,
										base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
									);
									point.gain = clamp(
										0,
										Config.filterGainRange,
										base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
									);
								}
								for (
									let i: number = instrument.noteFilter.controlPointCount;
									i < typeCheck;
									i++
								) {
									charIndex += 3;
								}

								// Get subfilters as well. Skip Index 0, is a copy of the base filter.
								instrument.noteSubFilters[0] = instrument.noteFilter;
								if (
									(fromJummBox && !beforeFive) ||
									fromGoldBox ||
									fromUltraBox ||
									fromSlarmoosBox ||
									fromJukeBox
								) {
									const usingSubFilterBitfield: number =
										(base64CharCodeToInt[compressed.charCodeAt(charIndex++)] <<
											6) |
										base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
									for (let j: number = 0; j < Config.filterMorphCount - 1; j++) {
										if (usingSubFilterBitfield & (1 << j)) {
											// Number of control points
											const originalSubfilterControlPointCount: number =
												base64CharCodeToInt[
													compressed.charCodeAt(charIndex++)
												];
											if (instrument.noteSubFilters[j + 1] == null) {
												instrument.noteSubFilters[j + 1] =
													new FilterSettings();
											}
											instrument.noteSubFilters[j + 1]!.controlPointCount =
												clamp(
													0,
													Config.filterMaxPoints + 1,
													originalSubfilterControlPointCount,
												);
											for (
												let i: number =
													instrument.noteSubFilters[j + 1]!.controlPoints
														.length;
												i <
												instrument.noteSubFilters[j + 1]!.controlPointCount;
												i++
											) {
												instrument.noteSubFilters[j + 1]!.controlPoints[i] =
													new FilterControlPoint();
											}
											for (
												let i: number = 0;
												i <
												instrument.noteSubFilters[j + 1]!.controlPointCount;
												i++
											) {
												const point: FilterControlPoint =
													instrument.noteSubFilters[j + 1]!.controlPoints[
														i
													];
												point.type = clamp(
													0,
													FilterType.length,
													base64CharCodeToInt[
														compressed.charCodeAt(charIndex++)
													],
												);
												point.freq = clamp(
													0,
													Config.filterFreqRange,
													base64CharCodeToInt[
														compressed.charCodeAt(charIndex++)
													],
												);
												point.gain = clamp(
													0,
													Config.filterGainRange,
													base64CharCodeToInt[
														compressed.charCodeAt(charIndex++)
													],
												);
											}
											for (
												let i: number =
													instrument.noteSubFilters[j + 1]!
														.controlPointCount;
												i < originalSubfilterControlPointCount;
												i++
											) {
												charIndex += 3;
											}
										}
									}
								}
							} else {
								instrument.noteFilterType = true;
								instrument.noteFilter.reset();
								instrument.noteFilterSimpleCut = clamp(
									0,
									Config.filterSimpleCutRange,
									base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
								);
								instrument.noteFilterSimplePeak = clamp(
									0,
									Config.filterSimplePeakRange,
									base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
								);
							}
						}
						if (effectsIncludeTransition(instrument.effects)) {
							instrument.transition = clamp(
								0,
								Config.transitions.length,
								base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
							);
						}
						if (effectsIncludeChord(instrument.effects)) {
							instrument.chord = clamp(
								0,
								Config.chords.length,
								base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
							);
							// Custom arpeggio speed... only in JB, and only if the instrument arpeggiates.
							if (
								instrument.chord === Config.chords.dictionary.arpeggio.index &&
								(fromJummBox ||
									fromGoldBox ||
									fromUltraBox ||
									fromSlarmoosBox ||
									fromJukeBox)
							) {
								instrument.arpeggioSpeed =
									base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
								instrument.fastTwoNoteArp =
									!!base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
							}
							if (
								instrument.chord === Config.chords.dictionary.monophonic.index &&
								((fromSlarmoosBox && !beforeFive) || fromJukeBox)
							) {
								instrument.monoChordTone =
									base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
							}
						}
						if (effectsIncludePitchShift(instrument.effects)) {
							instrument.pitchShift = clamp(
								0,
								Config.pitchShiftRange,
								base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
							);
						}
						if (effectsIncludeDetune(instrument.effects)) {
							if (fromBeepBox) {
								// Convert from BeepBox's formula
								instrument.detune = clamp(
									Config.detuneMin,
									Config.detuneMax + 1,
									base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
								);
								instrument.detune = Math.round(
									((instrument.detune - 9) *
										(Math.abs(instrument.detune - 9) + 1)) /
										2 +
										Config.detuneCenter,
								);
							} else {
								instrument.detune = clamp(
									Config.detuneMin,
									Config.detuneMax + 1,
									(base64CharCodeToInt[compressed.charCodeAt(charIndex++)] << 6) +
										base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
								);
							}
						}
						if (effectsIncludeVibrato(instrument.effects)) {
							instrument.vibrato = clamp(
								0,
								Config.vibratos.length + 1,
								base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
							);

							// Custom vibrato
							if (
								instrument.vibrato === Config.vibratos.length &&
								(fromJummBox ||
									fromGoldBox ||
									fromUltraBox ||
									fromSlarmoosBox ||
									fromJukeBox)
							) {
								instrument.vibratoDepth =
									clamp(
										0,
										Config.modulators.dictionary["vibrato depth"].maxRawVol + 1,
										base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
									) / 25;
								instrument.vibratoSpeed = clamp(
									0,
									Config.modulators.dictionary["vibrato speed"].maxRawVol + 1,
									base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
								);
								instrument.vibratoDelay = clamp(
									0,
									Config.modulators.dictionary["vibrato delay"].maxRawVol + 1,
									base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
								);
								instrument.vibratoType = clamp(
									0,
									Config.vibratoTypes.length,
									base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
								);
							} // Enforce standard vibrato settings
							else {
								instrument.vibratoDepth =
									Config.vibratos[instrument.vibrato].amplitude;
								instrument.vibratoSpeed = 10; // Normal speed
								instrument.vibratoDelay =
									Config.vibratos[instrument.vibrato].delayTicks / 2;
								instrument.vibratoType = Config.vibratos[instrument.vibrato].type;
							}
						}
						if (effectsIncludeDistortion(instrument.effects)) {
							instrument.distortion = clamp(
								0,
								Config.distortionRange,
								base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
							);
							if (
								(fromJummBox && !beforeFive) ||
								fromGoldBox ||
								fromUltraBox ||
								fromSlarmoosBox ||
								fromJukeBox
							) {
								instrument.aliases =
									!!base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
							}
						}
						if (effectsIncludeBitcrusher(instrument.effects)) {
							instrument.bitcrusherFreq = clamp(
								0,
								Config.bitcrusherFreqRange,
								base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
							);
							instrument.bitcrusherQuantization = clamp(
								0,
								Config.bitcrusherQuantizationRange,
								base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
							);
						}

						if (effectsIncludePanning(instrument.effects)) {
							if (fromBeepBox) {
								// Beepbox has a panMax of 8 (9 total positions), Jummbox has a panMax of 100 (101 total positions)
								instrument.pan = clamp(
									0,
									Config.panMax + 1,
									Math.round(
										base64CharCodeToInt[compressed.charCodeAt(charIndex++)] *
											(Config.panMax / 8.0),
									),
								);
							} else {
								instrument.pan = clamp(
									0,
									Config.panMax + 1,
									(base64CharCodeToInt[compressed.charCodeAt(charIndex++)] << 6) +
										base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
								);
							}

							// Now, pan delay follows on new versions of jummbox.
							if (
								(fromJummBox && !beforeTwo) ||
								fromGoldBox ||
								fromUltraBox ||
								fromSlarmoosBox ||
								fromJukeBox
							) {
								instrument.panDelay =
									base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
							}
						}
						if (effectsIncludeChorus(instrument.effects)) {
							if (fromBeepBox) {
								// BeepBox has 4 chorus values vs. JB's 8
								instrument.chorus =
									clamp(
										0,
										Config.chorusRange / 2 + 1,
										base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
									) * 2;
							} else {
								instrument.chorus = clamp(
									0,
									Config.chorusRange,
									base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
								);
							}
						}
						if (effectsIncludeEcho(instrument.effects)) {
							instrument.echoSustain = clamp(
								0,
								Config.echoSustainRange,
								base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
							);
							instrument.echoDelay = clamp(
								0,
								Config.echoDelayRange,
								base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
							);
						}
						if (effectsIncludeReverb(instrument.effects)) {
							if (fromBeepBox) {
								instrument.reverb = clamp(
									0,
									Config.reverbRange,
									Math.round(
										(base64CharCodeToInt[compressed.charCodeAt(charIndex++)] *
											Config.reverbRange) /
											3.0,
									),
								);
							} else {
								instrument.reverb = clamp(
									0,
									Config.reverbRange,
									base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
								);
							}
						}
						if (effectsIncludeGranular(instrument.effects)) {
							instrument.granular =
								base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
							instrument.grainSize =
								base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
							instrument.grainAmounts =
								base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
							instrument.grainRange =
								base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
						}
						if (effectsIncludeRingModulation(instrument.effects)) {
							instrument.ringModulation = clamp(
								0,
								Config.ringModRange,
								base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
							);
							instrument.ringModulationHz = clamp(
								0,
								Config.ringModHzRange,
								base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
							);
							instrument.ringModWaveformIndex = clamp(
								0,
								Config.operatorWaves.length,
								base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
							);
							instrument.ringModPulseWidth = clamp(
								0,
								Config.pulseWidthRange,
								base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
							);
							instrument.ringModHzOffset = clamp(
								Config.rmHzOffsetMin,
								Config.rmHzOffsetMax + 1,
								(base64CharCodeToInt[compressed.charCodeAt(charIndex++)] << 6) +
									base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
							);
						}
						if (effectsIncludePhaser(instrument.effects)) {
							instrument.phaserFreq = clamp(
								0,
								Config.phaserFreqRange,
								base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
							);
							instrument.phaserFeedback = clamp(
								0,
								Config.phaserFeedbackRange,
								base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
							);
							instrument.phaserStages = clamp(
								0,
								Config.phaserMaxStages + 1,
								base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
							);
							instrument.phaserMix = clamp(
								0,
								Config.phaserMixRange,
								base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
							);
						}
						if (effectsIncludeInvertWave(instrument.effects)) {
							instrument.invertWave =
								!!base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
						}
						if (effectsIncludeNoteRange(instrument.effects)) {
							instrument.upperNoteLimit =
								(base64CharCodeToInt[compressed.charCodeAt(charIndex++)] << 6) +
								base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
							instrument.lowerNoteLimit =
								(base64CharCodeToInt[compressed.charCodeAt(charIndex++)] << 6) +
								base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
						}
					}
					// Clamp the range.
					instrument.effects &= (1 << EffectType.length) - 1;
				}
				break;
			case SongTagCode.compressor:
				{
					const instrument: Instrument =
						song.channels[instrumentChannelIterator].instruments[
							instrumentIndexIterator
						];
					instrument.effects |= 1 << EffectType.compressor;
					instrument.compressorThreshold = clamp(
						0,
						Config.compressorThresholdRange,
						base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
					);
					instrument.compressorRatio = clamp(
						0,
						Config.compressorRatios.length,
						base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
					);
					instrument.compressorAttack = clamp(
						0,
						Config.compressorAttackRange,
						base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
					);
					instrument.compressorRelease = clamp(
						0,
						Config.compressorReleaseRange,
						base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
					);
					instrument.compressorSync = clamp(
						0,
						Config.compressorSyncBeats.length,
						base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
					);
				}
				break;
			case SongTagCode.volume:
				{
					if (beforeThree && fromBeepBox) {
						const channelIndex: number =
							base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
						const instrument: Instrument = song.channels[channelIndex].instruments[0];
						instrument.volume = Math.round(
							clamp(
								-Config.volumeRange / 2,
								1,
								-base64CharCodeToInt[compressed.charCodeAt(charIndex++)] * 5.0,
							),
						);
					} else if (beforeSix && fromBeepBox) {
						for (
							let channelIndex: number = 0;
							channelIndex < song.getChannelCount();
							channelIndex++
						) {
							for (const instrument of song.channels[channelIndex].instruments) {
								instrument.volume = Math.round(
									clamp(
										-Config.volumeRange / 2,
										1,
										-base64CharCodeToInt[compressed.charCodeAt(charIndex++)] *
											5.0,
									),
								);
							}
						}
					} else if (beforeSeven && fromBeepBox) {
						const instrument: Instrument =
							song.channels[instrumentChannelIterator].instruments[
								instrumentIndexIterator
							];
						instrument.volume = Math.round(
							clamp(
								-Config.volumeRange / 2,
								1,
								-base64CharCodeToInt[compressed.charCodeAt(charIndex++)] * 5.0,
							),
						);
					} else if (fromBeepBox) {
						// Beepbox v9's volume range is 0-7 (0 is max, 7 is mute)
						const instrument: Instrument =
							song.channels[instrumentChannelIterator].instruments[
								instrumentIndexIterator
							];
						instrument.volume = Math.round(
							clamp(
								-Config.volumeRange / 2,
								1,
								(-base64CharCodeToInt[compressed.charCodeAt(charIndex++)] * 25.0) /
									7.0,
							),
						);
					} else {
						const instrument: Instrument =
							song.channels[instrumentChannelIterator].instruments[
								instrumentIndexIterator
							];
						// Volume is stored in two bytes in jummbox just in case range ever exceeds one byte, e.g. through later waffling on the subject.
						instrument.volume = Math.round(
							clamp(
								-Config.volumeRange / 2,
								Config.volumeRange / 2 + 1,
								((base64CharCodeToInt[compressed.charCodeAt(charIndex++)] << 6) |
									base64CharCodeToInt[compressed.charCodeAt(charIndex++)]) -
									Config.volumeRange / 2,
							),
						);
					}
				}
				break;
			case SongTagCode.pan:
				{
					if (beforeNine && fromBeepBox) {
						// Beepbox has a panMax of 8 (9 total positions), Jummbox has a panMax of 100 (101 total positions)
						const instrument: Instrument =
							song.channels[instrumentChannelIterator].instruments[
								instrumentIndexIterator
							];
						instrument.pan = clamp(
							0,
							Config.panMax + 1,
							base64CharCodeToInt[compressed.charCodeAt(charIndex++)] *
								(Config.panMax / 8.0),
						);
					} else if ((fromJummBox && beforeFive) || (beforeFour && fromGoldBox)) {
						const instrument: Instrument =
							song.channels[instrumentChannelIterator].instruments[
								instrumentIndexIterator
							];
						instrument.pan = clamp(
							0,
							Config.panMax + 1,
							(base64CharCodeToInt[compressed.charCodeAt(charIndex++)] << 6) +
								base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
						);
						// Pan delay follows on v3 + v4
						if (
							(fromJummBox && !beforeThree) ||
							fromGoldBox ||
							fromUltraBox ||
							fromSlarmoosBox ||
							fromJukeBox
						) {
							instrument.panDelay =
								base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
						}
					} else {
						// Do nothing? This song tag code is deprecated for now.
					}
				}
				break;
			case SongTagCode.detune:
				{
					const instrument: Instrument =
						song.channels[instrumentChannelIterator].instruments[
							instrumentIndexIterator
						];

					if ((fromJummBox && beforeFive) || (beforeFour && fromGoldBox)) {
						// Before jummbox v5, detune was -50 to 50. Now it is 0 to 400
						instrument.detune = clamp(
							Config.detuneMin,
							Config.detuneMax + 1,
							((base64CharCodeToInt[compressed.charCodeAt(charIndex++)] << 6) +
								base64CharCodeToInt[compressed.charCodeAt(charIndex++)]) *
								4,
						);
						instrument.effects |= 1 << EffectType.detune;
					} else {
						// Now in v5, tag code is deprecated and handled thru detune effects.
					}
				}
				break;
			case SongTagCode.customChipWave:
				{
					const instrument: Instrument =
						song.channels[instrumentChannelIterator].instruments[
							instrumentIndexIterator
						];
					// Pop custom wave values
					for (let j: number = 0; j < 64; j++) {
						instrument.customChipWave[j] = clamp(
							-24,
							25,
							base64CharCodeToInt[compressed.charCodeAt(charIndex++)] - 24,
						);
					}

					let sum: number = 0.0;
					for (let i: number = 0; i < instrument.customChipWave.length; i++) {
						sum += instrument.customChipWave[i];
					}
					const average: number = sum / instrument.customChipWave.length;

					// Perform the integral on the wave. The chipSynth will perform the derivative to get the original wave back but with antialiasing.
					let cumulative: number = 0;
					let wavePrev: number = 0;
					for (let i: number = 0; i < instrument.customChipWave.length; i++) {
						cumulative += wavePrev;
						wavePrev = instrument.customChipWave[i] - average;
						instrument.customChipWaveIntegral[i] = cumulative;
					}

					// 65th, last sample is for anti-aliasing
					instrument.customChipWaveIntegral[64] = 0.0;
				}
				break;
			case SongTagCode.limiterSettings:
				{
					let nextValue: number = base64CharCodeToInt[compressed.charCodeAt(charIndex++)];

					// Check if limiter settings are used... if not, restore to default
					if (nextValue === 0x3f) {
						song.restoreLimiterDefaults();
					} else {
						// Limiter is used, grab values
						song.compressionRatio =
							nextValue < 10 ? nextValue / 10 : 1 + (nextValue - 10) / 60;
						nextValue = base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
						song.limitRatio = nextValue < 10 ? nextValue / 10 : nextValue - 9;
						song.limitDecay = base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
						song.limitRise =
							base64CharCodeToInt[compressed.charCodeAt(charIndex++)] * 250.0 +
							2000.0;
						song.compressionThreshold =
							base64CharCodeToInt[compressed.charCodeAt(charIndex++)] / 20.0;
						song.limitThreshold =
							base64CharCodeToInt[compressed.charCodeAt(charIndex++)] / 20.0;
						song.masterGain =
							((base64CharCodeToInt[compressed.charCodeAt(charIndex++)] << 6) +
								base64CharCodeToInt[compressed.charCodeAt(charIndex++)]) /
							50.0;
					}
				}
				break;
			case SongTagCode.channelNames:
				{
					for (let channel: number = 0; channel < song.getChannelCount(); channel++) {
						// Length of channel name string. Due to some crazy Unicode characters this needs to be 2 bytes...
						let channelNameLength: number;
						if (
							beforeFour &&
							!fromGoldBox &&
							!fromUltraBox &&
							!fromSlarmoosBox &&
							!fromJukeBox
						) {
							channelNameLength =
								base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
						} else {
							channelNameLength =
								(base64CharCodeToInt[compressed.charCodeAt(charIndex++)] << 6) +
								base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
						}
						song.channels[channel].name = decodeSongText(
							compressed.substring(charIndex, charIndex + channelNameLength),
							"channel name",
						);

						charIndex += channelNameLength;
					}
				}
				break;
			case SongTagCode.algorithm:
				{
					const instrument: Instrument =
						song.channels[instrumentChannelIterator].instruments[
							instrumentIndexIterator
						];
					if (instrument.type === InstrumentType.fm) {
						instrument.algorithm = clamp(
							0,
							Config.algorithms.length,
							base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
						);
					} else if (instrument.type === InstrumentType.opl3) {
						instrument.opl3Algorithm = clamp(
							0,
							Config.algorithmsOpl3.length,
							base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
						);
					} else {
						instrument.algorithm6Op = clamp(
							0,
							Config.algorithms6Op.length,
							base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
						);
						instrument.customAlgorithm.fromPreset(instrument.algorithm6Op);
						if (compressed.charCodeAt(charIndex) === SongTagCode.chord) {
							const carrierCountTemp = clamp(
								1,
								Config.operatorCount + 2 + 1,
								base64CharCodeToInt[compressed.charCodeAt(charIndex + 1)],
							);
							charIndex++;
							const tempModArray: number[][] = [];
							if (compressed.charCodeAt(charIndex + 1) === SongTagCode.effects) {
								charIndex++;
								let j: number = 0;
								charIndex++;
								while (compressed.charCodeAt(charIndex) !== SongTagCode.effects) {
									tempModArray[j] = [];
									let o: number = 0;
									while (
										compressed.charCodeAt(charIndex) !==
										SongTagCode.operatorWaves
									) {
										tempModArray[j][o] = clamp(
											1,
											Config.operatorCount + 3,
											base64CharCodeToInt[compressed.charCodeAt(charIndex)],
										);
										o++;
										charIndex++;
									}
									j++;
									charIndex++;
								}
								instrument.customAlgorithm.set(carrierCountTemp, tempModArray);
								charIndex++; // ????
							}
						}
					}
					if (
						(beforeNine && fromBeepBox) ||
						(beforeFive && fromJummBox) ||
						(beforeFour && fromGoldBox)
					) {
						// The algorithm determines the carrier count, which affects how legacy settings are imported.
						const legacySettings: LegacySettings =
							legacySettingsCache![instrumentChannelIterator][
								instrumentIndexIterator
							];
						instrument.convertLegacySettings(legacySettings, forceSimpleFilter);
					}
				}
				break;
			case SongTagCode.supersaw:
				{
					if (fromGoldBox && !beforeFour && beforeSix) {
						// is it more useful to save base64 characters or url length?
						const chipWaveForCompat =
							base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
						if (chipWaveForCompat + 62 > 85) {
							if (
								document.URL.substring(document.URL.length - 13).toLowerCase() !==
								"legacysamples"
							) {
								if (!willLoadLegacySamplesForOldSongs) {
									willLoadLegacySamplesForOldSongs = true;
									song.customSampleHandler?.setCustomSamples(["legacySamples"]);
									if (!song.customSampleHandler?.deferSampleLoading) {
										Config.willReloadForCustomSamples = true;
										loadBuiltInSamples(0);
									}
								}
							}
						}

						if (chipWaveForCompat + 62 > 78) {
							song.channels[instrumentChannelIterator].instruments[
								instrumentIndexIterator
							].chipWave = clamp(0, Config.chipWaves.length, chipWaveForCompat + 63);
						} else if (chipWaveForCompat + 62 > 67) {
							song.channels[instrumentChannelIterator].instruments[
								instrumentIndexIterator
							].chipWave = clamp(0, Config.chipWaves.length, chipWaveForCompat + 61);
						} else if (chipWaveForCompat + 62 === 67) {
							song.channels[instrumentChannelIterator].instruments[
								instrumentIndexIterator
							].chipWave = 40;
						} else {
							song.channels[instrumentChannelIterator].instruments[
								instrumentIndexIterator
							].chipWave = clamp(0, Config.chipWaves.length, chipWaveForCompat + 62);
						}
					} else {
						const instrument: Instrument =
							song.channels[instrumentChannelIterator].instruments[
								instrumentIndexIterator
							];
						instrument.supersawDynamism = clamp(
							0,
							Config.supersawDynamismMax + 1,
							base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
						);
						instrument.supersawSpread = clamp(
							0,
							Config.supersawSpreadMax + 1,
							base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
						);
						instrument.supersawShape = clamp(
							0,
							Config.supersawShapeMax + 1,
							base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
						);
					}
				}
				break;
			case SongTagCode.feedbackType:
				{
					const instrument: Instrument =
						song.channels[instrumentChannelIterator].instruments[
							instrumentIndexIterator
						];
					if (instrument.type === InstrumentType.fm) {
						instrument.feedbackType = clamp(
							0,
							Config.feedbacks.length,
							base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
						);
					} else {
						instrument.feedbackType6Op = clamp(
							0,
							Config.feedbacks6Op.length,
							base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
						);
						instrument.customFeedbackType.fromPreset(instrument.feedbackType6Op);
						const tempModArray: number[][] = [];
						if (compressed.charCodeAt(charIndex) === SongTagCode.effects) {
							let j: number = 0;
							charIndex++;
							while (compressed.charCodeAt(charIndex) !== SongTagCode.effects) {
								tempModArray[j] = [];
								let o: number = 0;
								while (
									compressed.charCodeAt(charIndex) !== SongTagCode.operatorWaves
								) {
									tempModArray[j][o] = clamp(
										1,
										Config.operatorCount + 2,
										base64CharCodeToInt[compressed.charCodeAt(charIndex)],
									);
									o++;
									charIndex++;
								}
								j++;
								charIndex++;
							}
							instrument.customFeedbackType.set(tempModArray);
							charIndex++; // ???? weirdly needs to skip the end character or it'll use that next loop instead of like just moving to the next one itself
						}
					}
				}
				break;
			case SongTagCode.feedbackAmplitude:
				{
					song.channels[instrumentChannelIterator].instruments[
						instrumentIndexIterator
					].feedbackAmplitude = clamp(
						0,
						Config.operatorAmplitudeMax + 1,
						base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
					);
				}
				break;
			case SongTagCode.feedbackEnvelope:
				{
					if (
						(beforeNine && fromBeepBox) ||
						(beforeFive && fromJummBox) ||
						(beforeFour && fromGoldBox)
					) {
						const pregoldToEnvelope: number[] = [
							0, 1, 2, 4, 5, 6, 8, 9, 10, 12, 13, 14, 16, 17, 18, 19, 20, 21, 23, 24,
							25, 27, 28, 29, 32, 33, 34, 31, 11,
						];
						const instrument: Instrument =
							song.channels[instrumentChannelIterator].instruments[
								instrumentIndexIterator
							];
						const legacySettings: LegacySettings =
							legacySettingsCache![instrumentChannelIterator][
								instrumentIndexIterator
							];

						let aa: number = base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
						if (
							(beforeTwo && fromGoldBox) ||
							(!fromGoldBox && !fromUltraBox && !fromSlarmoosBox && !fromJukeBox)
						) {
							aa = pregoldToEnvelope[aa];
						}
						legacySettings.feedbackEnvelope = envelopeFromLegacyIndex(
							base64CharCodeToInt[aa],
						);
						instrument.convertLegacySettings(legacySettings, forceSimpleFilter);
					} else {
						// Do nothing? This song tag code is deprecated for now.
					}
				}
				break;
			case SongTagCode.operatorFrequencies:
				{
					const instrument =
						song.channels[instrumentChannelIterator].instruments[
							instrumentIndexIterator
						];
					if (beforeThree && fromGoldBox) {
						const freqToGold3 = [
							4, 5, 6, 7, 8, 10, 12, 13, 14, 15, 16, 18, 20, 22, 24, 2, 1, 9, 17, 19,
							21, 23, 0, 3,
						];

						for (
							let o = 0;
							o <
							(instrument.type === InstrumentType.fm6op ? 6 : Config.operatorCount);
							o++
						) {
							instrument.operators[o].frequency =
								freqToGold3[
									clamp(
										0,
										freqToGold3.length,
										base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
									)
								];
						}
					} else if (!fromGoldBox && !fromUltraBox && !fromSlarmoosBox && !fromJukeBox) {
						const freqToUltraBox = [
							4, 5, 6, 7, 8, 10, 12, 13, 14, 15, 16, 18, 20, 23, 27, 2, 1, 9, 17, 19,
							21, 23, 0, 3,
						];

						for (
							let o = 0;
							o <
							(instrument.type === InstrumentType.fm6op ? 6 : Config.operatorCount);
							o++
						) {
							instrument.operators[o].frequency =
								freqToUltraBox[
									clamp(
										0,
										freqToUltraBox.length,
										base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
									)
								];
						}
					} else {
						for (
							let o = 0;
							o <
							(instrument.type === InstrumentType.fm6op ? 6 : Config.operatorCount);
							o++
						) {
							instrument.operators[o].frequency = clamp(
								0,
								Config.operatorFrequencies.length,
								base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
							);
						}
					}
				}
				break;
			case SongTagCode.operatorAmplitudes:
				{
					const instrument: Instrument =
						song.channels[instrumentChannelIterator].instruments[
							instrumentIndexIterator
						];
					for (
						let o: number = 0;
						o < (instrument.type === InstrumentType.fm6op ? 6 : Config.operatorCount);
						o++
					) {
						instrument.operators[o].amplitude = clamp(
							0,
							Config.operatorAmplitudeMax + 1,
							base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
						);
					}
				}
				break;
			case SongTagCode.envelopes:
				{
					const pregoldToEnvelope: number[] = [
						0, 1, 2, 4, 5, 6, 8, 9, 10, 12, 13, 14, 16, 17, 18, 19, 20, 21, 23, 24, 25,
						27, 28, 29, 32, 33, 34, 31, 11,
					];
					const jummToUltraEnvelope: number[] = [
						0, 1, 2, 4, 5, 6, 8, 9, 10, 12, 13, 14, 16, 17, 18, 19, 20, 21, 23, 24, 25,
						58, 59, 60,
					];
					const slarURL3toURL4Envelope: number[] = [
						0, 1, 2, 3, 4, 5, 6, 7, 8, 8, 9, 10, 11, 12, 13, 14,
					];
					const instrument: Instrument =
						song.channels[instrumentChannelIterator].instruments[
							instrumentIndexIterator
						];
					if (
						(beforeNine && fromBeepBox) ||
						(beforeFive && fromJummBox) ||
						(beforeFour && fromGoldBox)
					) {
						const legacySettings: LegacySettings =
							legacySettingsCache![instrumentChannelIterator][
								instrumentIndexIterator
							];
						legacySettings.operatorEnvelopes = [];
						for (
							let o: number = 0;
							o <
							(instrument.type === InstrumentType.fm6op ? 6 : Config.operatorCount);
							o++
						) {
							let aa: number =
								base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
							if ((beforeTwo && fromGoldBox) || fromBeepBox)
								aa = pregoldToEnvelope[aa];
							if (fromJummBox) aa = jummToUltraEnvelope[aa];
							legacySettings.operatorEnvelopes[o] = envelopeFromLegacyIndex(aa);
						}
						instrument.convertLegacySettings(legacySettings, forceSimpleFilter);
					} else {
						const envelopeCount: number = clamp(
							0,
							Config.maxEnvelopeCount + 1,
							base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
						);
						// JB v6 adds some envelope options here in the sequence.
						let envelopeDiscrete: boolean = false;
						if (
							(fromJummBox && !beforeSix) ||
							(fromUltraBox && !beforeFive) ||
							fromSlarmoosBox ||
							fromJukeBox
						) {
							instrument.envelopeSpeed = clamp(
								0,
								Config.modulators.dictionary["envelope speed"].maxRawVol + 1,
								base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
							);
							if ((!fromSlarmoosBox || beforeFive) && !fromJukeBox) {
								envelopeDiscrete =
									!!base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
							}
						}
						for (let i: number = 0; i < envelopeCount; i++) {
							const target: number = clamp(
								0,
								Config.instrumentAutomationTargets.length,
								base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
							);
							let index: number = 0;
							const maxCount: number =
								Config.instrumentAutomationTargets[target].maxCount;
							if (maxCount > 1) {
								index = clamp(
									0,
									maxCount,
									base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
								);
							}
							let aa: number =
								base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
							if ((beforeTwo && fromGoldBox) || fromBeepBox)
								aa = pregoldToEnvelope[aa];
							if (fromJummBox) aa = jummToUltraEnvelope[aa];
							if (!fromJukeBox && !fromSlarmoosBox && aa >= 2) aa++; // 2 for pitch
							let updatedEnvelopes: boolean = false;
							let perEnvelopeSpeed: number = 1;
							if (!fromJukeBox && (!fromSlarmoosBox || beforeThree)) {
								updatedEnvelopes = true;
								perEnvelopeSpeed = Config.envelopes[aa].speed;
								aa = Config.envelopes[aa].type; // update envelopes
							} else if (!fromJukeBox && beforeFour && aa >= 3) aa++; // 3 for random
							let isTremolo2: boolean = false;
							if (
								(fromSlarmoosBox && !beforeThree && beforeFour) ||
								updatedEnvelopes
							) {
								// remove tremolo2
								if (aa === 9) isTremolo2 = true;
								aa = slarURL3toURL4Envelope[aa];
							}
							const envelope: number = clamp(
								0,
								fromJukeBox || (fromSlarmoosBox && !beforeThree) || updatedEnvelopes
									? Config.newEnvelopes.length
									: Config.envelopes.length,
								aa,
							);
							let pitchEnvelopeStart: number = 0;
							let pitchEnvelopeEnd: number = Config.maxPitch;
							let envelopeInverse: boolean = false;
							perEnvelopeSpeed =
								fromJukeBox || (fromSlarmoosBox && !beforeThree)
									? Config.newEnvelopes[envelope].speed
									: perEnvelopeSpeed;
							let perEnvelopeLowerBound: number = 0;
							let perEnvelopeUpperBound: number = 1;
							let steps: number = 2;
							let seed: number = 2;
							let waveform: number = LFOEnvelopeTypes.sine;
							// pull out unique envelope setting values first, then general ones
							if (fromJukeBox || (fromSlarmoosBox && !beforeFour)) {
								if (envelope === ENV_LFO) {
									waveform = clamp(
										0,
										LFOEnvelopeTypes.length,
										base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
									);
									if (
										waveform === LFOEnvelopeTypes.steppedSaw ||
										waveform === LFOEnvelopeTypes.steppedTri
									) {
										steps = clamp(
											1,
											Config.randomEnvelopeStepsMax + 1,
											base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
										);
									}
								} else if (envelope === ENV_RANDOM) {
									steps = clamp(
										1,
										Config.randomEnvelopeStepsMax + 1,
										base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
									);
									seed = clamp(
										1,
										Config.randomEnvelopeSeedMax + 1,
										base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
									);
									waveform = clamp(
										0,
										RandomEnvelopeTypes.length,
										base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
									); // waveform field reused for random type
								}
							}
							if (fromJukeBox || (fromSlarmoosBox && !beforeThree)) {
								if (envelope === ENV_PITCH) {
									if (!instrument.isNoiseInstrument) {
										let pitchEnvelopeCompact: number =
											base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
										pitchEnvelopeStart = clamp(
											0,
											Config.maxPitch + 1,
											pitchEnvelopeCompact * 64 +
												base64CharCodeToInt[
													compressed.charCodeAt(charIndex++)
												],
										);
										pitchEnvelopeCompact =
											base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
										pitchEnvelopeEnd = clamp(
											0,
											Config.maxPitch + 1,
											pitchEnvelopeCompact * 64 +
												base64CharCodeToInt[
													compressed.charCodeAt(charIndex++)
												],
										);
									} else {
										pitchEnvelopeStart = clamp(
											0,
											Config.drumCount,
											base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
										);
										pitchEnvelopeEnd = clamp(
											0,
											Config.drumCount,
											base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
										);
									}
								}
								const checkboxValues: number =
									base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
								if (fromJukeBox || (fromSlarmoosBox && !beforeFive)) {
									envelopeDiscrete = checkboxValues >> 1 === 1;
								}
								envelopeInverse = (checkboxValues & 1) === 1;
								if (
									envelope !== ENV_PITCH &&
									envelope !== ENV_NOTESIZE &&
									envelope !== ENV_PUNCH &&
									envelope !== ENV_NONE
								) {
									perEnvelopeSpeed =
										Config.perEnvelopeSpeedIndices[
											base64CharCodeToInt[compressed.charCodeAt(charIndex++)]
										];
								}
								perEnvelopeLowerBound =
									base64CharCodeToInt[compressed.charCodeAt(charIndex++)] / 10;
								perEnvelopeUpperBound =
									base64CharCodeToInt[compressed.charCodeAt(charIndex++)] / 10;
							}
							if ((!fromSlarmoosBox && !fromJukeBox) || beforeFour) {
								// update tremolo2
								if (isTremolo2) {
									waveform = LFOEnvelopeTypes.sine;
									if (envelopeInverse) {
										perEnvelopeUpperBound =
											Math.floor((perEnvelopeUpperBound / 2) * 10) / 10;
										perEnvelopeLowerBound =
											Math.floor((perEnvelopeLowerBound / 2) * 10) / 10;
									} else {
										perEnvelopeUpperBound =
											Math.floor(
												(0.5 +
													(perEnvelopeUpperBound -
														perEnvelopeLowerBound) /
														2) *
													10,
											) / 10;
										perEnvelopeLowerBound = 0.5;
									}
								}
							}

							instrument.addEnvelope(
								target,
								index,
								envelope,
								true,
								pitchEnvelopeStart,
								pitchEnvelopeEnd,
								envelopeInverse,
								perEnvelopeSpeed,
								perEnvelopeLowerBound,
								perEnvelopeUpperBound,
								steps,
								seed,
								waveform,
								envelopeDiscrete,
							);
							if (fromSlarmoosBox && beforeThree && !beforeTwo) {
								let pitchEnvelopeCompact: number =
									base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
								instrument.envelopes[i].pitchEnvelopeStart =
									pitchEnvelopeCompact * 64 +
									base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
								pitchEnvelopeCompact =
									base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
								instrument.envelopes[i].pitchEnvelopeEnd =
									pitchEnvelopeCompact * 64 +
									base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
								instrument.envelopes[i].inverse =
									base64CharCodeToInt[compressed.charCodeAt(charIndex++)] === 1;
							}
						}

						let instrumentPitchEnvelopeStart: number = 0;
						let instrumentPitchEnvelopeEnd: number = Config.maxPitch;
						let instrumentEnvelopeInverse: boolean = false;
						if (fromSlarmoosBox && beforeTwo) {
							let pitchEnvelopeCompact: number =
								base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
							instrumentPitchEnvelopeStart =
								pitchEnvelopeCompact * 64 +
								base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
							pitchEnvelopeCompact =
								base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
							instrumentPitchEnvelopeEnd =
								pitchEnvelopeCompact * 64 +
								base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
							instrumentEnvelopeInverse =
								base64CharCodeToInt[compressed.charCodeAt(charIndex++)] === 1;
							for (let i: number = 0; i < envelopeCount; i++) {
								instrument.envelopes[i].pitchEnvelopeStart =
									instrumentPitchEnvelopeStart;
								instrument.envelopes[i].pitchEnvelopeEnd =
									instrumentPitchEnvelopeEnd;
								instrument.envelopes[i].inverse =
									Config.envelopes[instrument.envelopes[i].envelope].name ===
									"pitch"
										? instrumentEnvelopeInverse
										: false;
							}
						}
					}
				}
				break;
			case SongTagCode.operatorWaves:
				{
					const instrument: Instrument =
						song.channels[instrumentChannelIterator].instruments[
							instrumentIndexIterator
						];

					if (beforeThree && fromGoldBox) {
						for (let o: number = 0; o < Config.operatorCount; o++) {
							const pre3To3g = [0, 1, 3, 2, 2, 2, 4, 5];
							const old: number = clamp(
								0,
								pre3To3g.length,
								base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
							);
							if (old === 3) {
								instrument.operators[o].pulseWidth = 5;
							} else if (old === 4) {
								instrument.operators[o].pulseWidth = 4;
							} else if (old === 5) {
								instrument.operators[o].pulseWidth = 6;
							}
							instrument.operators[o].waveform = pre3To3g[old];
						}
					} else {
						for (
							let o: number = 0;
							o <
							(instrument.type === InstrumentType.fm6op ? 6 : Config.operatorCount);
							o++
						) {
							if (fromJummBox) {
								const jummToG = [0, 1, 3, 2, 4, 5];
								instrument.operators[o].waveform =
									jummToG[
										clamp(
											0,
											Config.operatorWaves.length,
											base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
										)
									];
							} else {
								instrument.operators[o].waveform = clamp(
									0,
									Config.operatorWaves.length,
									base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
								);
							}
							// Pulse width follows, if it is a pulse width operator wave
							if (instrument.operators[o].waveform === 2) {
								instrument.operators[o].pulseWidth = clamp(
									0,
									Config.pwmOperatorWaves.length,
									base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
								);
							}
						}
					}
				}
				break;
			case SongTagCode.opl3OperatorAdsr:
				{
					const instrument: Instrument =
						song.channels[instrumentChannelIterator].instruments[
							instrumentIndexIterator
						];
					if (instrument.type === InstrumentType.opl3) {
						for (let o = 0; o < Config.operatorCount; o++) {
							instrument.operators[o].attack = clamp(
								0,
								64,
								base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
							);
							instrument.operators[o].decay = clamp(
								0,
								64,
								base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
							);
							instrument.operators[o].sustain = clamp(
								0,
								64,
								base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
							);
							instrument.operators[o].release = clamp(
								0,
								64,
								base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
							);
						}
					}
				}
				break;
			case SongTagCode.spectrum:
				{
					const instrument: Instrument =
						song.channels[instrumentChannelIterator].instruments[
							instrumentIndexIterator
						];
					if (instrument.type === InstrumentType.spectrum) {
						const byteCount: number = Math.ceil(
							(Config.spectrumControlPoints * Config.spectrumControlPointBits) / 6,
						);
						const bits: BitFieldReader = new BitFieldReader(
							compressed,
							charIndex,
							charIndex + byteCount,
						);
						for (let i: number = 0; i < Config.spectrumControlPoints; i++) {
							instrument.spectrumWave.spectrum[i] = bits.read(
								Config.spectrumControlPointBits,
							);
						}
						instrument.spectrumWave.markCustomWaveDirty();
						charIndex += byteCount;
					} else if (instrument.type === InstrumentType.drumset) {
						const byteCount: number = Math.ceil(
							(Config.drumCount *
								Config.spectrumControlPoints *
								Config.spectrumControlPointBits) /
								6,
						);
						const bits: BitFieldReader = new BitFieldReader(
							compressed,
							charIndex,
							charIndex + byteCount,
						);
						for (let j: number = 0; j < Config.drumCount; j++) {
							for (let i: number = 0; i < Config.spectrumControlPoints; i++) {
								instrument.drumsetSpectrumWaves[j].spectrum[i] = bits.read(
									Config.spectrumControlPointBits,
								);
							}
							instrument.drumsetSpectrumWaves[j].markCustomWaveDirty();
						}
						charIndex += byteCount;
					} else {
						throw new Error("Unhandled instrument type for spectrum song tag code.");
					}
				}
				break;
			case SongTagCode.harmonics:
				{
					const instrument: Instrument =
						song.channels[instrumentChannelIterator].instruments[
							instrumentIndexIterator
						];
					const byteCount: number = Math.ceil(
						(Config.harmonicsControlPoints * Config.harmonicsControlPointBits) / 6,
					);
					const bits: BitFieldReader = new BitFieldReader(
						compressed,
						charIndex,
						charIndex + byteCount,
					);
					for (let i: number = 0; i < Config.harmonicsControlPoints; i++) {
						instrument.harmonicsWave.harmonics[i] = bits.read(
							Config.harmonicsControlPointBits,
						);
					}
					instrument.harmonicsWave.markCustomWaveDirty();
					charIndex += byteCount;
				}
				break;
			case SongTagCode.aliases:
				{
					if ((fromJummBox && beforeFive) || (fromGoldBox && beforeFour)) {
						const instrument: Instrument =
							song.channels[instrumentChannelIterator].instruments[
								instrumentIndexIterator
							];
						instrument.aliases =
							!!base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
						if (instrument.aliases) {
							instrument.distortion = 0;
							instrument.effects |= 1 << EffectType.distortion;
						}
					} else {
						if (fromUltraBox || fromSlarmoosBox || fromJukeBox) {
							const instrument: Instrument =
								song.channels[instrumentChannelIterator].instruments[
									instrumentIndexIterator
								];
							instrument.decimalOffset = clamp(
								0,
								50 + 1,
								base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
							);
						}
					}
				}
				break;
			case SongTagCode.bars:
				{
					let subStringLength: number;
					if (beforeThree && fromBeepBox) {
						const channelIndex: number =
							base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
						const barCount: number =
							base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
						subStringLength = Math.ceil(barCount * 0.5);
						const bits: BitFieldReader = new BitFieldReader(
							compressed,
							charIndex,
							charIndex + subStringLength,
						);
						for (let i: number = 0; i < barCount; i++) {
							song.channels[channelIndex].bars[i] = bits.read(3) + 1;
						}
					} else if (beforeFive && fromBeepBox) {
						let neededBits: number = 0;
						while (1 << neededBits < song.patternsPerChannel) neededBits++;
						subStringLength = Math.ceil(
							(song.getChannelCount() * song.barCount * neededBits) / 6,
						);
						const bits: BitFieldReader = new BitFieldReader(
							compressed,
							charIndex,
							charIndex + subStringLength,
						);
						for (
							let channelIndex: number = 0;
							channelIndex < song.getChannelCount();
							channelIndex++
						) {
							for (let i: number = 0; i < song.barCount; i++) {
								song.channels[channelIndex].bars[i] = bits.read(neededBits) + 1;
							}
						}
					} else {
						let neededBits: number = 0;
						while (1 << neededBits < song.patternsPerChannel + 1) neededBits++;
						subStringLength = Math.ceil(
							(song.getChannelCount() * song.barCount * neededBits) / 6,
						);
						const bits: BitFieldReader = new BitFieldReader(
							compressed,
							charIndex,
							charIndex + subStringLength,
						);
						for (
							let channelIndex: number = 0;
							channelIndex < song.getChannelCount();
							channelIndex++
						) {
							for (let i: number = 0; i < song.barCount; i++) {
								song.channels[channelIndex].bars[i] = bits.read(neededBits);
							}
						}
					}
					charIndex += subStringLength;
				}
				break;
			case SongTagCode.patterns:
				{
					let bitStringLength: number = 0;
					let channelIndex: number;
					const largerChords: boolean = !((beforeFour && fromJummBox) || fromBeepBox);
					const recentPitchBitLength: number = largerChords ? 4 : 3;
					const recentPitchLength: number = largerChords ? 16 : 8;
					if (beforeThree && fromBeepBox) {
						channelIndex = base64CharCodeToInt[compressed.charCodeAt(charIndex++)];

						// The old format used the next character to represent the number of patterns in the channel, which is usually eight, the default.
						charIndex++; // let patternCount: number = base64CharCodeToInt[compressed.charCodeAt(charIndex++)];

						bitStringLength = base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
						bitStringLength = bitStringLength << 6;
						bitStringLength += base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
					} else {
						channelIndex = 0;
						let bitStringLengthLength: number = validateRange(
							1,
							4,
							base64CharCodeToInt[compressed.charCodeAt(charIndex++)],
						);
						while (bitStringLengthLength > 0) {
							bitStringLength = bitStringLength << 6;
							bitStringLength +=
								base64CharCodeToInt[compressed.charCodeAt(charIndex++)];
							bitStringLengthLength--;
						}
					}

					const bits: BitFieldReader = new BitFieldReader(
						compressed,
						charIndex,
						charIndex + bitStringLength,
					);
					charIndex += bitStringLength;

					const bitsPerNoteSize: number = getNeededBits(Config.noteSizeMax);
					let songReverbChannel: number = -1;
					let songReverbInstrument: number = -1;
					let songReverbIndex: number = -1;

					// TODO: Goldbox detecting (ultrabox used the goldbox tag for a bit, sadly making things more complicated)
					const shouldCorrectTempoMods: boolean = fromJummBox;
					const jummboxTempoMin: number = 30;

					while (true) {
						const channel: Channel = song.channels[channelIndex];
						const isNoiseChannel: boolean = song.getChannelIsNoise(channelIndex);
						const isModChannel: boolean = song.getChannelIsMod(channelIndex);

						const maxInstrumentsPerPattern: number =
							song.getMaxInstrumentsPerPattern(channelIndex);
						const neededInstrumentCountBits: number = getNeededBits(
							maxInstrumentsPerPattern - Config.instrumentCountMin,
						);

						const neededInstrumentIndexBits: number = getNeededBits(
							channel.instruments.length - 1,
						);

						// Some info about modulator settings immediately follows in mod channels.
						if (isModChannel) {
							const jumfive: boolean =
								(beforeFive && fromJummBox) || (beforeFour && fromGoldBox);

							// 2 more indices for 'all' and 'active'
							const neededModInstrumentIndexBits: number = jumfive
								? neededInstrumentIndexBits
								: getNeededBits(song.getMaxInstrumentsPerChannel() + 2);

							for (
								let instrumentIndex: number = 0;
								instrumentIndex < channel.instruments.length;
								instrumentIndex++
							) {
								const instrument: Instrument = channel.instruments[instrumentIndex];

								for (let mod: number = 0; mod < Config.modCount; mod++) {
									// Still using legacy "mod status" format, but doing it manually as it's only used in the URL now.
									// 0 - For pitch/noise
									// 1 - (used to be For noise, not needed)
									// 2 - For song
									// 3 - None
									const status: number = bits.read(2);

									switch (status) {
										case 0: {
											const target = repairModTarget(
												bits.read(8),
												bits.read(neededModInstrumentIndexBits),
												song,
											);
											instrument.modChannels[mod] = target.channelIndex;
											instrument.modInstruments[mod] = target.instrumentIndex;
											break;
										}
										case 1: {
											const target = repairModTarget(
												song.pitchChannelCount + bits.read(8),
												bits.read(neededInstrumentIndexBits),
												song,
											);
											instrument.modChannels[mod] = target.channelIndex;
											instrument.modInstruments[mod] = target.instrumentIndex;
											break;
										}
										case 2: {
											// For song
											instrument.modChannels[mod] = -1;
											break;
										}
										case 3: {
											// None
											instrument.modChannels[mod] = -2;
											break;
										}
									}

									// Mod setting is only used if the status isn't "none".
									if (status !== 3) {
										const modulator: number = bits.read(6);
										instrument.modulators[mod] =
											instrument.modChannels[mod] === -2
												? Config.modulators.dictionary.none.index
												: repairModulatorIndex(modulator);
									}

									if (
										!jumfive &&
										(Config.modulators[instrument.modulators[mod]].name ===
											"eq filter" ||
											Config.modulators[instrument.modulators[mod]].name ===
												"note filter" ||
											Config.modulators[instrument.modulators[mod]].name ===
												"song eq")
									) {
										instrument.modFilterTypes[mod] = bits.read(6);
									}

									if (
										Config.modulators[instrument.modulators[mod]].name ===
											"individual envelope speed" ||
										Config.modulators[instrument.modulators[mod]].name ===
											"reset envelope" ||
										Config.modulators[instrument.modulators[mod]].name ===
											"individual envelope lower bound" ||
										Config.modulators[instrument.modulators[mod]].name ===
											"individual envelope upper bound"
									) {
										instrument.modEnvelopeNumbers[mod] = bits.read(6);
									}

									if (jumfive && instrument.modChannels[mod] >= 0) {
										const forNoteFilter: boolean = effectsIncludeNoteFilter(
											song.channels[instrument.modChannels[mod]].instruments[
												instrument.modInstruments[mod]
											].effects,
										);

										// For legacy filter cut/peak, need to denote since scaling must be applied
										if (instrument.modulators[mod] === 7) {
											// Legacy filter cut index
											// Check if there is no filter dot on prospective filter. If so, add a low pass at max possible freq.

											if (forNoteFilter) {
												instrument.modulators[mod] =
													Config.modulators.dictionary[
														"note filt cut"
													].index;
											} else {
												instrument.modulators[mod] =
													Config.modulators.dictionary[
														"eq filt cut"
													].index;
											}

											instrument.modFilterTypes[mod] = 1; // Dot 1 X
										} else if (instrument.modulators[mod] === 8) {
											// Legacy filter peak index
											if (forNoteFilter) {
												instrument.modulators[mod] =
													Config.modulators.dictionary[
														"note filt peak"
													].index;
											} else {
												instrument.modulators[mod] =
													Config.modulators.dictionary[
														"eq filt peak"
													].index;
											}

											instrument.modFilterTypes[mod] = 2; // Dot 1 Y
										}
									} else if (jumfive) {
										// Check for song reverb mod, which must be handled differently now that it is a multiplier
										if (
											instrument.modulators[mod] ===
											Config.modulators.dictionary["song reverb"].index
										) {
											songReverbChannel = channelIndex;
											songReverbInstrument = instrumentIndex;
											songReverbIndex = mod;
										}
									}

									// Based on setting, enable some effects for the modulated instrument. This isn't always set, say if the instrument's pan was right in the center.
									// Only used on import of old songs, because sometimes an invalid effect can be set in a mod in the new version that is actually unused. In that case,
									// keeping the mod invalid is better since it preserves the state.
									if (
										jumfive &&
										Config.modulators[instrument.modulators[mod]]
											.associatedEffect !== EffectType.length
									) {
										song.channels[instrument.modChannels[mod]].instruments[
											instrument.modInstruments[mod]
										].effects |=
											1 <<
											Config.modulators[instrument.modulators[mod]]
												.associatedEffect;
									}
								}
							}
						}

						// Scalar applied to detune mods since its granularity was upped. Could be repurposed later if any other granularity changes occur.
						const detuneScaleNotes: number[][] = [];
						for (let j: number = 0; j < channel.instruments.length; j++) {
							detuneScaleNotes[j] = [];
							for (let i: number = 0; i < Config.modCount; i++) {
								detuneScaleNotes[j][Config.modCount - 1 - i] =
									1 +
									3 *
										+(
											((beforeFive && fromJummBox) ||
												(beforeFour && fromGoldBox)) &&
											isModChannel &&
											channel.instruments[j].modulators[i] ===
												Config.modulators.dictionary.detune.index
										);
							}
						}
						const octaveOffset: number =
							isNoiseChannel || isModChannel ? 0 : channel.octave * 12;
						let lastPitch: number = isNoiseChannel || isModChannel ? 4 : octaveOffset;
						const recentPitches: number[] = isModChannel
							? [0, 1, 2, 3, 4, 5]
							: isNoiseChannel
								? [4, 6, 7, 2, 3, 8, 0, 10]
								: [0, 7, 12, 19, 24, -5, -12];
						const recentShapes: Deque<any> = new Deque<any>();
						for (let i: number = 0; i < recentPitches.length; i++) {
							recentPitches[i] += octaveOffset;
						}
						for (let i: number = 0; i < song.patternsPerChannel; i++) {
							const newPattern: Pattern = channel.patterns[i];

							if (
								(beforeNine && fromBeepBox) ||
								(beforeFive && fromJummBox) ||
								(beforeFour && fromGoldBox)
							) {
								newPattern.instruments[0] = clamp(
									0,
									channel.instruments.length,
									bits.read(neededInstrumentIndexBits),
								);
								newPattern.instruments.length = 1;
							} else {
								if (song.patternInstruments) {
									const instrumentCount: number = validateRange(
										Config.instrumentCountMin,
										maxInstrumentsPerPattern,
										bits.read(neededInstrumentCountBits) +
											Config.instrumentCountMin,
									);
									for (let j: number = 0; j < instrumentCount; j++) {
										newPattern.instruments[j] = clamp(
											0,
											channel.instruments.length + +isModChannel * 2,
											bits.read(neededInstrumentIndexBits),
										);
									}
									newPattern.instruments.length = instrumentCount;
								} else {
									newPattern.instruments[0] = 0;
									newPattern.instruments.length = Config.instrumentCountMin;
								}
							}

							if (!(fromBeepBox && beforeThree) && bits.read(1) === 0) {
								newPattern.notes.length = 0;
								continue;
							}

							let curPart: number = 0;
							const newNotes: Note[] = newPattern.notes;
							let noteCount: number = 0;
							// Due to arbitrary note positioning, mod channels don't end the count until curPart actually exceeds the max
							while (
								curPart <
								song.beatsPerBar * Config.partsPerBeat + +isModChannel
							) {
								const useOldShape: boolean = bits.read(1) === 1;
								let newNote: boolean = false;
								let shapeIndex: number = 0;
								if (useOldShape) {
									const recentShapeCount: number = recentShapes.count();
									if (recentShapeCount === 0) {
										malformed("Pattern shape references unavailable data.");
									}
									shapeIndex = clamp(
										0,
										recentShapeCount,
										bits.readLongTail(0, 0),
									);
								} else {
									newNote = bits.read(1) === 1;
								}

								if (!useOldShape && !newNote) {
									// For mod channels, check if you need to move backward too (notes can appear in any order and offset from each other).
									if (isModChannel) {
										const isBackwards: boolean = bits.read(1) === 1;
										const restLength: number = bits.readPartDuration();
										if (isBackwards) {
											curPart -= restLength;
										} else {
											curPart += restLength;
										}
									} else {
										const restLength: number =
											beforeSeven && fromBeepBox
												? (bits.readLegacyPartDuration() *
														Config.partsPerBeat) /
													Config.rhythms[song.rhythm].stepsPerBeat
												: bits.readPartDuration();
										curPart += restLength;
									}
								} else {
									let shape: any;
									if (useOldShape) {
										shape = recentShapes.get(shapeIndex);
										recentShapes.remove(shapeIndex);
									} else {
										shape = {};

										if (!largerChords) {
											// Old format: X 1's followed by a 0 => X+1 pitches, up to 4
											shape.pitchCount = 1;
											while (shape.pitchCount < 4 && bits.read(1) === 1)
												shape.pitchCount++;
										} else {
											// New format is:
											//      0: 1 pitch
											// 1[XXX]: 3 bits of binary signifying 2+ pitches
											if (bits.read(1) === 1) {
												shape.pitchCount = bits.read(3) + 2;
											} else {
												shape.pitchCount = 1;
											}
										}

										shape.pinCount = bits.readPinCount();
										if (fromBeepBox) {
											shape.initialSize = bits.read(2) * 2;
										} else if (!isModChannel) {
											shape.initialSize = bits.read(bitsPerNoteSize);
										} else if (fromJukeBox && !beforeThree) {
											shape.initialSize = bits.read(11); // mod channels use 11 bits for 2000 tempo now
										} else {
											shape.initialSize = bits.read(9);
										}

										shape.pins = [];
										shape.length = 0;
										shape.bendCount = 0;
										for (let j: number = 0; j < shape.pinCount; j++) {
											const pinObj: any = {};
											pinObj.pitchBend = bits.read(1) === 1;
											if (pinObj.pitchBend) shape.bendCount++;
											shape.length +=
												beforeSeven && fromBeepBox
													? (bits.readLegacyPartDuration() *
															Config.partsPerBeat) /
														Config.rhythms[song.rhythm].stepsPerBeat
													: bits.readPartDuration();
											pinObj.time = shape.length;
											if (fromBeepBox) {
												pinObj.size = bits.read(2) * 2;
											} else if (!isModChannel) {
												pinObj.size = bits.read(bitsPerNoteSize);
											} else if (fromJukeBox && !beforeThree) {
												pinObj.size = bits.read(11); // mod channels use 11 bits for 2000 tempo now
											} else {
												pinObj.size = bits.read(9);
											}
											shape.pins.push(pinObj);
										}
									}
									recentShapes.pushFront(shape);
									if (recentShapes.count() > 10) recentShapes.popBack();

									let note: Note;
									if (newNotes.length <= noteCount) {
										note = new Note(
											0,
											curPart,
											curPart + shape.length,
											shape.initialSize,
										);
										newNotes[noteCount++] = note;
									} else {
										note = newNotes[noteCount++];
										note.start = curPart;
										note.end = curPart + shape.length;
										note.pins[0].size = shape.initialSize;
									}

									let pitch: number;
									let pitchCount: number = 0;
									const pitchBends: Deque<number> = new Deque<number>();
									for (
										let j: number = 0;
										j < shape.pitchCount + shape.bendCount;
										j++
									) {
										const useOldPitch: boolean = bits.read(1) === 1;
										if (!useOldPitch) {
											const interval: number = bits.readPitchInterval();
											pitch = lastPitch;
											let intervalIter: number = interval;
											while (intervalIter > 0) {
												pitch++;
												while (recentPitches.indexOf(pitch) !== -1) pitch++;
												intervalIter--;
											}
											while (intervalIter < 0) {
												pitch--;
												while (recentPitches.indexOf(pitch) !== -1) pitch--;
												intervalIter++;
											}
										} else {
											const pitchIndex: number = clamp(
												0,
												recentPitches.length,
												bits.read(recentPitchBitLength),
											);
											pitch = recentPitches[pitchIndex];
											recentPitches.splice(pitchIndex, 1);
										}

										recentPitches.unshift(pitch);
										if (recentPitches.length > recentPitchLength)
											recentPitches.pop();

										if (j < shape.pitchCount) {
											note.pitches[pitchCount++] = pitch;
										} else {
											pitchBends.pushBack(pitch);
										}

										if (j === shape.pitchCount - 1) {
											lastPitch = note.pitches[0];
										} else {
											lastPitch = pitch;
										}
									}
									note.pitches.length = pitchCount;
									pitchBends.pushFront(note.pitches[0]);
									const noteIsForTempoMod: boolean =
										isModChannel &&
										channel.instruments[newPattern.instruments[0]].modulators[
											Config.modCount - 1 - note.pitches[0]
										] === Config.modulators.dictionary.tempo.index;
									let tempoOffset: number = 0;
									if (shouldCorrectTempoMods && noteIsForTempoMod) {
										tempoOffset = jummboxTempoMin - Config.tempoMin; // convertRealFactor will add back Config.tempoMin as necessary
									}
									if (isModChannel) {
										note.pins[0].size += tempoOffset;
										note.pins[0].size *=
											detuneScaleNotes[newPattern.instruments[0]][
												note.pitches[0]
											];
									}
									let pinCount: number = 1;
									for (const pinObj of shape.pins) {
										if (pinObj.pitchBend) pitchBends.popFront();

										const interval: number =
											pitchBends.peakFront() - note.pitches[0];
										if (note.pins.length <= pinCount) {
											if (isModChannel) {
												note.pins[pinCount++] = makeNotePin(
													interval,
													pinObj.time,
													pinObj.size *
														detuneScaleNotes[newPattern.instruments[0]][
															note.pitches[0]
														] +
														tempoOffset,
												);
											} else {
												note.pins[pinCount++] = makeNotePin(
													interval,
													pinObj.time,
													pinObj.size,
												);
											}
										} else {
											const pin: NotePin = note.pins[pinCount++];
											pin.interval = interval;
											pin.time = pinObj.time;
											if (isModChannel) {
												pin.size =
													pinObj.size *
														detuneScaleNotes[newPattern.instruments[0]][
															note.pitches[0]
														] +
													tempoOffset;
											} else {
												pin.size = pinObj.size;
											}
										}
									}
									note.pins.length = pinCount;

									if (note.start === 0) {
										if (
											!(
												(beforeNine && fromBeepBox) ||
												(beforeFive && fromJummBox) ||
												(beforeFour && fromGoldBox)
											)
										) {
											note.continuesLastPattern = bits.read(1) === 1;
										} else {
											if (
												(beforeFour &&
													!fromUltraBox &&
													!fromSlarmoosBox &&
													!fromJukeBox) ||
												fromBeepBox
											) {
												note.continuesLastPattern = false;
											} else {
												note.continuesLastPattern =
													channel.instruments[
														newPattern.instruments[0]
													].legacyTieOver;
											}
										}
									}

									curPart = clamp(
										0,
										song.beatsPerBar * Config.partsPerBeat + 1,
										note.end,
									);
								}
							}
							newNotes.length = noteCount;
						}

						if (beforeThree && fromBeepBox) {
							break;
						} else {
							channelIndex++;
							if (channelIndex >= song.getChannelCount()) break;
						}
					} // while (true)

					// Correction for old JB songs that had song reverb mods. Change all instruments using reverb to max reverb
					if (
						((fromJummBox && beforeFive) || (beforeFour && fromGoldBox)) &&
						songReverbIndex >= 0
					) {
						for (
							let channelIndex: number = 0;
							channelIndex < song.channels.length;
							channelIndex++
						) {
							for (
								let instrumentIndex: number = 0;
								instrumentIndex < song.channels[channelIndex].instruments.length;
								instrumentIndex++
							) {
								const instrument: Instrument =
									song.channels[channelIndex].instruments[instrumentIndex];
								if (effectsIncludeReverb(instrument.effects)) {
									instrument.reverb = Config.reverbRange - 1;
								}
								// Set song reverb via mod to the old setting at song start.
								if (
									songReverbChannel === channelIndex &&
									songReverbInstrument === instrumentIndex
								) {
									const patternIndex: number =
										song.channels[channelIndex].bars[0];
									if (patternIndex > 0) {
										// Doesn't work if 1st pattern isn't using the right ins for song reverb...
										// Add note to start of pattern
										const pattern: Pattern =
											song.channels[channelIndex].patterns[patternIndex - 1];
										let lowestPart: number = 6;
										for (const note of pattern.notes) {
											if (
												note.pitches[0] ===
												Config.modCount - 1 - songReverbIndex
											) {
												lowestPart = Math.min(lowestPart, note.start);
											}
										}

										if (lowestPart > 0) {
											pattern.notes.push(
												new Note(
													Config.modCount - 1 - songReverbIndex,
													0,
													lowestPart,
													legacyGlobalReverb,
												),
											);
										}
									} else {
										// Add pattern
										if (
											song.channels[channelIndex].patterns.length <
											Config.barCountMax
										) {
											const pattern: Pattern = new Pattern();
											song.channels[channelIndex].patterns.push(pattern);
											song.channels[channelIndex].bars[0] =
												song.channels[channelIndex].patterns.length;
											if (
												song.channels[channelIndex].patterns.length >
												song.patternsPerChannel
											) {
												for (
													let chn: number = 0;
													chn < song.channels.length;
													chn++
												) {
													if (
														song.channels[chn].patterns.length <=
														song.patternsPerChannel
													) {
														song.channels[chn].patterns.push(
															new Pattern(),
														);
													}
												}
												song.patternsPerChannel++;
											}
											pattern.instruments.length = 1;
											pattern.instruments[0] = songReverbInstrument;
											pattern.notes.length = 0;
											pattern.notes.push(
												new Note(
													Config.modCount - 1 - songReverbIndex,
													0,
													6,
													legacyGlobalReverb,
												),
											);
										}
									}
								}
							}
						}
					}
				}
				break;
			case SongTagCode.pluginData:
				{
					const decoded = decodeJsonBlob(compressed, charIndex, "plugin payload");
					charIndex = decoded.nextIndex;
					const instrument: Instrument =
						song.channels[instrumentChannelIterator]?.instruments[
							instrumentIndexIterator
						];
					const plugin = instrument == null ? undefined : getPlugin(instrument.type);
					if (instrument == null) {
						malformed("Plugin payload has no matching instrument.");
					}
					const pluginInstrument = instrument as Instrument & {
						_opaquePluginPayload?: Record<string, unknown>;
						_opaquePluginDecodeFailed?: boolean;
					};
					pluginInstrument._opaquePluginPayload = decoded.value;
					if (plugin?.deserialize == null) break;
					try {
						plugin.deserialize(instrument, decoded.value);
					} catch {
						pluginInstrument._opaquePluginDecodeFailed = true;
					}
				}
				break;
			case SongTagCode.socketPayload:
				{
					const decoded = decodeJsonBlob(compressed, charIndex, "socket payload");
					charIndex = decoded.nextIndex;
					const payload = decoded.value;
					if (
						typeof payload.id !== "string" ||
						payload.id.length === 0 ||
						(payload.version !== undefined &&
							(!Number.isSafeInteger(payload.version) ||
								(payload.version as number) < 0)) ||
						(payload.params !== undefined &&
							(typeof payload.params !== "object" ||
								payload.params == null ||
								Array.isArray(payload.params)))
					) {
						malformed("Invalid socket payload structure.");
					}
					const instrument: Instrument =
						song.channels[instrumentChannelIterator]?.instruments[
							instrumentIndexIterator
						];
					if (instrument == null) malformed("Socket payload has no matching instrument.");
					const socketInstrument = instrument as Instrument & {
						_socketModuleId?: string;
						_opaqueSocketPayload?: Record<string, unknown>;
						_opaqueSocketHydrated?: boolean;
						_opaqueSocketHydrationFailed?: boolean;
					};
					socketInstrument._socketModuleId = payload.id;
					const mod = getInstrument(payload.id);
					if (mod === undefined) {
						socketInstrument._opaqueSocketPayload = payload;
						break;
					}
					if (payload.params !== undefined) {
						try {
							const r = new JsonFieldReader(
								payload.params as Record<string, unknown>,
							);
							const deserialized = mod.deserialize(
								r,
								typeof payload.version === "number" ? payload.version : 1,
							);
							const instrumentFields = instrument as unknown as Record<
								string,
								unknown
							>;
							for (const [key, value] of Object.entries(deserialized)) {
								instrumentFields[key] = value;
							}
							socketInstrument._opaqueSocketPayload = payload;
							socketInstrument._opaqueSocketHydrated = true;
						} catch {
							socketInstrument._opaqueSocketPayload = payload;
							socketInstrument._opaqueSocketHydrated = true;
							socketInstrument._opaqueSocketHydrationFailed = true;
						}
					}
				}
				break;
			default:
				throw new SongDataError("Unknown song data tag.");
		}
	}

	if (!song.customSampleHandler?.deferSampleLoading && Config.willReloadForCustomSamples) {
		window.sessionStorage.setItem("resetBarOnLoad", "1");
		window.location.hash = song.toBase64String();
		setTimeout(() => {
			location.reload();
		}, 50);
	}
}
