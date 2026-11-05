// snapshot.ts
//
// Purpose: Immutable plain-data types and builder for SongSnapshot protocol
//
// This module:
// - Defines SongSnapshot and all nested snapshot types as readonly interfaces
// - Provides SnapshotBuilder that deep-copies a mutable Song into an immutable snapshot
// - Tracks version (monotonic per build) and editSequence (bumped on editor mutation)
// - Designed for Phase 1 render-core ingestion: no DOM, no AudioContext, no mutable refs

import type { Channel } from "../channels";
import { Instrument } from "../instruments";
import { CustomAlgorithm } from "../instruments/custom-algorithm";
import { CustomFeedBack } from "../instruments/custom-feedback";
import { EnvelopeSettings } from "../instruments/envelope-settings";
import { FilterControlPoint } from "../instruments/filter-control-point";
import { FilterSettings } from "../instruments/filter-settings";
import { Operator } from "../instruments/operator";
import type { Note, NotePin, Pattern } from "../notes";
import type { Song } from "../song";
import { Config } from "../synth-config";
import { HarmonicsWave, SpectrumWave } from "../waves";

// ── Snapshot types ────────────────────────────────────────────────────────

export interface FilterControlPointSnapshot {
	readonly type: number;
	readonly freq: number;
	readonly gain: number;
}

export interface FilterSettingsSnapshot {
	readonly controlPointCount: number;
	readonly controlPoints: readonly FilterControlPointSnapshot[];
}

export interface EnvelopeSettingsSnapshot {
	readonly target: number;
	readonly index: number;
	readonly envelope: number;
	readonly pitchEnvelopeStart: number;
	readonly pitchEnvelopeEnd: number;
	readonly inverse: boolean;
	readonly perEnvelopeSpeed: number;
	readonly perEnvelopeLowerBound: number;
	readonly perEnvelopeUpperBound: number;
	readonly steps: number;
	readonly seed: number;
	readonly waveform: number;
	readonly discrete: boolean;
}

export interface OperatorSnapshot {
	readonly frequency: number;
	readonly amplitude: number;
	readonly waveform: number;
	readonly pulseWidth: number;
}

export interface CustomAlgorithmSnapshot {
	readonly name: string;
	readonly carrierCount: number;
	readonly modulatedBy: readonly (readonly number[])[];
	readonly associatedCarrier: readonly number[];
}

export interface CustomFeedBackSnapshot {
	readonly name: string;
	readonly indices: readonly (readonly number[])[];
}

export interface SpectrumWaveSnapshot {
	readonly spectrum: readonly number[];
	readonly hash: number;
}

export interface HarmonicsWaveSnapshot {
	readonly harmonics: readonly number[];
	readonly hash: number;
}

export interface NotePinSnapshot {
	readonly interval: number;
	readonly time: number;
	readonly size: number;
}

export interface NoteSnapshot {
	readonly pitches: readonly number[];
	readonly pins: readonly NotePinSnapshot[];
	readonly start: number;
	readonly end: number;
	readonly continuesLastPattern: boolean;
	readonly velocity: number;
}

export interface PatternSnapshot {
	readonly instrumentIndices: readonly number[];
	readonly notes: readonly NoteSnapshot[];
}

export interface InstrumentSnapshot {
	readonly type: number;
	readonly socketModuleId: string | null;
	readonly preset: number;

	// Volume & Pan
	readonly volume: number;
	readonly pan: number;
	readonly panDelay: number;

	// Effects bitmask
	readonly effects: number;

	// Filters
	readonly eqFilter: FilterSettingsSnapshot;
	readonly eqFilterType: boolean;
	readonly eqFilterSimpleCut: number;
	readonly eqFilterSimplePeak: number;
	readonly eqSubFilters: readonly (FilterSettingsSnapshot | null)[];
	readonly noteFilter: FilterSettingsSnapshot;
	readonly noteFilterType: boolean;
	readonly noteFilterSimpleCut: number;
	readonly noteFilterSimplePeak: number;
	readonly noteSubFilters: readonly (FilterSettingsSnapshot | null)[];

	// Transitions and envelopes
	readonly fadeIn: number;
	readonly fadeOut: number;
	readonly envelopeCount: number;
	readonly transition: number;
	readonly envelopes: readonly EnvelopeSettingsSnapshot[];

	// Pitch
	readonly pitchShift: number;
	readonly detune: number;

	// Vibrato
	readonly vibrato: number;
	readonly interval: number;
	readonly vibratoDepth: number;
	readonly vibratoSpeed: number;
	readonly vibratoDelay: number;
	readonly vibratoType: number;

