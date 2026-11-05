// synth-serialize.ts
//
// Purpose: URL hash encoding for songs (toBase64StringImpl)
//
// This module:
// - Encodes a SongLike to a base64 URL hash string
// - Packs instrument, pattern, envelope, and effect data into a bit stream
// - Extracted from song-serialization.ts

import type { Channel } from "./channels";
import type { FilterControlPoint } from "./instruments";
import { Instrument } from "./instruments";
import { NotePin } from "./notes";
import { getPlugin } from "./plugins";
import {
	BitFieldWriter,
	base64IntToCharCode,
	encode32BitNumber,
	encodeUnisonSettings,
	SongTagCode,
} from "./serialization";
import { JsonFieldWriter } from "./socket/json-serde-adapter";
import {
	hydrateOpaqueSocketInstrument,
	type OpaqueSocketInstrument,
} from "./socket/opaque-instrument";
import type { SongLike } from "./song-serialization";
import { getNeededBits, LATEST_JUKEBOX_VERSION } from "./song-serialization";
import {
	ENV_LFO,
	ENV_NONE,
	ENV_NOTESIZE,
	ENV_PITCH,
	ENV_PUNCH,
	ENV_RANDOM,
	VARIANT,
} from "./song-serialization-shared";
import {
	Config,
	effectsIncludeBitcrusher,
	effectsIncludeChord,
	effectsIncludeChorus,
	effectsIncludeCombFlanger,
	effectsIncludeCompressor,
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
	InstrumentType,
	LFOEnvelopeTypes,
	SustainType,
} from "./synth-config";
import { clamp, validateRange } from "./util";

