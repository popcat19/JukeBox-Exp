// enums.ts
//
// Purpose: All enumerations used across the synth config layer
//
// This module:
// - Defines FilterType, SustainType, GranularEnvelopeType, EnvelopeType
// - Defines DropdownID, EffectType, EnvelopeComputeIndex
// - Defines LFOEnvelopeTypes, RandomEnvelopeTypes, SampleLoadingStatus

/*!
Copyright (c) 2012-2022 John Nesky and contributing authors

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
of the Software, and to permit persons to whom the Software is furnished to do
so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

export enum FilterType {
	lowPass,
	highPass,
	peak,
	length,
}

export enum SustainType {
	bright,
	acoustic,
	length,
}

export enum GranularEnvelopeType {
	parabolic,
	raisedCosineBell,
	// trapezoid,
	length,
}

export enum EnvelopeType {
	none,
	noteSize,
	pitch, // slarmoo's box 0.9
	pseudorandom, // slarmoo's box 1.3
	punch,
	flare,
	twang,
	swell,
	lfo, // renamed from tremolo in slarmoo's box 1.3
	tremolo2, // Retained for backward compatibility — used by 10+ active envelope configs (tripolo, pentolo, flutter)
	decay,
	wibble,
	linear,
	rise,
	blip,
	fall, // slarmoo's box 1.2
	// add new envelope types here
}

export enum DropdownID {
	Vibrato = 0,
	Pan = 1,
	Chord = 2,
	Transition = 3,
	FM = 4,
	PulseWidth = 5,
	Unison = 6,
	Envelope = 7,
	EnvelopeSettings = 8,
}

export enum EffectType {
	reverb,
	chorus,
	panning,
	distortion,
	bitcrusher,
	noteFilter,
	echo,
	pitchShift,
	detune,
	vibrato,
	transition,
	chord,
	// If you add more, you'll also have to extend the bitfield used in Base64 which currently uses three six-bit characters.
	noteRange, // no longer just a placeholder :3
	ringModulation,
	granular,
	phaser,
	octaveShift, // Studio Box port placeholder just in case
	invertWave,
	// Bits 18 and above do not fit the three-character effects bitfield, so compressor and combFlanger are serialized through their own song tags.
	compressor,
	combFlanger,
	length,
}

export enum EnvelopeComputeIndex {
	noteVolume,
	noteFilterAllFreqs,
	pulseWidth,
	stringSustain,
	unison,
	operatorFrequency0,
	operatorFrequency1,
	operatorFrequency2,
	operatorFrequency3,
	operatorFrequency4,
	operatorFrequency5,
	operatorAmplitude0,
	operatorAmplitude1,
	operatorAmplitude2,
	operatorAmplitude3,
	operatorAmplitude4,
	operatorAmplitude5,
	feedbackAmplitude,
	pitchShift,
	detune,
	vibratoDepth,
	// vibratoSpeed, doesn't follow normal envelope pattern; will figure out. //if you fix this you need to update the url
	noteFilterFreq0,
	noteFilterFreq1,
	noteFilterFreq2,
	noteFilterFreq3,
	noteFilterFreq4,
	noteFilterFreq5,
	noteFilterFreq6,
	noteFilterFreq7,
	noteFilterGain0,
	noteFilterGain1,
	noteFilterGain2,
	noteFilterGain3,
	noteFilterGain4,
	noteFilterGain5,
	noteFilterGain6,
	noteFilterGain7,
	decimalOffset,
	supersawDynamism,
	supersawSpread,
	supersawShape,
	panning,
	distortion,
	bitcrusherQuantization,
	bitcrusherFrequency,
	chorus,
	echoSustain,
	reverb,
	arpeggioSpeed,
	ringModulation,
	ringModulationHz,
	granular,
	grainAmount,
	grainSize,
	grainRange,
	echoDelay,
	// Add more here

	phaserFreq,
	phaserMix,
	phaserFeedback,
	phaserStages,
	invertWave,

	length,
}

export enum LFOEnvelopeTypes {
	sine,
	square,
	triangle,
	sawtooth,
	trapezoid,
	steppedSaw,
	steppedTri,
	length,
}

export enum RandomEnvelopeTypes {
	time,
	pitch,
	note,
	timeSmooth,
	length,
}

export enum SampleLoadingStatus {
	loading,
	loaded,
	error,
}