	// Envelope speed
	readonly envelopeSpeed: number;

	// Unison
	readonly unison: number;
	readonly unisonVoices: number;
	readonly unisonSpread: number;
	readonly unisonOffset: number;
	readonly unisonExpression: number;
	readonly unisonSign: number;
	readonly unisonInitialized: boolean;

	// Chord / Arpeggio
	readonly chord: number;
	readonly arpeggioSpeed: number;
	readonly monoChordTone: number;
	readonly fastTwoNoteArp: boolean;

	// Pulse-width / Supersaw
	readonly pulseWidth: number;
	readonly decimalOffset: number;
	readonly supersawDynamism: number;
	readonly supersawSpread: number;
	readonly supersawShape: number;

	// String sustain
	readonly stringSustain: number;
	readonly stringSustainType: number;

	// Effect params
	readonly distortion: number;
	readonly bitcrusherFreq: number;
	readonly bitcrusherQuantization: number;
	readonly ringModulation: number;
	readonly ringModulationHz: number;
	readonly ringModWaveformIndex: number;
	readonly ringModPulseWidth: number;
	readonly ringModHzOffset: number;
	readonly granular: number;
	readonly grainSize: number;
	readonly grainAmounts: number;
	readonly grainRange: number;
	readonly chorus: number;
	readonly reverb: number;
	readonly echoSustain: number;
	readonly echoDelay: number;
	readonly phaserFreq: number;
	readonly phaserMix: number;
	readonly phaserFeedback: number;
	readonly phaserStages: number;
	readonly invertWave: boolean;
	readonly compressorThreshold: number;
	readonly compressorRatio: number;
	readonly compressorAttack: number;
	readonly compressorRelease: number;
	readonly compressorSync: number;

	// FM
	readonly algorithm: number;
	readonly feedbackType: number;
	readonly algorithm6Op: number;
	readonly feedbackType6Op: number;
	readonly feedbackAmplitude: number;
	readonly operators: readonly OperatorSnapshot[];
	readonly customAlgorithm: CustomAlgorithmSnapshot;
	readonly customFeedback: CustomFeedBackSnapshot;

	// Custom chip wave
	readonly customChipWave: readonly number[];
	readonly customChipWaveIntegral: readonly number[];
	readonly chipWave: number;
	readonly chipNoise: number;
	readonly isUsingAdvancedLoopControls: boolean;
	readonly chipWaveLoopStart: number;
	readonly chipWaveLoopEnd: number;
	readonly chipWaveLoopMode: number;
	readonly chipWavePlayBackwards: boolean;
	readonly chipWaveStartOffset: number;

	// Spectrum / Harmonics
	readonly spectrumWave: SpectrumWaveSnapshot;
	readonly harmonicsWave: HarmonicsWaveSnapshot;

	// Drumset
	readonly drumsetEnvelopes: readonly number[];
	readonly drumsetSpectrumWaves: readonly SpectrumWaveSnapshot[];

	// Modulators
	readonly modChannels: readonly number[];
	readonly modInstruments: readonly number[];
	readonly modulators: readonly number[];
	readonly modFilterTypes: readonly number[];
	readonly modEnvelopeNumbers: readonly number[];
	readonly invalidModulators: readonly boolean[];

	// Note range
	readonly upperNoteLimit: number;
	readonly lowerNoteLimit: number;
	readonly upperVelocityLimit: number;
	readonly lowerVelocityLimit: number;
	readonly velocityTracking: number;

	// Misc
	readonly clicklessTransition: boolean;
	readonly legacyTieOver: boolean;
	readonly aliases: boolean;
	readonly isNoiseInstrument: boolean;
}

export interface ChannelSnapshot {
	readonly muted: boolean;
	readonly octave: number;
	readonly name: string;
	readonly instruments: readonly InstrumentSnapshot[];
	readonly barPatternMap: readonly number[];
	readonly patterns: readonly PatternSnapshot[];
}

export interface SongSnapshot {
	readonly version: number;
	readonly editSequence: number;
	readonly timestamp: number;

	// Song structure
	readonly sampleRate: number;
	readonly beatsPerBar: number;
	readonly barCount: number;
	readonly ticksPerPart: number;
	readonly partsPerBeat: number;
	readonly pitchChannelCount: number;
	readonly noiseChannelCount: number;
	readonly modChannelCount: number;
	readonly channelSnapshots: readonly ChannelSnapshot[];