export function toBase64StringImpl(song: SongLike): string {
	let bits: BitFieldWriter;
	const buffer: number[] = [];

	buffer.push(VARIANT);
	buffer.push(base64IntToCharCode[LATEST_JUKEBOX_VERSION]);

	// Length of the song name string
	buffer.push(SongTagCode.songTitle);
	const encodedSongTitle: string = encodeURIComponent(song.title);
	buffer.push(
		base64IntToCharCode[encodedSongTitle.length >> 6],
		base64IntToCharCode[encodedSongTitle.length & 0x3f],
	);

	// Actual encoded string follows
	for (let i: number = 0; i < encodedSongTitle.length; i++) {
		buffer.push(encodedSongTitle.charCodeAt(i));
	}

	buffer.push(SongTagCode.octaveCount, base64IntToCharCode[song.octaveCount]);
	buffer.push(
		SongTagCode.channelCount,
		base64IntToCharCode[song.pitchChannelCount],
		base64IntToCharCode[song.noiseChannelCount],
		base64IntToCharCode[song.modChannelCount],
	);
	buffer.push(SongTagCode.scale, base64IntToCharCode[song.scale]);
	if (song.scale === Config.scales.dictionary.Custom.index) {
		for (let i = 1; i < Config.pitchesPerOctave; i++) {
			buffer.push(base64IntToCharCode[song.scaleCustom[i] ? 1 : 0]); // ineffiecent? yes, but this is all that's needed for now
		}
	}
	buffer.push(
		SongTagCode.key,
		base64IntToCharCode[song.key],
		base64IntToCharCode[song.octave - Config.octaveMin],
	);
	buffer.push(
		SongTagCode.loopStart,
		base64IntToCharCode[song.loopStart >> 6],
		base64IntToCharCode[song.loopStart & 0x3f],
	);
	buffer.push(
		SongTagCode.loopEnd,
		base64IntToCharCode[(song.loopLength - 1) >> 6],
		base64IntToCharCode[(song.loopLength - 1) & 0x3f],
	);
	buffer.push(
		SongTagCode.tempo,
		base64IntToCharCode[song.tempo >> 6],
		base64IntToCharCode[song.tempo & 0x3f],
	);
	buffer.push(SongTagCode.beatCount, base64IntToCharCode[song.beatsPerBar - 1]);
	buffer.push(
		SongTagCode.barCount,
		base64IntToCharCode[(song.barCount - 1) >> 6],
		base64IntToCharCode[(song.barCount - 1) & 0x3f],
	);
	buffer.push(
		SongTagCode.patternCount,
		base64IntToCharCode[(song.patternsPerChannel - 1) >> 6],
		base64IntToCharCode[(song.patternsPerChannel - 1) & 0x3f],
	);
	buffer.push(SongTagCode.rhythm, base64IntToCharCode[song.rhythm]);

	// Push limiter settings, but only if they aren't the default!
	buffer.push(SongTagCode.limiterSettings);
	if (
		song.compressionRatio !== 1.0 ||
		song.limitRatio !== 1.0 ||
		song.limitRise !== 4000.0 ||
		song.limitDecay !== 4.0 ||
		song.limitThreshold !== 1.0 ||
		song.compressionThreshold !== 1.0 ||
		song.masterGain !== 1.0
	) {
		buffer.push(
			base64IntToCharCode[
				Math.round(
					song.compressionRatio < 1
						? song.compressionRatio * 10
						: 10 + (song.compressionRatio - 1) * 60,
				)
			],
		); // 0 ~ 1.15 uneven, mapped to 0 ~ 20
		buffer.push(
			base64IntToCharCode[
				Math.round(song.limitRatio < 1 ? song.limitRatio * 10 : 9 + song.limitRatio)
			],
		); // 0 ~ 10 uneven, mapped to 0 ~ 20
		buffer.push(base64IntToCharCode[song.limitDecay]); // directly 1 ~ 30
		buffer.push(base64IntToCharCode[Math.round((song.limitRise - 2000.0) / 250.0)]); // 2000 ~ 10000 by 250, mapped to 0 ~ 32
		buffer.push(base64IntToCharCode[Math.round(song.compressionThreshold * 20)]); // 0 ~ 1.1 by 0.05, mapped to 0 ~ 22
		buffer.push(base64IntToCharCode[Math.round(song.limitThreshold * 20)]); // 0 ~ 2 by 0.05, mapped to 0 ~ 40
		buffer.push(
			base64IntToCharCode[Math.round(song.masterGain * 50) >> 6],
			base64IntToCharCode[Math.round(song.masterGain * 50) & 0x3f],
		); // 0 ~ 5 by 0.02, mapped to 0 ~ 250
	} else {
		buffer.push(base64IntToCharCode[0x3f]); // Not using limiter
	}

	// songeq
	buffer.push(SongTagCode.songEq);
	if (song.eqFilter == null) {
		// Push null filter settings
		buffer.push(base64IntToCharCode[0]);
		console.log("Null EQ filter settings detected in toBase64String for song");
	} else {
		buffer.push(base64IntToCharCode[song.eqFilter.controlPointCount]);
		for (let j: number = 0; j < song.eqFilter.controlPointCount; j++) {
			const point: FilterControlPoint = song.eqFilter.controlPoints[j];
			buffer.push(
				base64IntToCharCode[point.type],
				base64IntToCharCode[Math.round(point.freq)],
				base64IntToCharCode[Math.round(point.gain)],
			);
		}
	}

	// Push subfilters as well. Skip Index 0, is a copy of the base filter.
	let usingSubFilterBitfield: number = 0;
	for (let j: number = 0; j < Config.filterMorphCount - 1; j++) {
		usingSubFilterBitfield |= +(song.eqSubFilters[j + 1] != null) << j;
	}
	// Put subfilter usage into 2 chars (12 bits)
	buffer.push(
		base64IntToCharCode[usingSubFilterBitfield >> 6],
		base64IntToCharCode[usingSubFilterBitfield & 63],
	);
	// Put subfilter info in for all used subfilters
	for (let j: number = 0; j < Config.filterMorphCount - 1; j++) {
		if (usingSubFilterBitfield & (1 << j)) {
			buffer.push(base64IntToCharCode[song.eqSubFilters[j + 1]!.controlPointCount]);
			for (let k: number = 0; k < song.eqSubFilters[j + 1]!.controlPointCount; k++) {
				const point: FilterControlPoint = song.eqSubFilters[j + 1]!.controlPoints[k];
				buffer.push(
					base64IntToCharCode[point.type],
					base64IntToCharCode[Math.round(point.freq)],
					base64IntToCharCode[Math.round(point.gain)],
				);
			}
		}
	}

	buffer.push(SongTagCode.channelNames);
	for (let channel: number = 0; channel < song.getChannelCount(); channel++) {
		// Length of the channel name string
		const encodedChannelName: string = encodeURIComponent(song.channels[channel].name);
		buffer.push(
			base64IntToCharCode[encodedChannelName.length >> 6],
			base64IntToCharCode[encodedChannelName.length & 0x3f],
		);

		// Actual encoded string follows
		for (let i: number = 0; i < encodedChannelName.length; i++) {
			buffer.push(encodedChannelName.charCodeAt(i));
		}
	}

	buffer.push(
		SongTagCode.instrumentCount,
		// biome-ignore lint/suspicious/noExplicitAny: boolean-to-bit coercion
		base64IntToCharCode[((<any>song.layeredInstruments) << 1) | <any>song.patternInstruments],
	);
	if (song.layeredInstruments || song.patternInstruments) {
		for (let channelIndex: number = 0; channelIndex < song.getChannelCount(); channelIndex++) {
			buffer.push(
				base64IntToCharCode[
					song.channels[channelIndex].instruments.length - Config.instrumentCountMin
				],
			);
		}
	}

	buffer.push(SongTagCode.channelOctave);
	for (let channelIndex: number = 0; channelIndex < song.pitchChannelCount; channelIndex++) {
		buffer.push(base64IntToCharCode[song.channels[channelIndex].octave]);
	}

	// This is for specific instrument stuff to url
	for (let channelIndex: number = 0; channelIndex < song.getChannelCount(); channelIndex++) {
		for (let i: number = 0; i < song.channels[channelIndex].instruments.length; i++) {
			const instrument: Instrument = song.channels[channelIndex].instruments[i];
			buffer.push(SongTagCode.startInstrument, base64IntToCharCode[instrument.type]);
			buffer.push(
				SongTagCode.volume,
				base64IntToCharCode[(instrument.volume + Config.volumeRange / 2) >> 6],
				base64IntToCharCode[(instrument.volume + Config.volumeRange / 2) & 0x3f],
			);
			buffer.push(
				SongTagCode.preset,
				base64IntToCharCode[instrument.preset >> 18],
				base64IntToCharCode[(instrument.preset >> 12) & 63],
				base64IntToCharCode[(instrument.preset >> 6) & 63],
				base64IntToCharCode[instrument.preset & 63],
			);

			buffer.push(SongTagCode.eqFilter);
			buffer.push(base64IntToCharCode[+instrument.eqFilterType]);
			if (instrument.eqFilterType) {
				buffer.push(base64IntToCharCode[instrument.eqFilterSimpleCut]);
				buffer.push(base64IntToCharCode[instrument.eqFilterSimplePeak]);
			} else {
				if (instrument.eqFilter == null) {
					// Push null filter settings
					buffer.push(base64IntToCharCode[0]);
					console.log(
						`Null EQ filter settings detected in toBase64String for channelIndex ${channelIndex}, instrumentIndex ${i}`,
					);
				} else {
					buffer.push(base64IntToCharCode[instrument.eqFilter.controlPointCount]);
					for (let j: number = 0; j < instrument.eqFilter.controlPointCount; j++) {
						const point: FilterControlPoint = instrument.eqFilter.controlPoints[j];
						buffer.push(
							base64IntToCharCode[point.type],
							base64IntToCharCode[Math.round(point.freq)],
							base64IntToCharCode[Math.round(point.gain)],
						);
					}
				}

				// Push subfilters as well. Skip Index 0, is a copy of the base filter.
				let usingSubFilterBitfield: number = 0;
				for (let j: number = 0; j < Config.filterMorphCount - 1; j++) {
					usingSubFilterBitfield |= +(instrument.eqSubFilters[j + 1] != null) << j;
				}
				// Put subfilter usage into 2 chars (12 bits)
				buffer.push(
					base64IntToCharCode[usingSubFilterBitfield >> 6],
					base64IntToCharCode[usingSubFilterBitfield & 63],
				);
				// Put subfilter info in for all used subfilters
				for (let j: number = 0; j < Config.filterMorphCount - 1; j++) {
					if (usingSubFilterBitfield & (1 << j)) {
						buffer.push(
							base64IntToCharCode[instrument.eqSubFilters[j + 1]!.controlPointCount],
						);
						for (
							let k: number = 0;
							k < instrument.eqSubFilters[j + 1]!.controlPointCount;
							k++
						) {
							const point: FilterControlPoint =
								instrument.eqSubFilters[j + 1]!.controlPoints[k];
							buffer.push(
								base64IntToCharCode[point.type],
								base64IntToCharCode[Math.round(point.freq)],
								base64IntToCharCode[Math.round(point.gain)],
							);
						}
					}
				}
			}

			// The list of enabled effects is represented as a 14-bit bitfield using two six-bit characters.
			buffer.push(
				SongTagCode.effects,
				base64IntToCharCode[(instrument.effects >> 12) & 63],
				base64IntToCharCode[(instrument.effects >> 6) & 63],
				base64IntToCharCode[instrument.effects & 63],
			);
			if (effectsIncludeNoteFilter(instrument.effects)) {
				buffer.push(base64IntToCharCode[+instrument.noteFilterType]);
				if (instrument.noteFilterType) {
					buffer.push(base64IntToCharCode[instrument.noteFilterSimpleCut]);
					buffer.push(base64IntToCharCode[instrument.noteFilterSimplePeak]);
				} else {
					if (instrument.noteFilter == null) {
						// Push null filter settings
						buffer.push(base64IntToCharCode[0]);
						console.log(
							`Null note filter settings detected in toBase64String for channelIndex ${channelIndex}, instrumentIndex ${i}`,
						);
					} else {
						buffer.push(base64IntToCharCode[instrument.noteFilter.controlPointCount]);
						for (let j: number = 0; j < instrument.noteFilter.controlPointCount; j++) {
							const point: FilterControlPoint =
								instrument.noteFilter.controlPoints[j];
							buffer.push(
								base64IntToCharCode[point.type],
								base64IntToCharCode[Math.round(point.freq)],
								base64IntToCharCode[Math.round(point.gain)],
							);
						}
					}

					// Push subfilters as well. Skip Index 0, is a copy of the base filter.
					let usingSubFilterBitfield: number = 0;
					for (let j: number = 0; j < Config.filterMorphCount - 1; j++) {
						usingSubFilterBitfield |= +(instrument.noteSubFilters[j + 1] != null) << j;
					}
					// Put subfilter usage into 2 chars (12 bits)
					buffer.push(
						base64IntToCharCode[usingSubFilterBitfield >> 6],
						base64IntToCharCode[usingSubFilterBitfield & 63],
					);
					// Put subfilter info in for all used subfilters
					for (let j: number = 0; j < Config.filterMorphCount - 1; j++) {
						if (usingSubFilterBitfield & (1 << j)) {
							buffer.push(
								base64IntToCharCode[
									instrument.noteSubFilters[j + 1]!.controlPointCount
								],
							);
							for (
								let k: number = 0;
								k < instrument.noteSubFilters[j + 1]!.controlPointCount;
								k++
							) {
								const point: FilterControlPoint =
									instrument.noteSubFilters[j + 1]!.controlPoints[k];
								buffer.push(
									base64IntToCharCode[point.type],
									base64IntToCharCode[Math.round(point.freq)],
									base64IntToCharCode[Math.round(point.gain)],
								);
							}
						}
					}
				}
			}
			if (effectsIncludeTransition(instrument.effects)) {
				buffer.push(base64IntToCharCode[instrument.transition]);
			}
			if (effectsIncludeChord(instrument.effects)) {
				buffer.push(base64IntToCharCode[instrument.chord]);
				// Custom arpeggio speed... only if the instrument arpeggiates.
				if (instrument.chord === Config.chords.dictionary.arpeggio.index) {
					buffer.push(base64IntToCharCode[instrument.arpeggioSpeed]);
					buffer.push(base64IntToCharCode[+instrument.fastTwoNoteArp]); // Two note arp setting piggybacks on this
				}
				if (instrument.chord === Config.chords.dictionary.monophonic.index) {
					buffer.push(base64IntToCharCode[instrument.monoChordTone]); // which note is selected
				}
			}
			if (effectsIncludePitchShift(instrument.effects)) {
				buffer.push(base64IntToCharCode[instrument.pitchShift]);
			}
			if (effectsIncludeDetune(instrument.effects)) {
				buffer.push(
					base64IntToCharCode[(instrument.detune - Config.detuneMin) >> 6],
					base64IntToCharCode[(instrument.detune - Config.detuneMin) & 0x3f],
				);
			}
			if (effectsIncludeVibrato(instrument.effects)) {
				buffer.push(base64IntToCharCode[instrument.vibrato]);
				// Custom vibrato settings
				if (instrument.vibrato === Config.vibratos.length) {
					buffer.push(base64IntToCharCode[Math.round(instrument.vibratoDepth * 25)]);
					buffer.push(base64IntToCharCode[instrument.vibratoSpeed]);
					buffer.push(base64IntToCharCode[Math.round(instrument.vibratoDelay)]);
					buffer.push(base64IntToCharCode[instrument.vibratoType]);
				}
			}
			if (effectsIncludeDistortion(instrument.effects)) {
				buffer.push(base64IntToCharCode[instrument.distortion]);
				// Aliasing is tied into distortion for now
				buffer.push(base64IntToCharCode[+instrument.aliases]);
			}
			if (effectsIncludeBitcrusher(instrument.effects)) {
				buffer.push(
					base64IntToCharCode[instrument.bitcrusherFreq],
					base64IntToCharCode[instrument.bitcrusherQuantization],
				);
			}
			if (effectsIncludePanning(instrument.effects)) {
				buffer.push(
					base64IntToCharCode[instrument.pan >> 6],
					base64IntToCharCode[instrument.pan & 0x3f],
				);
				buffer.push(base64IntToCharCode[instrument.panDelay]);
			}
			if (effectsIncludeChorus(instrument.effects)) {
				buffer.push(base64IntToCharCode[instrument.chorus]);
			}
			if (effectsIncludeEcho(instrument.effects)) {
				buffer.push(
					base64IntToCharCode[instrument.echoSustain],
					base64IntToCharCode[instrument.echoDelay],
				);
			}
			if (effectsIncludeReverb(instrument.effects)) {
				buffer.push(base64IntToCharCode[instrument.reverb]);
			}
			if (effectsIncludeGranular(instrument.effects)) {
				buffer.push(base64IntToCharCode[instrument.granular]);
				buffer.push(base64IntToCharCode[instrument.grainSize]);
				buffer.push(base64IntToCharCode[instrument.grainAmounts]);
				buffer.push(base64IntToCharCode[instrument.grainRange]);
			}
			if (effectsIncludeRingModulation(instrument.effects)) {
				buffer.push(base64IntToCharCode[instrument.ringModulation]);
				buffer.push(base64IntToCharCode[instrument.ringModulationHz]);
				buffer.push(base64IntToCharCode[instrument.ringModWaveformIndex]);
				buffer.push(base64IntToCharCode[instrument.ringModPulseWidth]);
				buffer.push(
					base64IntToCharCode[(instrument.ringModHzOffset - Config.rmHzOffsetMin) >> 6],
					base64IntToCharCode[(instrument.ringModHzOffset - Config.rmHzOffsetMin) & 0x3f],
				);
			}

			if (effectsIncludePhaser(instrument.effects)) {
				buffer.push(base64IntToCharCode[instrument.phaserFreq]);
				buffer.push(base64IntToCharCode[instrument.phaserFeedback]);
				buffer.push(base64IntToCharCode[instrument.phaserStages]);
				buffer.push(base64IntToCharCode[instrument.phaserMix]);
			}

			if (effectsIncludeInvertWave(instrument.effects)) {
				buffer.push(base64IntToCharCode[+instrument.invertWave]);
			}
			if (effectsIncludeNoteRange(instrument.effects)) {
				buffer.push(
					base64IntToCharCode[instrument.upperNoteLimit >> 6],
					base64IntToCharCode[instrument.upperNoteLimit & 0x3f],
				);
				buffer.push(
					base64IntToCharCode[instrument.lowerNoteLimit >> 6],
					base64IntToCharCode[instrument.lowerNoteLimit & 0x3f],
				);
			}

			if (effectsIncludeCompressor(instrument.effects)) {
				buffer.push(
					SongTagCode.compressor,
					base64IntToCharCode[instrument.compressorThreshold],
					base64IntToCharCode[instrument.compressorRatio],
					base64IntToCharCode[instrument.compressorAttack],
					base64IntToCharCode[instrument.compressorRelease],
					base64IntToCharCode[instrument.compressorSync],
				);
			}

			if (effectsIncludeCombFlanger(instrument.effects)) {
				buffer.push(
					SongTagCode.combFlanger,
					base64IntToCharCode[instrument.combDelay],
					base64IntToCharCode[instrument.combFeedback],
					base64IntToCharCode[instrument.combMix],
					base64IntToCharCode[instrument.combRate],
					base64IntToCharCode[instrument.combDepth],
				);
			}

			if (instrument.type !== InstrumentType.drumset) {
				buffer.push(
					SongTagCode.fadeInOut,
					base64IntToCharCode[instrument.fadeIn],
					base64IntToCharCode[instrument.fadeOut],
				);
				// Transition info follows transition song tag
				buffer.push(base64IntToCharCode[+instrument.clicklessTransition]);
			}

			if (
				instrument.type === InstrumentType.harmonics ||
				instrument.type === InstrumentType.pickedString
			) {
				buffer.push(SongTagCode.harmonics);
				const harmonicsBits: BitFieldWriter = new BitFieldWriter();
				for (let i: number = 0; i < Config.harmonicsControlPoints; i++) {
					harmonicsBits.write(
						Config.harmonicsControlPointBits,
						instrument.harmonicsWave.harmonics[i],
					);
				}
				harmonicsBits.encodeBase64(buffer);
			}

			if (instrument.type === InstrumentType.chip) {
				if (instrument.chipWave > 186) {
					buffer.push(119, base64IntToCharCode[instrument.chipWave - 186]);
					buffer.push(base64IntToCharCode[3]);
				} else if (instrument.chipWave > 124) {
					buffer.push(119, base64IntToCharCode[instrument.chipWave - 124]);
					buffer.push(base64IntToCharCode[2]);
				} else if (instrument.chipWave > 62) {
					buffer.push(119, base64IntToCharCode[instrument.chipWave - 62]);
					buffer.push(base64IntToCharCode[1]);
				} else {
					buffer.push(119, base64IntToCharCode[instrument.chipWave]);
					buffer.push(base64IntToCharCode[0]);
				}
				buffer.push(104, base64IntToCharCode[instrument.unison]);
				if (instrument.unison === Config.unisons.length) {
					encodeUnisonSettings(
						buffer,
						instrument.unisonVoices,
						instrument.unisonSpread,
						instrument.unisonOffset,
						instrument.unisonExpression,
						instrument.unisonSign,
					);
				}

				// Repurposed for chip wave loop controls.
				buffer.push(SongTagCode.loopControls);
				// The encoding here is as follows:
				// 0b11111_1
				//         ^-- isUsingAdvancedLoopControls
				//   ^^^^^---- chipWaveLoopMode
				// This essentially allocates 32 different loop modes,
				// which should be plenty.
				const encodedLoopMode: number =
					(clamp(0, 31 + 1, instrument.chipWaveLoopMode) << 1) |
					(instrument.isUsingAdvancedLoopControls ? 1 : 0);
				buffer.push(base64IntToCharCode[encodedLoopMode]);
				// The same encoding above is used here, but with the release mode
				// (which isn't implemented currently), and the backwards toggle.
				const encodedReleaseMode: number =
					(clamp(0, 31 + 1, 0) << 1) | (instrument.chipWavePlayBackwards ? 1 : 0);
				buffer.push(base64IntToCharCode[encodedReleaseMode]);
				encode32BitNumber(buffer, instrument.chipWaveLoopStart);
				encode32BitNumber(buffer, instrument.chipWaveLoopEnd);
				encode32BitNumber(buffer, instrument.chipWaveStartOffset);
			} else if (
				instrument.type === InstrumentType.fm ||
				instrument.type === InstrumentType.fm6op ||
				instrument.type === InstrumentType.opl3
			) {
				if (instrument.type === InstrumentType.fm) {
					buffer.push(SongTagCode.algorithm, base64IntToCharCode[instrument.algorithm]);
					buffer.push(
						SongTagCode.feedbackType,
						base64IntToCharCode[instrument.feedbackType],
					);
				} else if (instrument.type === InstrumentType.opl3) {
					buffer.push(
						SongTagCode.algorithm,
						base64IntToCharCode[instrument.opl3Algorithm],
					);
					buffer.push(
						SongTagCode.feedbackAmplitude,
						base64IntToCharCode[instrument.feedbackAmplitude],
					);
				} else {
					buffer.push(
						SongTagCode.algorithm,
						base64IntToCharCode[instrument.algorithm6Op],
					);
					if (instrument.algorithm6Op === 0) {
						buffer.push(
							SongTagCode.chord,
							base64IntToCharCode[instrument.customAlgorithm.carrierCount],
						);
						buffer.push(SongTagCode.effects);
						for (
							let o: number = 0;
							o < instrument.customAlgorithm.modulatedBy.length;
							o++
						) {
							for (
								let j: number = 0;
								j < instrument.customAlgorithm.modulatedBy[o].length;
								j++
							) {
								buffer.push(
									base64IntToCharCode[
										instrument.customAlgorithm.modulatedBy[o][j]
									],
								);
							}
							buffer.push(SongTagCode.operatorWaves);
						}
						buffer.push(SongTagCode.effects);
					}
					buffer.push(
						SongTagCode.feedbackType,
						base64IntToCharCode[instrument.feedbackType6Op],
					);
					if (instrument.feedbackType6Op === 0) {
						buffer.push(SongTagCode.effects);
						for (
							let o: number = 0;
							o < instrument.customFeedbackType.indices.length;
							o++
						) {
							for (
								let j: number = 0;
								j < instrument.customFeedbackType.indices[o].length;
								j++
							) {
								buffer.push(
									base64IntToCharCode[
										instrument.customFeedbackType.indices[o][j]
									],
								);
							}
							buffer.push(SongTagCode.operatorWaves);
						}
						buffer.push(SongTagCode.effects);
					}
				}
				buffer.push(
					SongTagCode.feedbackAmplitude,
					base64IntToCharCode[instrument.feedbackAmplitude],
				);

				buffer.push(SongTagCode.operatorFrequencies);
				for (
					let o: number = 0;
					o < (instrument.type === InstrumentType.fm6op ? 6 : Config.operatorCount);
					o++
				) {
					buffer.push(base64IntToCharCode[instrument.operators[o].frequency]);
				}
				buffer.push(SongTagCode.operatorAmplitudes);
				for (
					let o: number = 0;
					o < (instrument.type === InstrumentType.fm6op ? 6 : Config.operatorCount);
					o++
				) {
					buffer.push(base64IntToCharCode[instrument.operators[o].amplitude]);
				}
				buffer.push(SongTagCode.operatorWaves);
				for (
					let o: number = 0;
					o < (instrument.type === InstrumentType.fm6op ? 6 : Config.operatorCount);
					o++
				) {
					buffer.push(base64IntToCharCode[instrument.operators[o].waveform]);
					// Push pulse width if that type is used
					if (instrument.operators[o].waveform === 2) {
						buffer.push(base64IntToCharCode[instrument.operators[o].pulseWidth]);
					}
				}
				if (instrument.type === InstrumentType.opl3) {
					// Serialize per-operator ADSR: attack, decay, sustain, release for 4 operators
					buffer.push(SongTagCode.opl3OperatorAdsr);
					for (let o = 0; o < Config.operatorCount; o++) {
						buffer.push(
							base64IntToCharCode[
								Math.max(0, Math.min(63, instrument.operators[o].attack))
							],
						);
						buffer.push(
							base64IntToCharCode[
								Math.max(0, Math.min(63, instrument.operators[o].decay))
							],
						);
						buffer.push(
							base64IntToCharCode[
								Math.max(0, Math.min(63, instrument.operators[o].sustain))
							],
						);
						buffer.push(
							base64IntToCharCode[
								Math.max(0, Math.min(63, instrument.operators[o].release))
							],
						);
					}
				}
			} else if (instrument.type === InstrumentType.customChipWave) {
				if (instrument.chipWave > 186) {
					buffer.push(119, base64IntToCharCode[instrument.chipWave - 186]);
					buffer.push(base64IntToCharCode[3]);
				} else if (instrument.chipWave > 124) {
					buffer.push(119, base64IntToCharCode[instrument.chipWave - 124]);
					buffer.push(base64IntToCharCode[2]);
				} else if (instrument.chipWave > 62) {
					buffer.push(119, base64IntToCharCode[instrument.chipWave - 62]);
					buffer.push(base64IntToCharCode[1]);
				} else {
					buffer.push(119, base64IntToCharCode[instrument.chipWave]);
					buffer.push(base64IntToCharCode[0]);
				}
				buffer.push(104, base64IntToCharCode[instrument.unison]);
				if (instrument.unison === Config.unisons.length) {
					encodeUnisonSettings(
						buffer,
						instrument.unisonVoices,
						instrument.unisonSpread,
						instrument.unisonOffset,
						instrument.unisonExpression,
						instrument.unisonSign,
					);
				}
				buffer.push(SongTagCode.customChipWave);
				// Push custom wave values
				for (let j: number = 0; j < 64; j++) {
					buffer.push(base64IntToCharCode[instrument.customChipWave[j] + 24]);
				}
			} else if (instrument.type === InstrumentType.noise) {
				buffer.push(SongTagCode.wave, base64IntToCharCode[instrument.chipNoise]);
				buffer.push(SongTagCode.unison, base64IntToCharCode[instrument.unison]);
				if (instrument.unison === Config.unisons.length) {
					encodeUnisonSettings(
						buffer,
						instrument.unisonVoices,
						instrument.unisonSpread,
						instrument.unisonOffset,
						instrument.unisonExpression,
						instrument.unisonSign,
					);
				}
			} else if (instrument.type === InstrumentType.spectrum) {
				buffer.push(SongTagCode.spectrum);
				const spectrumBits: BitFieldWriter = new BitFieldWriter();
				for (let i: number = 0; i < Config.spectrumControlPoints; i++) {
					spectrumBits.write(
						Config.spectrumControlPointBits,
						instrument.spectrumWave.spectrum[i],
					);
				}
				spectrumBits.encodeBase64(buffer);
				buffer.push(SongTagCode.unison, base64IntToCharCode[instrument.unison]);
				if (instrument.unison === Config.unisons.length) {
					encodeUnisonSettings(
						buffer,
						instrument.unisonVoices,
						instrument.unisonSpread,
						instrument.unisonOffset,
						instrument.unisonExpression,
						instrument.unisonSign,
					);
				}
			} else if (instrument.type === InstrumentType.drumset) {
				buffer.push(SongTagCode.drumsetEnvelopes);
				for (let j: number = 0; j < Config.drumCount; j++) {
					buffer.push(base64IntToCharCode[instrument.drumsetEnvelopes[j]]);
				}

				buffer.push(SongTagCode.spectrum);
				const spectrumBits: BitFieldWriter = new BitFieldWriter();
				for (let j: number = 0; j < Config.drumCount; j++) {
					for (let i: number = 0; i < Config.spectrumControlPoints; i++) {
						spectrumBits.write(
							Config.spectrumControlPointBits,
							instrument.drumsetSpectrumWaves[j].spectrum[i],
						);
					}
				}
				spectrumBits.encodeBase64(buffer);
				buffer.push(SongTagCode.unison, base64IntToCharCode[instrument.unison]);
				if (instrument.unison === Config.unisons.length) {
					encodeUnisonSettings(
						buffer,
						instrument.unisonVoices,
						instrument.unisonSpread,
						instrument.unisonOffset,
						instrument.unisonExpression,
						instrument.unisonSign,
					);
				}
			} else if (instrument.type === InstrumentType.harmonics) {
				buffer.push(SongTagCode.unison, base64IntToCharCode[instrument.unison]);
				if (instrument.unison === Config.unisons.length) {
					encodeUnisonSettings(
						buffer,
						instrument.unisonVoices,
						instrument.unisonSpread,
						instrument.unisonOffset,
						instrument.unisonExpression,
						instrument.unisonSign,
					);
				}
			} else if (instrument.type === InstrumentType.pwm) {
				buffer.push(SongTagCode.pulseWidth, base64IntToCharCode[instrument.pulseWidth]);
				buffer.push(
					base64IntToCharCode[instrument.decimalOffset >> 6],
					base64IntToCharCode[instrument.decimalOffset & 0x3f],
				);
				buffer.push(SongTagCode.unison, base64IntToCharCode[instrument.unison]);
				if (instrument.unison === Config.unisons.length) {
					encodeUnisonSettings(
						buffer,
						instrument.unisonVoices,
						instrument.unisonSpread,
						instrument.unisonOffset,
						instrument.unisonExpression,
						instrument.unisonSign,
					);
				}
			} else if (instrument.type === InstrumentType.supersaw) {
				buffer.push(
					SongTagCode.supersaw,
					base64IntToCharCode[instrument.supersawDynamism],
					base64IntToCharCode[instrument.supersawSpread],
					base64IntToCharCode[instrument.supersawShape],
				);
				buffer.push(SongTagCode.pulseWidth, base64IntToCharCode[instrument.pulseWidth]);
				buffer.push(
					base64IntToCharCode[instrument.decimalOffset >> 6],
					base64IntToCharCode[instrument.decimalOffset & 0x3f],
				);
				buffer.push(104, base64IntToCharCode[instrument.unison]);
				if (instrument.unison === Config.unisons.length) {
					encodeUnisonSettings(
						buffer,
						instrument.unisonVoices,
						instrument.unisonSpread,
						instrument.unisonOffset,
						instrument.unisonExpression,
						instrument.unisonSign,
					);
				}
			} else if (instrument.type === InstrumentType.pickedString) {
				if (Config.stringSustainRange > 0x20 || SustainType.length > 2) {
					throw new Error(
						"Not enough bits to represent sustain value and type in same base64 character.",
					);
				}
				buffer.push(SongTagCode.unison, base64IntToCharCode[instrument.unison]);
				if (instrument.unison === Config.unisons.length) {
					encodeUnisonSettings(
						buffer,
						instrument.unisonVoices,
						instrument.unisonSpread,
						instrument.unisonOffset,
						instrument.unisonExpression,
						instrument.unisonSign,
					);
				}
				buffer.push(
					SongTagCode.stringSustain,
					base64IntToCharCode[
						instrument.stringSustain | (instrument.stringSustainType << 5)
					],
				);
			} else if (instrument.type === InstrumentType.mod) {
				// Handled down below. Could be moved, but meh.
			} else {
				// Plugin types — serialize via plugin hook
			}

			const plugin = getPlugin(instrument.type);
			const pluginInstrument = instrument as Instrument & {
				_opaquePluginPayload?: Record<string, unknown>;
				_opaquePluginDecodeFailed?: boolean;
			};
			const opaquePluginPayload = pluginInstrument._opaquePluginPayload;
			if (plugin?.serialize || opaquePluginPayload !== undefined) {
				// biome-ignore lint/suspicious/noExplicitAny: arbitrary JSON fields
				let pluginJson: Record<string, any> = { ...opaquePluginPayload };
				if (!pluginInstrument._opaquePluginDecodeFailed) {
					try {
						plugin?.serialize?.(instrument, pluginJson);
					} catch (error) {
						if (opaquePluginPayload === undefined) throw error;
						pluginJson = { ...opaquePluginPayload };
					}
				}
				if (Object.keys(pluginJson).length > 0) {
					buffer.push(SongTagCode.pluginData);
					const blob = btoa(JSON.stringify(pluginJson));
					encode32BitNumber(buffer, blob.length);
					for (let i = 0; i < blob.length; i++) {
						buffer.push(blob.charCodeAt(i));
					}
				}
			}

			// Socket module payload — use module.serialize() for real param round-trip
			const socketInstrument = instrument as OpaqueSocketInstrument;
			const socketModuleId = socketInstrument._socketModuleId;
			if (socketModuleId) {
				buffer.push(SongTagCode.socketPayload);
				const mod = hydrateOpaqueSocketInstrument(socketInstrument);
				const opaquePayload = socketInstrument._opaqueSocketPayload;
				let payload: Record<string, unknown> = opaquePayload ?? {
					id: socketModuleId,
					version: 1,
				};
				if (mod && !socketInstrument._opaqueSocketHydrationFailed) {
					try {
						const w = new JsonFieldWriter();
						mod.serialize(instrument as unknown as Record<string, unknown>, w);
						payload = {
							...payload,
							id: payload.id ?? socketModuleId,
							version: payload.version ?? 1,
							params: {
								...(typeof payload.params === "object" &&
								payload.params !== null &&
								!Array.isArray(payload.params)
									? payload.params
									: {}),
								...w.toJSON(),
							},
						};
					} catch (error) {
						if (opaquePayload === undefined) throw error;
					}
				}
				const blob = btoa(JSON.stringify(payload));
				encode32BitNumber(buffer, blob.length);
				for (let i = 0; i < blob.length; i++) {
					buffer.push(blob.charCodeAt(i));
				}
			}

			buffer.push(SongTagCode.envelopes, base64IntToCharCode[instrument.envelopeCount]);
			// Added in JB v6: Options for envelopes come next.
			buffer.push(base64IntToCharCode[instrument.envelopeSpeed]);
			for (
				let envelopeIndex: number = 0;
				envelopeIndex < instrument.envelopeCount;
				envelopeIndex++
			) {
				buffer.push(base64IntToCharCode[instrument.envelopes[envelopeIndex].target]);
				if (
					Config.instrumentAutomationTargets[instrument.envelopes[envelopeIndex].target]
						.maxCount > 1
				) {
					buffer.push(base64IntToCharCode[instrument.envelopes[envelopeIndex].index]);
				}
				buffer.push(base64IntToCharCode[instrument.envelopes[envelopeIndex].envelope]);
				// run pitch envelope handling
				if (instrument.envelopes[envelopeIndex].envelope === ENV_PITCH) {
					if (!instrument.isNoiseInstrument) {
						buffer.push(
							base64IntToCharCode[
								instrument.envelopes[envelopeIndex].pitchEnvelopeStart >> 6
							],
							base64IntToCharCode[
								instrument.envelopes[envelopeIndex].pitchEnvelopeStart & 0x3f
							],
						);
						buffer.push(
							base64IntToCharCode[
								instrument.envelopes[envelopeIndex].pitchEnvelopeEnd >> 6
							],
							base64IntToCharCode[
								instrument.envelopes[envelopeIndex].pitchEnvelopeEnd & 0x3f
							],
						);
					} else {
						buffer.push(
							base64IntToCharCode[
								instrument.envelopes[envelopeIndex].pitchEnvelopeStart
							],
						);
						buffer.push(
							base64IntToCharCode[
								instrument.envelopes[envelopeIndex].pitchEnvelopeEnd
							],
						);
					}
					// random
				} else if (instrument.envelopes[envelopeIndex].envelope === ENV_RANDOM) {
					buffer.push(base64IntToCharCode[instrument.envelopes[envelopeIndex].steps]);
					buffer.push(base64IntToCharCode[instrument.envelopes[envelopeIndex].seed]);
					buffer.push(base64IntToCharCode[instrument.envelopes[envelopeIndex].waveform]);
					// lfo
				} else if (instrument.envelopes[envelopeIndex].envelope === ENV_LFO) {
					buffer.push(base64IntToCharCode[instrument.envelopes[envelopeIndex].waveform]);
					if (
						instrument.envelopes[envelopeIndex].waveform ===
							LFOEnvelopeTypes.steppedSaw ||
						instrument.envelopes[envelopeIndex].waveform === LFOEnvelopeTypes.steppedTri
					) {
						buffer.push(base64IntToCharCode[instrument.envelopes[envelopeIndex].steps]);
					}
				}
				// inverse
				let checkboxValues: number = +instrument.envelopes[envelopeIndex].discrete;
				checkboxValues = checkboxValues << 1;
				checkboxValues += +instrument.envelopes[envelopeIndex].inverse;
				buffer.push(
					base64IntToCharCode[checkboxValues]
						? base64IntToCharCode[checkboxValues]
						: base64IntToCharCode[0],
				);
				// midbox envelope port
				const envIdx: number = instrument.envelopes[envelopeIndex].envelope;
				if (
					envIdx !== ENV_PITCH &&
					envIdx !== ENV_NOTESIZE &&
					envIdx !== ENV_PUNCH &&
					envIdx !== ENV_NONE
				) {
					buffer.push(
						base64IntToCharCode[
							Config.perEnvelopeSpeedToIndices[
								instrument.envelopes[envelopeIndex].perEnvelopeSpeed
							]
						],
					);
				}
				buffer.push(
					base64IntToCharCode[
						instrument.envelopes[envelopeIndex].perEnvelopeLowerBound * 10
					],
				);
				buffer.push(
					base64IntToCharCode[
						instrument.envelopes[envelopeIndex].perEnvelopeUpperBound * 10
					],
				);
			}
		}
	}

	buffer.push(SongTagCode.bars);
	bits = new BitFieldWriter();
	let neededBits: number = 0;
	while (1 << neededBits < song.patternsPerChannel + 1) neededBits++;
	for (let channelIndex: number = 0; channelIndex < song.getChannelCount(); channelIndex++) {
		for (let i: number = 0; i < song.barCount; i++) {
			bits.write(neededBits, song.channels[channelIndex].bars[i]);
		}
	}
	bits.encodeBase64(buffer);

	buffer.push(SongTagCode.patterns);
	bits = new BitFieldWriter();
	const shapeBits: BitFieldWriter = new BitFieldWriter();
	const bitsPerNoteSize: number = getNeededBits(Config.noteSizeMax);
	for (let channelIndex: number = 0; channelIndex < song.getChannelCount(); channelIndex++) {
		const channel: Channel = song.channels[channelIndex];
		const maxInstrumentsPerPattern: number = song.getMaxInstrumentsPerPattern(channelIndex);
		const isNoiseChannel: boolean = song.getChannelIsNoise(channelIndex);
		const isModChannel: boolean = song.getChannelIsMod(channelIndex);
		const neededInstrumentCountBits: number = getNeededBits(
			maxInstrumentsPerPattern - Config.instrumentCountMin,
		);
		const neededInstrumentIndexBits: number = getNeededBits(channel.instruments.length - 1);

		// Some info about modulator settings immediately follows in mod channels.
		if (isModChannel) {
			const neededModInstrumentIndexBits: number = getNeededBits(
				song.getMaxInstrumentsPerChannel() + 2,
			);
			for (
				let instrumentIndex: number = 0;
				instrumentIndex < channel.instruments.length;
				instrumentIndex++
			) {
				const instrument: Instrument =
					song.channels[channelIndex].instruments[instrumentIndex];

				for (let mod: number = 0; mod < Config.modCount; mod++) {
					const modChannel: number = instrument.modChannels[mod];
					const modInstrument: number = instrument.modInstruments[mod];
					const modSetting: number = instrument.modulators[mod];
					const modFilter: number = instrument.modFilterTypes[mod];
					const modEnvelope: number = instrument.modEnvelopeNumbers[mod];

					// Still using legacy "mod status" format, but doing it manually as it's only used in the URL now.
					// 0 - For pitch/noise
					// 1 - (used to be For noise, not needed)
					// 2 - For song
					// 3 - None

					let status: number = Config.modulators[modSetting].forSong ? 2 : 0;
					if (modSetting === Config.modulators.dictionary.none.index) {
						status = 3;
					}

					bits.write(2, status);

					// Channel/Instrument is only used if the status isn't "song" or "none".
					if (status === 0 || status === 1) {
						bits.write(8, modChannel);
						bits.write(neededModInstrumentIndexBits, modInstrument);
					}

					// Only used if setting isn't "none".
					if (status !== 3) {
						bits.write(6, modSetting);
					}

					// Write mod filter info, only if this is a filter mod
					if (
						Config.modulators[instrument.modulators[mod]].name === "eq filter" ||
						Config.modulators[instrument.modulators[mod]].name === "note filter" ||
						Config.modulators[instrument.modulators[mod]].name === "song eq"
					) {
						bits.write(6, modFilter);
					}

					// write envelope info only if needed
					if (
						Config.modulators[instrument.modulators[mod]].name ===
							"individual envelope speed" ||
						Config.modulators[instrument.modulators[mod]].name === "reset envelope" ||
						Config.modulators[instrument.modulators[mod]].name ===
							"individual envelope lower bound" ||
						Config.modulators[instrument.modulators[mod]].name ===
							"individual envelope upper bound"
					) {
						bits.write(6, modEnvelope);
					}
				}
			}
		}
		const octaveOffset: number =
			isNoiseChannel || isModChannel ? 0 : channel.octave * Config.pitchesPerOctave;
		let lastPitch: number = isNoiseChannel ? 4 : octaveOffset;
		const recentPitches: number[] = isModChannel
			? [0, 1, 2, 3, 4, 5]
			: isNoiseChannel
				? [4, 6, 7, 2, 3, 8, 0, 10]
				: [0, 7, 12, 19, 24, -5, -12];
		const recentShapes: string[] = [];
		for (let i: number = 0; i < recentPitches.length; i++) {
			recentPitches[i] += octaveOffset;
		}
		for (const pattern of channel.patterns) {
			if (song.patternInstruments) {
				const instrumentCount: number = validateRange(
					Config.instrumentCountMin,
					maxInstrumentsPerPattern,
					pattern.instruments.length,
				);
				bits.write(neededInstrumentCountBits, instrumentCount - Config.instrumentCountMin);
				for (let i: number = 0; i < instrumentCount; i++) {
					bits.write(neededInstrumentIndexBits, pattern.instruments[i]);
				}
			}

			if (pattern.notes.length > 0) {
				bits.write(1, 1);

				let curPart: number = 0;
				for (const note of pattern.notes) {
					// For mod channels, a negative offset may be necessary.
					if (note.start < curPart && isModChannel) {
						bits.write(2, 0); // rest, then...
						bits.write(1, 1); // negative offset
						bits.writePartDuration(curPart - note.start);
					}

					if (note.start > curPart) {
						bits.write(2, 0); // rest
						if (isModChannel) bits.write(1, 0); // positive offset, only needed for mod channels
						bits.writePartDuration(note.start - curPart);
					}

					shapeBits.clear();

					// Old format was:
					// 0: 1 pitch, 10: 2 pitches, 110: 3 pitches, 111: 4 pitches
					// New format is:
					//      0: 1 pitch
					// 1[XXX]: 3 bits of binary signifying 2+ pitches
					if (note.pitches.length === 1) {
						shapeBits.write(1, 0);
					} else {
						shapeBits.write(1, 1);
						shapeBits.write(3, note.pitches.length - 2);
					}

					shapeBits.writePinCount(note.pins.length - 1);

					if (!isModChannel) {
						shapeBits.write(bitsPerNoteSize, note.pins[0].size); // volume
					} else {
						shapeBits.write(11, note.pins[0].size); // Modulator value. had to change from 9 to 11 for 2000 max tempo
					}

					let shapePart: number = 0;
					const startPitch: number = note.pitches[0];
					let currentPitch: number = startPitch;
					const pitchBends: number[] = [];
					for (let i: number = 1; i < note.pins.length; i++) {
						const pin: NotePin = note.pins[i];
						const nextPitch: number = startPitch + pin.interval;
						if (currentPitch !== nextPitch) {
							shapeBits.write(1, 1);
							pitchBends.push(nextPitch);
							currentPitch = nextPitch;
						} else {
							shapeBits.write(1, 0);
						}
						shapeBits.writePartDuration(pin.time - shapePart);
						shapePart = pin.time;
						if (!isModChannel) {
							shapeBits.write(bitsPerNoteSize, pin.size);
						} else {
							shapeBits.write(11, pin.size); // Modulator value. had to change from 9 to 11 for 2000 max tempo
						}
					}

					const shapeString: string = String.fromCharCode.apply(
						null,
						shapeBits.encodeBase64([]),
					);
					const shapeIndex: number = recentShapes.indexOf(shapeString);
					if (shapeIndex === -1) {
						bits.write(2, 1); // new shape
						bits.concat(shapeBits);
					} else {
						bits.write(1, 1); // old shape
						bits.writeLongTail(0, 0, shapeIndex);
						recentShapes.splice(shapeIndex, 1);
					}
					recentShapes.unshift(shapeString);
					if (recentShapes.length > 10) recentShapes.pop();

					const allPitches: number[] = note.pitches.concat(pitchBends);
					for (let i: number = 0; i < allPitches.length; i++) {
						const pitch: number = allPitches[i];
						const pitchIndex: number = recentPitches.indexOf(pitch);
						if (pitchIndex === -1) {
							let interval: number = 0;
							let pitchIter: number = lastPitch;
							if (pitchIter < pitch) {
								while (pitchIter !== pitch) {
									pitchIter++;
									if (recentPitches.indexOf(pitchIter) === -1) interval++;
								}
							} else {
								while (pitchIter !== pitch) {
									pitchIter--;
									if (recentPitches.indexOf(pitchIter) === -1) interval--;
								}
							}
							bits.write(1, 0);
							bits.writePitchInterval(interval);
						} else {
							bits.write(1, 1);
							bits.write(4, pitchIndex);
							recentPitches.splice(pitchIndex, 1);
						}
						recentPitches.unshift(pitch);
						if (recentPitches.length > 16) recentPitches.pop();

						if (i === note.pitches.length - 1) {
							lastPitch = note.pitches[0];
						} else {
							lastPitch = pitch;
						}
					}

					if (note.start === 0) {
						bits.write(1, note.continuesLastPattern ? 1 : 0);
					}

					curPart = note.end;
				}

				if (curPart < song.beatsPerBar * Config.partsPerBeat + +isModChannel) {
					bits.write(2, 0); // rest
					if (isModChannel) bits.write(1, 0); // positive offset
					bits.writePartDuration(
						song.beatsPerBar * Config.partsPerBeat + +isModChannel - curPart,
					);
				}
			} else {
				bits.write(1, 0);
			}
		}
	}
	let stringLength: number = bits.lengthBase64();
	const digits: number[] = [];
	while (stringLength > 0) {
		digits.unshift(base64IntToCharCode[stringLength & 0x3f]);
		stringLength = stringLength >> 6;
	}
	buffer.push(base64IntToCharCode[digits.length]);
	Array.prototype.push.apply(buffer, digits); // append digits to buffer.
	bits.encodeBase64(buffer);

	const maxApplyArgs: number = 64000;
	let customSamplesStr = "";
	const customSamples = song.customSampleHandler?.getCustomSamples();
	if (customSamples != null && customSamples.length > 0) {
		customSamplesStr = `|${customSamples.join("|")}`;
	}
	// samplemark
	if (buffer.length < maxApplyArgs) {
		// Note: Function.apply may break for long argument lists.
		return String.fromCharCode.apply(null, buffer) + customSamplesStr;
		// samplemark
	} else {
		let result: string = "";
		for (let i: number = 0; i < buffer.length; i += maxApplyArgs) {
			result += String.fromCharCode.apply(null, buffer.slice(i, i + maxApplyArgs));
		}
		return result + customSamplesStr;
		// samplemark
	}
}