	// Transport state
	readonly loopBarStart: number;
	readonly loopBarEnd: number;
	readonly loopRepeatCount: number;
	readonly loopBarCopy: number;
	readonly barCountOverride: number | null;

	// Global params
	readonly masterGain: number;
	readonly eqFilter: FilterSettingsSnapshot;
	readonly eqFilterType: boolean;
	readonly eqFilterSimpleCut: number;
	readonly eqFilterSimplePeak: number;
	readonly eqSubFilters: readonly (FilterSettingsSnapshot | null)[];
	readonly inVolumeCap: number;
	readonly outVolumeCap: number;
	readonly compressionThreshold: number;
	readonly limitThreshold: number;
	readonly compressionRatio: number;
	readonly limitRatio: number;
	readonly limitDecay: number;
	readonly limitRise: number;
	readonly channelVolumeCaps: readonly number[];

	// Song-level octave/key (read by render core for pitch computation)
	readonly octave: number;
	readonly key: number;

	// Pattern/layer flags (read by render core for instrument resolution)
	readonly patternInstruments: boolean;
	readonly layeredInstruments: boolean;

	// Tempo / reverb
	readonly tempo: number;
	readonly rhythm: number;
	readonly reverb: number;
	readonly scaleCustom: readonly boolean[];
}

// ── SnapshotBuilder ───────────────────────────────────────────────────────

export class SnapshotBuilder {
	private _editSequence: number = 0;
	private _version: number = 0;

	public get editSequence(): number {
		return this._editSequence;
	}

	public get version(): number {
		return this._version;
	}

	public incrementEditSequence(): void {
		this._editSequence++;
	}

	public build(song: Song, opts?: { loopRepeatCount?: number }): SongSnapshot {
		this._version++;

		const channelCount: number = song.getChannelCount();
		const channelSnapshots: ChannelSnapshot[] = [];
		const maxPatternCount: number = song.patternsPerChannel;

		for (let i: number = 0; i < channelCount; i++) {
			channelSnapshots.push(this._buildChannel(song, i, maxPatternCount));
		}

		const eqFilter: FilterSettingsSnapshot = snapshotFilterSettings(song.eqFilter);

		const eqSubFilters: (FilterSettingsSnapshot | null)[] = [];
		for (let i: number = 0; i < Config.filterMorphCount - 1; i++) {
			const src: FilterSettings | null = song.eqSubFilters[i];
			eqSubFilters[i] = src != null ? snapshotFilterSettings(src) : null;
		}

		const channelVolumeCaps: number[] = [];
		for (let i: number = 0; i < song.channelVolumeCaps.length; i++) {
			channelVolumeCaps[i] = song.channelVolumeCaps[i];
		}

		return {
			version: this._version,
			editSequence: this._editSequence,
			timestamp: performance.now(),

			sampleRate: Config.defaultSampleRate,
			beatsPerBar: song.beatsPerBar,
			barCount: song.barCount,
			ticksPerPart: Config.ticksPerPart,
			partsPerBeat: Config.partsPerBeat,
			pitchChannelCount: song.pitchChannelCount,
			noiseChannelCount: song.noiseChannelCount,
			modChannelCount: song.modChannelCount,
			channelSnapshots,

			loopBarStart: song.loopStart,
			loopBarEnd: song.loopStart + song.loopLength,
			loopRepeatCount: opts?.loopRepeatCount ?? -1,
			loopBarCopy: 0,
			barCountOverride: null,

			masterGain: song.masterGain,
			eqFilter,
			eqFilterType: song.eqFilterType,
			eqFilterSimpleCut: song.eqFilterSimpleCut,
			eqFilterSimplePeak: song.eqFilterSimplePeak,
			eqSubFilters,
			inVolumeCap: song.inVolumeCap,
			outVolumeCap: song.outVolumeCap,
			compressionThreshold: song.compressionThreshold,
			limitThreshold: song.limitThreshold,
			compressionRatio: song.compressionRatio,
			limitRatio: song.limitRatio,
			limitDecay: song.limitDecay,
			limitRise: song.limitRise,
			channelVolumeCaps,

			octave: song.octave,
			key: song.key,
			patternInstruments: song.patternInstruments,
			layeredInstruments: song.layeredInstruments,

			tempo: song.tempo,
			rhythm: song.rhythm,
			reverb: song.reverb,
			scaleCustom: [...song.scaleCustom],
		};
	}

	private _buildChannel(
		song: Song,
		channelIndex: number,
		maxPatternCount: number,
	): ChannelSnapshot {
		const channel: Channel = song.channels[channelIndex];

		// Build instruments
		const instrumentSnapshots: InstrumentSnapshot[] = [];
		for (let j: number = 0; j < channel.instruments.length; j++) {
			instrumentSnapshots.push(snapshotInstrument(channel.instruments[j]));
		}

		// Build pattern data
		const patternSnapshots: PatternSnapshot[] = [];
		for (let j: number = 0; j < maxPatternCount; j++) {
			if (j < channel.patterns.length) {
				patternSnapshots.push(snapshotPattern(channel.patterns[j]));
			} else {
				patternSnapshots.push({ instrumentIndices: [0], notes: [] });
			}
		}

		// Bar-to-pattern map
		const barPatternMap: number[] = [];
		for (let j: number = 0; j < song.barCount; j++) {
			barPatternMap[j] = j < channel.bars.length ? channel.bars[j] : 0;
		}

		return {
			muted: channel.muted,
			octave: channel.octave,
			name: channel.name,
			instruments: instrumentSnapshots,
			barPatternMap,
			patterns: patternSnapshots,
		};
	}
}

// ── Snapshot helper functions ─────────────────────────────────────────────

/** Deep-copy a FilterSettings into a snapshot. */
export function snapshotFilterSettings(fs: FilterSettings): FilterSettingsSnapshot {
	const points: FilterControlPointSnapshot[] = [];
	for (let i: number = 0; i < fs.controlPointCount; i++) {
		const cp: FilterControlPoint = fs.controlPoints[i];
		points.push({ type: cp.type, freq: cp.freq, gain: cp.gain });
	}
	return { controlPointCount: fs.controlPointCount, controlPoints: points };
}

/** Deep-copy an EnvelopeSettings into a snapshot. */
export function snapshotEnvelopeSettings(es: EnvelopeSettings): EnvelopeSettingsSnapshot {
	return {
		target: es.target,
		index: es.index,
		envelope: es.envelope,
		pitchEnvelopeStart: es.pitchEnvelopeStart,
		pitchEnvelopeEnd: es.pitchEnvelopeEnd,
		inverse: es.inverse,
		perEnvelopeSpeed: es.perEnvelopeSpeed,
		perEnvelopeLowerBound: es.perEnvelopeLowerBound,
		perEnvelopeUpperBound: es.perEnvelopeUpperBound,
		steps: es.steps,
		seed: es.seed,
		waveform: es.waveform,
		discrete: es.discrete,
	};
}

/** Deep-copy a FilterSettings|FilterControlPoint pair into a snapshot (for per-sub-filter). */
function snapshotFilterSettingsOrNull(fs: FilterSettings | null): FilterSettingsSnapshot | null {
	return fs != null ? snapshotFilterSettings(fs) : null;
}

/** Deep-copy an Operator into a snapshot. */
export function snapshotOperator(op: Operator): OperatorSnapshot {
	return {
		frequency: op.frequency,
		amplitude: op.amplitude,
		waveform: op.waveform,
		pulseWidth: op.pulseWidth,
	};
}

/** Deep-copy a CustomAlgorithm into a snapshot. */
export function snapshotCustomAlgorithm(ca: CustomAlgorithm): CustomAlgorithmSnapshot {
	const modulatedBy: number[][] = [];
	for (let i: number = 0; i < ca.modulatedBy.length; i++) {
		modulatedBy.push([...ca.modulatedBy[i]]);
	}
	return {
		name: ca.name,
		carrierCount: ca.carrierCount,
		modulatedBy,
		associatedCarrier: [...ca.associatedCarrier],
	};
}

/** Deep-copy a CustomFeedBack into a snapshot. */
export function snapshotCustomFeedBack(cf: CustomFeedBack): CustomFeedBackSnapshot {
	const indices: number[][] = [];
	for (let i: number = 0; i < cf.indices.length; i++) {
		indices.push([...cf.indices[i]]);
	}
	return {
		name: cf.name,
		indices,
	};
}

/** Deep-copy a SpectrumWave into a snapshot. */
export function snapshotSpectrumWave(sw: SpectrumWave): SpectrumWaveSnapshot {
	return {
		spectrum: [...sw.spectrum],
		hash: sw.hash,
	};
}

/** Deep-copy a HarmonicsWave into a snapshot. */
export function snapshotHarmonicsWave(hw: HarmonicsWave): HarmonicsWaveSnapshot {
	return {
		harmonics: [...hw.harmonics],
		hash: hw.hash,
	};
}

/** Deep-copy a Note into a snapshot. */
export function snapshotNote(note: Note): NoteSnapshot {
	const pins: NotePinSnapshot[] = [];
	for (let k: number = 0; k < note.pins.length; k++) {
		const pin: NotePin = note.pins[k];
		pins.push({ interval: pin.interval, time: pin.time, size: pin.size });
	}
	return {
		pitches: [...note.pitches],
		pins,
		start: note.start,
		end: note.end,
		continuesLastPattern: note.continuesLastPattern,
		velocity: note.velocity,
	};
}

/** Deep-copy a Pattern into a snapshot. */
export function snapshotPattern(pattern: Pattern): PatternSnapshot {
	const notes: NoteSnapshot[] = [];
	for (let k: number = 0; k < pattern.notes.length; k++) {
		notes.push(snapshotNote(pattern.notes[k]));
	}
	return {
		instrumentIndices: [...pattern.instruments],
		notes,
	};
}

/** Deep-copy an Instrument into a snapshot. Returns a deeply immutable plain object (no shared refs). */
export function snapshotInstrument(inst: Instrument): InstrumentSnapshot {
	const _socketModuleId: string | undefined = (inst as unknown as { _socketModuleId?: string })
		._socketModuleId;

	// Envelopes
	const envelopes: EnvelopeSettingsSnapshot[] = [];
	for (let i: number = 0; i < inst.envelopes.length; i++) {
		envelopes.push(snapshotEnvelopeSettings(inst.envelopes[i]));
	}

	// Operators
	const operators: OperatorSnapshot[] = [];
	for (let i: number = 0; i < inst.operators.length; i++) {
		operators.push(snapshotOperator(inst.operators[i]));
	}

	// Eq sub-filters
	const eqSubFilters: (FilterSettingsSnapshot | null)[] = [];
	for (let i: number = 0; i < Config.filterMorphCount - 1; i++) {
		eqSubFilters[i] = snapshotFilterSettingsOrNull(inst.eqSubFilters[i] ?? null);
	}

	// Note sub-filters
	const noteSubFilters: (FilterSettingsSnapshot | null)[] = [];
	for (let i: number = 0; i < Config.filterMorphCount - 1; i++) {
		noteSubFilters[i] = snapshotFilterSettingsOrNull(inst.noteSubFilters[i] ?? null);
	}

	// Custom chip wave
	const customChipWave: number[] = [];
	for (let i: number = 0; i < inst.customChipWave.length; i++) {
		customChipWave.push(inst.customChipWave[i]);
	}
	const customChipWaveIntegral: number[] = [];
	for (let i: number = 0; i < inst.customChipWaveIntegral.length; i++) {
		customChipWaveIntegral.push(inst.customChipWaveIntegral[i]);
	}

	// Drumset envelopes and spectrum
	const drumsetEnvelopes: number[] = [...inst.drumsetEnvelopes];
	const drumsetSpectrumWaves: SpectrumWaveSnapshot[] = [];
	for (let i: number = 0; i < inst.drumsetSpectrumWaves.length; i++) {
		drumsetSpectrumWaves.push(snapshotSpectrumWave(inst.drumsetSpectrumWaves[i]));
	}

	// Modulator arrays
	const modChannels: number[] = [...inst.modChannels];
	const modInstruments: number[] = [...inst.modInstruments];
	const modulators: number[] = [...inst.modulators];
	const modFilterTypes: number[] = [...inst.modFilterTypes];
	const modEnvelopeNumbers: number[] = [...inst.modEnvelopeNumbers];
	const invalidModulators: boolean[] = [...inst.invalidModulators];

	return {
		type: inst.type,
		socketModuleId: _socketModuleId ?? null,
		preset: inst.preset,

		volume: inst.volume,
		pan: inst.pan,
		panDelay: inst.panDelay,

		effects: inst.effects,

		eqFilter: snapshotFilterSettings(inst.eqFilter),
		eqFilterType: inst.eqFilterType,
		eqFilterSimpleCut: inst.eqFilterSimpleCut,
		eqFilterSimplePeak: inst.eqFilterSimplePeak,
		eqSubFilters,
		noteFilter: snapshotFilterSettings(inst.noteFilter),
		noteFilterType: inst.noteFilterType,
		noteFilterSimpleCut: inst.noteFilterSimpleCut,
		noteFilterSimplePeak: inst.noteFilterSimplePeak,
		noteSubFilters,

		fadeIn: inst.fadeIn,
		fadeOut: inst.fadeOut,
		envelopeCount: inst.envelopeCount,
		transition: inst.transition,
		envelopes,

		pitchShift: inst.pitchShift,
		detune: inst.detune,

		vibrato: inst.vibrato,
		interval: inst.interval,
		vibratoDepth: inst.vibratoDepth,
		vibratoSpeed: inst.vibratoSpeed,
		vibratoDelay: inst.vibratoDelay,
		vibratoType: inst.vibratoType,

		envelopeSpeed: inst.envelopeSpeed,

		unison: inst.unison,
		unisonVoices: inst.unisonVoices,
		unisonSpread: inst.unisonSpread,
		unisonOffset: inst.unisonOffset,
		unisonExpression: inst.unisonExpression,
		unisonSign: inst.unisonSign,
		unisonInitialized: inst.unisonInitialized,

		chord: inst.chord,
		arpeggioSpeed: inst.arpeggioSpeed,
		monoChordTone: inst.monoChordTone,
		fastTwoNoteArp: inst.fastTwoNoteArp,

		pulseWidth: inst.pulseWidth,
		decimalOffset: inst.decimalOffset,
		supersawDynamism: inst.supersawDynamism,
		supersawSpread: inst.supersawSpread,
		supersawShape: inst.supersawShape,

		stringSustain: inst.stringSustain,
		stringSustainType: inst.stringSustainType,

		distortion: inst.distortion,
		bitcrusherFreq: inst.bitcrusherFreq,
		bitcrusherQuantization: inst.bitcrusherQuantization,
		ringModulation: inst.ringModulation,
		ringModulationHz: inst.ringModulationHz,
		ringModWaveformIndex: inst.ringModWaveformIndex,
		ringModPulseWidth: inst.ringModPulseWidth,
		ringModHzOffset: inst.ringModHzOffset,
		granular: inst.granular,
		grainSize: inst.grainSize,
		grainAmounts: inst.grainAmounts,
		grainRange: inst.grainRange,
		chorus: inst.chorus,
		reverb: inst.reverb,
		echoSustain: inst.echoSustain,
		echoDelay: inst.echoDelay,
		phaserFreq: inst.phaserFreq,
		phaserMix: inst.phaserMix,
		phaserFeedback: inst.phaserFeedback,
		phaserStages: inst.phaserStages,
		invertWave: inst.invertWave,
		compressorThreshold: inst.compressorThreshold,
		compressorRatio: inst.compressorRatio,
		compressorAttack: inst.compressorAttack,
		compressorRelease: inst.compressorRelease,
		compressorSync: inst.compressorSync,

		algorithm: inst.algorithm,
		feedbackType: inst.feedbackType,
		algorithm6Op: inst.algorithm6Op,
		feedbackType6Op: inst.feedbackType6Op,
		feedbackAmplitude: inst.feedbackAmplitude,
		operators,
		customAlgorithm: snapshotCustomAlgorithm(inst.customAlgorithm),
		customFeedback: snapshotCustomFeedBack(inst.customFeedbackType),

		customChipWave,
		customChipWaveIntegral,
		chipWave: inst.chipWave,
		chipNoise: inst.chipNoise,
		isUsingAdvancedLoopControls: inst.isUsingAdvancedLoopControls,
		chipWaveLoopStart: inst.chipWaveLoopStart,
		chipWaveLoopEnd: inst.chipWaveLoopEnd,
		chipWaveLoopMode: inst.chipWaveLoopMode,
		chipWavePlayBackwards: inst.chipWavePlayBackwards,
		chipWaveStartOffset: inst.chipWaveStartOffset,

		spectrumWave: snapshotSpectrumWave(inst.spectrumWave),
		harmonicsWave: snapshotHarmonicsWave(inst.harmonicsWave),

		drumsetEnvelopes,
		drumsetSpectrumWaves,

		modChannels,
		modInstruments,
		modulators,
		modFilterTypes,
		modEnvelopeNumbers,
		invalidModulators,

		upperNoteLimit: inst.upperNoteLimit,
		lowerNoteLimit: inst.lowerNoteLimit,
		upperVelocityLimit: inst.upperVelocityLimit,
		lowerVelocityLimit: inst.lowerVelocityLimit,
		velocityTracking: inst.velocityTracking,

		clicklessTransition: inst.clicklessTransition,
		legacyTieOver: inst.legacyTieOver,
		aliases: inst.aliases,
		isNoiseInstrument: inst.isNoiseInstrument,
	};
}
