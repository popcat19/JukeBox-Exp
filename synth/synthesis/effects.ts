// effects.ts
//
// Purpose: Effects processing chain synthesis source string builder
//
// This module:
// - Builds effects synthesis source strings including distortion, bitcrusher,
//   panning, chorus, echo, reverb, granular, ring modulation, phaser, compressor, comb/flanger, and EQ

import { Config, GranularEnvelopeType } from "../synth-config";

export function buildEffectsSource(
	usesDistortion: boolean,
	usesBitcrusher: boolean,
	usesEqFilter: boolean,
	usesPanning: boolean,
	usesChorus: boolean,
	usesEcho: boolean,
	usesReverb: boolean,
	usesGranular: boolean,
	usesRingModulation: boolean,
	usesPhaser: boolean,
	usesInvertWave: boolean,
	usesCompressor: boolean = false,
	usesCombFlanger: boolean = false,
): string {
	let effectsSource: string =
		"return (synth, outputDataL, outputDataR, bufferIndex, runLength, instrumentState) => {";

	const usesDelays: boolean = usesChorus || usesReverb || usesEcho || usesGranular;

	effectsSource += `
				const tempMonoInstrumentSampleBuffer = synth.tempMonoInstrumentSampleBuffer;
				
				let mixVolume = +instrumentState.mixVolume;
				const mixVolumeDelta = +instrumentState.mixVolumeDelta;
                `;

	if (usesDelays) {
		effectsSource += `
				
				let delayInputMult = +instrumentState.delayInputMult;
				const delayInputMultDelta = +instrumentState.delayInputMultDelta;`;
	}

	if (usesGranular) {
		effectsSource += `
                let granularWet = instrumentState.granularMix;
                const granularMixDelta = instrumentState.granularMixDelta;
                let granularDry = 1.0 - granularWet; 
                const granularDelayLine = instrumentState.granularDelayLine;
                const granularGrains = instrumentState.granularGrains;
                let granularGrainCount = instrumentState.granularGrainsLength;
                const granularDelayLineLength = granularDelayLine.length;
                const granularDelayLineMask = granularDelayLineLength - 1;
                let granularDelayLineIndex = instrumentState.granularDelayLineIndex;
                const usesRandomGrainLocation = instrumentState.usesRandomGrainLocation;
                const computeGrains = instrumentState.computeGrains;
                instrumentState.granularDelayLineDirty = true;
                `;
	}

	if (usesDistortion) {
		effectsSource += `
				
				const distortionBaseVolume = +Config.distortionBaseVolume;
				let distortion = instrumentState.distortion;
				const distortionDelta = instrumentState.distortionDelta;
				let distortionDrive = instrumentState.distortionDrive;
				const distortionDriveDelta = instrumentState.distortionDriveDelta;
				const distortionFractionalResolution = 4.0;
				const distortionOversampleCompensation = distortionBaseVolume / distortionFractionalResolution;
				const distortionFractionalDelay1 = 1.0 / distortionFractionalResolution;
				const distortionFractionalDelay2 = 2.0 / distortionFractionalResolution;
				const distortionFractionalDelay3 = 3.0 / distortionFractionalResolution;
				const distortionFractionalDelayG1 = (1.0 - distortionFractionalDelay1) / (1.0 + distortionFractionalDelay1); // Inlined version of FilterCoefficients.prototype.allPass1stOrderFractionalDelay
				const distortionFractionalDelayG2 = (1.0 - distortionFractionalDelay2) / (1.0 + distortionFractionalDelay2); // Inlined version of FilterCoefficients.prototype.allPass1stOrderFractionalDelay
				const distortionFractionalDelayG3 = (1.0 - distortionFractionalDelay3) / (1.0 + distortionFractionalDelay3); // Inlined version of FilterCoefficients.prototype.allPass1stOrderFractionalDelay
				const distortionNextOutputWeight1 = Math.cos(Math.PI * distortionFractionalDelay1) * 0.5 + 0.5;
				const distortionNextOutputWeight2 = Math.cos(Math.PI * distortionFractionalDelay2) * 0.5 + 0.5;
				const distortionNextOutputWeight3 = Math.cos(Math.PI * distortionFractionalDelay3) * 0.5 + 0.5;
				const distortionPrevOutputWeight1 = 1.0 - distortionNextOutputWeight1;
				const distortionPrevOutputWeight2 = 1.0 - distortionNextOutputWeight2;
				const distortionPrevOutputWeight3 = 1.0 - distortionNextOutputWeight3;
				
				let distortionFractionalInput1 = +instrumentState.distortionFractionalInput1;
				let distortionFractionalInput2 = +instrumentState.distortionFractionalInput2;
				let distortionFractionalInput3 = +instrumentState.distortionFractionalInput3;
				let distortionPrevInput = +instrumentState.distortionPrevInput;
				let distortionNextOutput = +instrumentState.distortionNextOutput;`;
	}

	if (usesBitcrusher) {
		effectsSource += `
				
				let bitcrusherPrevInput = +instrumentState.bitcrusherPrevInput;
				let bitcrusherCurrentOutput = +instrumentState.bitcrusherCurrentOutput;
				let bitcrusherPhase = +instrumentState.bitcrusherPhase;
				let bitcrusherPhaseDelta = +instrumentState.bitcrusherPhaseDelta;
				const bitcrusherPhaseDeltaScale = +instrumentState.bitcrusherPhaseDeltaScale;
				let bitcrusherScale = +instrumentState.bitcrusherScale;
				const bitcrusherScaleScale = +instrumentState.bitcrusherScaleScale;
				let bitcrusherFoldLevel = +instrumentState.bitcrusherFoldLevel;
				const bitcrusherFoldLevelScale = +instrumentState.bitcrusherFoldLevelScale;`;
	}

	if (usesRingModulation) {
		effectsSource += `
				
                let ringModMix = +instrumentState.ringModMix;
                let ringModMixDelta = +instrumentState.ringModMixDelta;
                let ringModPhase = +instrumentState.ringModPhase;
                let ringModPhaseDelta = +instrumentState.ringModPhaseDelta;
                let ringModPhaseDeltaScale = +instrumentState.ringModPhaseDeltaScale;
                let ringModWaveformIndex = +instrumentState.ringModWaveformIndex;
                let ringModMixFade = +instrumentState.ringModMixFade;
                let ringModMixFadeDelta = +instrumentState.ringModMixFadeDelta;
                
                let ringModPulseWidth = +instrumentState.ringModPulseWidth;

                let waveform = Config.operatorWaves[ringModWaveformIndex].samples; 
                if (ringModWaveformIndex == Config.operatorWaves.dictionary['pulse width'].index) {
                    waveform = getOperatorWave(ringModWaveformIndex, ringModPulseWidth).samples;
                }
                const waveformLength = waveform.length - 1;
                `;
	}

	if (usesPhaser) {
		effectsSource += `
                
                const phaserSamples = instrumentState.phaserSamples;
                const phaserPrevInputs = instrumentState.phaserPrevInputs;
                let phaserStages = instrumentState.phaserStages;
                let phaserStagesInt = Math.floor(phaserStages);
                const phaserStagesDelta = instrumentState.phaserStagesDelta;
                const phaserFeedbackMultDelta = +instrumentState.phaserFeedbackMultDelta;
                let phaserFeedbackMult = +instrumentState.phaserFeedbackMult;
                const phaserMixDelta = +instrumentState.phaserMixDelta;
                let phaserMix = +instrumentState.phaserMix;
                const phaserBreakCoefDelta = +instrumentState.phaserBreakCoefDelta;
                let phaserBreakCoef = +instrumentState.phaserBreakCoef;
                `;
	}

	if (usesCompressor) {
		effectsSource += `
                const compressor = instrumentState.compressor;
                `;
	}

	if (usesCombFlanger) {
		effectsSource += `
                const combFlanger = instrumentState.combFlanger;
                `;
	}

	if (usesInvertWave) {
		effectsSource += `
                let isInverted = +instrumentState.invertWave;
                `;
	}

	if (usesEqFilter) {
		effectsSource += `
				
				let filters = instrumentState.eqFilters;
				const filterCount = instrumentState.eqFilterCount|0;
				let initialFilterInput1 = +instrumentState.initialEqFilterInput1;
				let initialFilterInput2 = +instrumentState.initialEqFilterInput2;
				const applyFilters = Synth.applyFilters;`;
	}

	// The eq filter volume is also used to fade out the instrument state, so always include it.
	effectsSource += `
				
				let eqFilterVolume = +instrumentState.eqFilterVolume;
				const eqFilterVolumeDelta = +instrumentState.eqFilterVolumeDelta;`;

	if (usesPanning) {
		effectsSource += `
				
				const panningMask = synth.panningDelayBufferMask >>> 0;
				const panningDelayLine = instrumentState.panningDelayLine;
				let panningDelayPos = instrumentState.panningDelayPos & panningMask;
				let   panningVolumeL      = +instrumentState.panningVolumeL;
				let   panningVolumeR      = +instrumentState.panningVolumeR;
				const panningVolumeDeltaL = +instrumentState.panningVolumeDeltaL;
				const panningVolumeDeltaR = +instrumentState.panningVolumeDeltaR;
				let   panningOffsetL      = +instrumentState.panningOffsetL;
				let   panningOffsetR      = +instrumentState.panningOffsetR;
				const panningOffsetDeltaL = 1.0 - instrumentState.panningOffsetDeltaL;
				const panningOffsetDeltaR = 1.0 - instrumentState.panningOffsetDeltaR;`;
	}

	if (usesChorus) {
		effectsSource += `
				
				const chorusMask = synth.chorusDelayBufferMask >>> 0;
				const chorusDelayLineL = instrumentState.chorusDelayLineL;
				const chorusDelayLineR = instrumentState.chorusDelayLineR;
				instrumentState.chorusDelayLineDirty = true;
				let chorusDelayPos = instrumentState.chorusDelayPos & chorusMask;
				
				let chorusVoiceMult = +instrumentState.chorusVoiceMult;
				const chorusVoiceMultDelta = +instrumentState.chorusVoiceMultDelta;
				let chorusCombinedMult = +instrumentState.chorusCombinedMult;
				const chorusCombinedMultDelta = +instrumentState.chorusCombinedMultDelta;
				
				const chorusDuration = +Config.chorusPeriodSeconds;
				const chorusAngle = Math.PI * 2.0 / (chorusDuration * synth.samplesPerSecond);
				const chorusRange = synth.samplesPerSecond * Config.chorusDelayRange;
				const chorusOffset0 = synth.chorusDelayBufferSize - Config.chorusDelayOffsets[0][0] * chorusRange;
				const chorusOffset1 = synth.chorusDelayBufferSize - Config.chorusDelayOffsets[0][1] * chorusRange;
				const chorusOffset2 = synth.chorusDelayBufferSize - Config.chorusDelayOffsets[0][2] * chorusRange;
				const chorusOffset3 = synth.chorusDelayBufferSize - Config.chorusDelayOffsets[1][0] * chorusRange;
				const chorusOffset4 = synth.chorusDelayBufferSize - Config.chorusDelayOffsets[1][1] * chorusRange;
				const chorusOffset5 = synth.chorusDelayBufferSize - Config.chorusDelayOffsets[1][2] * chorusRange;
				let chorusPhase = instrumentState.chorusPhase % (Math.PI * 2.0);
				let chorusTap0Index = chorusDelayPos + chorusOffset0 - chorusRange * Math.sin(chorusPhase + Config.chorusPhaseOffsets[0][0]);
				let chorusTap1Index = chorusDelayPos + chorusOffset1 - chorusRange * Math.sin(chorusPhase + Config.chorusPhaseOffsets[0][1]);
				let chorusTap2Index = chorusDelayPos + chorusOffset2 - chorusRange * Math.sin(chorusPhase + Config.chorusPhaseOffsets[0][2]);
				let chorusTap3Index = chorusDelayPos + chorusOffset3 - chorusRange * Math.sin(chorusPhase + Config.chorusPhaseOffsets[1][0]);
				let chorusTap4Index = chorusDelayPos + chorusOffset4 - chorusRange * Math.sin(chorusPhase + Config.chorusPhaseOffsets[1][1]);
				let chorusTap5Index = chorusDelayPos + chorusOffset5 - chorusRange * Math.sin(chorusPhase + Config.chorusPhaseOffsets[1][2]);
				chorusPhase += chorusAngle * runLength;
				const chorusTap0End = chorusDelayPos + chorusOffset0 - chorusRange * Math.sin(chorusPhase + Config.chorusPhaseOffsets[0][0]) + runLength;
				const chorusTap1End = chorusDelayPos + chorusOffset1 - chorusRange * Math.sin(chorusPhase + Config.chorusPhaseOffsets[0][1]) + runLength;
				const chorusTap2End = chorusDelayPos + chorusOffset2 - chorusRange * Math.sin(chorusPhase + Config.chorusPhaseOffsets[0][2]) + runLength;
				const chorusTap3End = chorusDelayPos + chorusOffset3 - chorusRange * Math.sin(chorusPhase + Config.chorusPhaseOffsets[1][0]) + runLength;
				const chorusTap4End = chorusDelayPos + chorusOffset4 - chorusRange * Math.sin(chorusPhase + Config.chorusPhaseOffsets[1][1]) + runLength;
				const chorusTap5End = chorusDelayPos + chorusOffset5 - chorusRange * Math.sin(chorusPhase + Config.chorusPhaseOffsets[1][2]) + runLength;
				const chorusTap0Delta = (chorusTap0End - chorusTap0Index) / runLength;
				const chorusTap1Delta = (chorusTap1End - chorusTap1Index) / runLength;
				const chorusTap2Delta = (chorusTap2End - chorusTap2Index) / runLength;
				const chorusTap3Delta = (chorusTap3End - chorusTap3Index) / runLength;
				const chorusTap4Delta = (chorusTap4End - chorusTap4Index) / runLength;
				const chorusTap5Delta = (chorusTap5End - chorusTap5Index) / runLength;`;
	}

	if (usesEcho) {
		effectsSource += `
				let echoMult = +instrumentState.echoMult;
				const echoMultDelta = +instrumentState.echoMultDelta;
				
				const echoDelayLineL = instrumentState.echoDelayLineL;
				const echoDelayLineR = instrumentState.echoDelayLineR;
				const echoMask = (echoDelayLineL.length - 1) >>> 0;
				instrumentState.echoDelayLineDirty = true;
				
				let echoDelayPos = instrumentState.echoDelayPos & echoMask;
				const echoDelayOffsetStart = (echoDelayLineL.length - instrumentState.echoDelayOffsetStart) & echoMask;
				const echoDelayOffsetEnd   = (echoDelayLineL.length - instrumentState.echoDelayOffsetEnd) & echoMask;
				let echoDelayOffsetRatio = +instrumentState.echoDelayOffsetRatio;
				const echoDelayOffsetRatioDelta = +instrumentState.echoDelayOffsetRatioDelta;
				
				const echoShelfA1 = +instrumentState.echoShelfA1;
				const echoShelfB0 = +instrumentState.echoShelfB0;
				const echoShelfB1 = +instrumentState.echoShelfB1;
				let echoShelfSampleL = +instrumentState.echoShelfSampleL;
				let echoShelfSampleR = +instrumentState.echoShelfSampleR;
				let echoShelfPrevInputL = +instrumentState.echoShelfPrevInputL;
				let echoShelfPrevInputR = +instrumentState.echoShelfPrevInputR;`;
	}

	if (usesReverb) {
		// TODO: reverb wet/dry?
		effectsSource += `
				
				const reverbMask = Config.reverbDelayBufferMask >>> 0;
				const reverbDelayLine = instrumentState.reverbDelayLine;
				instrumentState.reverbDelayLineDirty = true;
				let reverbDelayPos = instrumentState.reverbDelayPos & reverbMask;
				
				let reverb = +instrumentState.reverbMult;
				const reverbDelta = +instrumentState.reverbMultDelta;
				
				const reverbShelfA1 = +instrumentState.reverbShelfA1;
				const reverbShelfB0 = +instrumentState.reverbShelfB0;
				const reverbShelfB1 = +instrumentState.reverbShelfB1;
				let reverbShelfSample0 = +instrumentState.reverbShelfSample0;
				let reverbShelfSample1 = +instrumentState.reverbShelfSample1;
				let reverbShelfSample2 = +instrumentState.reverbShelfSample2;
				let reverbShelfSample3 = +instrumentState.reverbShelfSample3;
				let reverbShelfPrevInput0 = +instrumentState.reverbShelfPrevInput0;
				let reverbShelfPrevInput1 = +instrumentState.reverbShelfPrevInput1;
				let reverbShelfPrevInput2 = +instrumentState.reverbShelfPrevInput2;
				let reverbShelfPrevInput3 = +instrumentState.reverbShelfPrevInput3;`;
	}

	effectsSource += `
				
				const stopIndex = bufferIndex + runLength;
            for (let sampleIndex = bufferIndex; sampleIndex < stopIndex; sampleIndex++) {
                    `;

	if (usesGranular) {
		effectsSource += `
                let sample = tempMonoInstrumentSampleBuffer[sampleIndex];
                let granularOutput = 0;
                for (let grainIndex = 0; grainIndex < granularGrainCount; grainIndex++) {
                    const grain = granularGrains[grainIndex];
                    if(computeGrains) {
                        if(grain.delay > 0) {
                            grain.delay--;
                        } else {
                            const grainDelayLinePosition = grain.delayLinePosition;
                            const grainDelayLinePositionInt = grainDelayLinePosition | 0;
                            let grainAgeInSamples = grain.ageInSamples;
                            const grainMaxAgeInSamples = grain.maxAgeInSamples;
                            let grainSample = granularDelayLine[((granularDelayLineIndex + (granularDelayLineLength - grainDelayLinePositionInt))    ) & granularDelayLineMask]; // No interpolation
                            `;
		if (Config.granularEnvelopeType === GranularEnvelopeType.parabolic) {
			effectsSource += `
                                const grainEnvelope = grain.parabolicEnvelopeAmplitude;
                                `;
		} else if (Config.granularEnvelopeType === GranularEnvelopeType.raisedCosineBell) {
			effectsSource += `
                                const grainEnvelope = grain.rcbEnvelopeAmplitude;
                                `;
		}
		effectsSource += `
                            grainSample *= grainEnvelope;
                            granularOutput += grainSample;
                            if (grainAgeInSamples > grainMaxAgeInSamples) {
                                if (granularGrainCount > 0) {
                                    // Faster equivalent of .pop, ignoring the order in the array.
                                    const lastGrainIndex = granularGrainCount - 1;
                                    const lastGrain = granularGrains[lastGrainIndex];
                                    granularGrains[grainIndex] = lastGrain;
                                    granularGrains[lastGrainIndex] = grain;
                                    granularGrainCount--;
                                    grainIndex--;
                                    // ^ Dangerous, since this could end up causing an infinite loop,
                                    // but should be okay in this case.
                                }
                            } else {
                                grainAgeInSamples++;
                            `;
		if (Config.granularEnvelopeType === GranularEnvelopeType.parabolic) {
			// grain.updateParabolicEnvelope();
			// Inlined:
			effectsSource += `
                                    grain.parabolicEnvelopeAmplitude += grain.parabolicEnvelopeSlope;
                                    grain.parabolicEnvelopeSlope += grain.parabolicEnvelopeCurve;
                                    `;
		} else if (Config.granularEnvelopeType === GranularEnvelopeType.raisedCosineBell) {
			effectsSource += `
                                    grain.updateRCBEnvelope();
                                    `;
		}
		effectsSource += `
                                grain.ageInSamples = grainAgeInSamples;
                            }
                        }
                    }
                }
                granularWet += granularMixDelta;
                granularDry -= granularMixDelta;
                granularOutput *= Config.granularOutputLoudnessCompensation;
                granularDelayLine[granularDelayLineIndex] = sample;
                granularDelayLineIndex = (granularDelayLineIndex + 1) & granularDelayLineMask;
                sample = sample * granularDry + granularOutput * granularWet;
                tempMonoInstrumentSampleBuffer[sampleIndex] = 0.0;
                `;
	} else {
		effectsSource += `let sample = tempMonoInstrumentSampleBuffer[sampleIndex];
                tempMonoInstrumentSampleBuffer[sampleIndex] = 0.0;`;
	}

	if (usesInvertWave) {
		effectsSource += `
                    sample = sample*-1;
                `;
	}

	if (usesDistortion) {
		effectsSource += `
					
					const distortionReverse = 1.0 - distortion;
					const distortionNextInput = sample * distortionDrive;
					sample = distortionNextOutput;
					distortionNextOutput = distortionNextInput / (distortionReverse * Math.abs(distortionNextInput) + distortion);
					distortionFractionalInput1 = distortionFractionalDelayG1 * distortionNextInput + distortionPrevInput - distortionFractionalDelayG1 * distortionFractionalInput1;
					distortionFractionalInput2 = distortionFractionalDelayG2 * distortionNextInput + distortionPrevInput - distortionFractionalDelayG2 * distortionFractionalInput2;
					distortionFractionalInput3 = distortionFractionalDelayG3 * distortionNextInput + distortionPrevInput - distortionFractionalDelayG3 * distortionFractionalInput3;
					const distortionOutput1 = distortionFractionalInput1 / (distortionReverse * Math.abs(distortionFractionalInput1) + distortion);
					const distortionOutput2 = distortionFractionalInput2 / (distortionReverse * Math.abs(distortionFractionalInput2) + distortion);
					const distortionOutput3 = distortionFractionalInput3 / (distortionReverse * Math.abs(distortionFractionalInput3) + distortion);
					distortionNextOutput += distortionOutput1 * distortionNextOutputWeight1 + distortionOutput2 * distortionNextOutputWeight2 + distortionOutput3 * distortionNextOutputWeight3;
					sample += distortionOutput1 * distortionPrevOutputWeight1 + distortionOutput2 * distortionPrevOutputWeight2 + distortionOutput3 * distortionPrevOutputWeight3;
					sample *= distortionOversampleCompensation;
					distortionPrevInput = distortionNextInput;
					distortion += distortionDelta;
					distortionDrive += distortionDriveDelta;`;
	}

	if (usesBitcrusher) {
		effectsSource += `
					
					bitcrusherPhase += bitcrusherPhaseDelta;
					if (bitcrusherPhase < 1.0) {
						bitcrusherPrevInput = sample;
						sample = bitcrusherCurrentOutput;
					} else {
						bitcrusherPhase -= (bitcrusherPhase | 0);
						const ratio = bitcrusherPhase / bitcrusherPhaseDelta;
						
						const lerpedInput = sample + (bitcrusherPrevInput - sample) * ratio;
						bitcrusherPrevInput = sample;
						
						const bitcrusherWrapLevel = bitcrusherFoldLevel * 4.0;
						const wrappedSample = (((lerpedInput + bitcrusherFoldLevel) % bitcrusherWrapLevel) + bitcrusherWrapLevel) % bitcrusherWrapLevel;
						const foldedSample = bitcrusherFoldLevel - Math.abs(bitcrusherFoldLevel * 2.0 - wrappedSample);
						const scaledSample = foldedSample / bitcrusherScale;
						const oldValue = bitcrusherCurrentOutput;
						const newValue = (((scaledSample > 0 ? scaledSample + 1 : scaledSample)|0)-.5) * bitcrusherScale;
						
						sample = oldValue + (newValue - oldValue) * ratio;
						bitcrusherCurrentOutput = newValue;
					}
					bitcrusherPhaseDelta *= bitcrusherPhaseDeltaScale;
					bitcrusherScale *= bitcrusherScaleScale;
					bitcrusherFoldLevel *= bitcrusherFoldLevelScale;`;
	}

	if (usesRingModulation) {
		effectsSource += ` 
                
                const ringModOutput = sample * waveform[(ringModPhase*waveformLength)|0];
                const ringModMixF = Math.max(0, ringModMix * ringModMixFade);
                sample = sample * (1 - ringModMixF) + ringModOutput * ringModMixF;

                ringModMix += ringModMixDelta;
                ringModPhase += ringModPhaseDelta;
                ringModPhase -= ringModPhase | 0;
                ringModPhaseDelta *= ringModPhaseDeltaScale;
                ringModMixFade += ringModMixFadeDelta;
                `;
	}

	if (usesPhaser) {
		effectsSource += `
                        const phaserFeedback = phaserSamples[Math.max(0,phaserStagesInt - 1)] * phaserFeedbackMult;
                        for (let stage = 0; stage < phaserStagesInt; stage++) {
                            const phaserInput = stage === 0 ? sample + phaserFeedback : phaserSamples[stage - 1];
                            const phaserPrevInput = phaserPrevInputs[stage];
                            const phaserSample = phaserSamples[stage];
                            const phaserNextOutput = phaserBreakCoef * phaserInput + phaserPrevInput - phaserBreakCoef * phaserSample;
                            phaserPrevInputs[stage] = phaserInput;
                            phaserSamples[stage] = phaserNextOutput;
                        }
                        const phaserOutput = phaserSamples[Math.max(0,phaserStagesInt - 1)];
                        sample = sample + phaserOutput * phaserMix;
                        phaserFeedbackMult += phaserFeedbackMultDelta;
                        phaserBreakCoef += phaserBreakCoefDelta;
                        phaserMix += phaserMixDelta;
                        phaserStages += phaserStagesDelta;
                        /*phaserStagesInt = Math.floor(phaserStages);*/
                    `;
	}

	if (usesCompressor) {
		effectsSource += `
                        sample = compressor.process(sample);
                    `;
	}

	if (usesCombFlanger) {
		effectsSource += `
                        sample = combFlanger.process(sample);
                    `;
	}

	if (usesEqFilter) {
		effectsSource += `
					
					const inputSample = sample;
					sample = applyFilters(inputSample, initialFilterInput1, initialFilterInput2, filterCount, filters);
					initialFilterInput2 = initialFilterInput1;
					initialFilterInput1 = inputSample;`;
	}

	// The eq filter volume is also used to fade out the instrument state, so always include it.
	effectsSource += `
					
					sample *= eqFilterVolume;
					eqFilterVolume += eqFilterVolumeDelta;`;

	if (usesPanning) {
		effectsSource += `
					
					panningDelayLine[panningDelayPos] = sample;
					const panningRatioL  = panningOffsetL - (panningOffsetL | 0);
					const panningRatioR  = panningOffsetR - (panningOffsetR | 0);
					const panningTapLA   = panningDelayLine[(panningOffsetL) & panningMask];
					const panningTapLB   = panningDelayLine[(panningOffsetL + 1) & panningMask];
					const panningTapRA   = panningDelayLine[(panningOffsetR) & panningMask];
					const panningTapRB   = panningDelayLine[(panningOffsetR + 1) & panningMask];
					const panningTapL    = panningTapLA + (panningTapLB - panningTapLA) * panningRatioL;
					const panningTapR    = panningTapRA + (panningTapRB - panningTapRA) * panningRatioR;
					let sampleL = panningTapL * panningVolumeL;
					let sampleR = panningTapR * panningVolumeR;
					panningDelayPos = (panningDelayPos + 1) & panningMask;
					panningVolumeL += panningVolumeDeltaL;
					panningVolumeR += panningVolumeDeltaR;
					panningOffsetL += panningOffsetDeltaL;
					panningOffsetR += panningOffsetDeltaR;`;
	} else {
		effectsSource += `
					
					let sampleL = sample;
					let sampleR = sample;`;
	}

	if (usesChorus) {
		effectsSource += `
					
					const chorusTap0Ratio = chorusTap0Index - (chorusTap0Index | 0);
					const chorusTap1Ratio = chorusTap1Index - (chorusTap1Index | 0);
					const chorusTap2Ratio = chorusTap2Index - (chorusTap2Index | 0);
					const chorusTap3Ratio = chorusTap3Index - (chorusTap3Index | 0);
					const chorusTap4Ratio = chorusTap4Index - (chorusTap4Index | 0);
					const chorusTap5Ratio = chorusTap5Index - (chorusTap5Index | 0);
					const chorusTap0A = chorusDelayLineL[(chorusTap0Index) & chorusMask];
					const chorusTap0B = chorusDelayLineL[(chorusTap0Index + 1) & chorusMask];
					const chorusTap1A = chorusDelayLineL[(chorusTap1Index) & chorusMask];
					const chorusTap1B = chorusDelayLineL[(chorusTap1Index + 1) & chorusMask];
					const chorusTap2A = chorusDelayLineL[(chorusTap2Index) & chorusMask];
					const chorusTap2B = chorusDelayLineL[(chorusTap2Index + 1) & chorusMask];
					const chorusTap3A = chorusDelayLineR[(chorusTap3Index) & chorusMask];
					const chorusTap3B = chorusDelayLineR[(chorusTap3Index + 1) & chorusMask];
					const chorusTap4A = chorusDelayLineR[(chorusTap4Index) & chorusMask];
					const chorusTap4B = chorusDelayLineR[(chorusTap4Index + 1) & chorusMask];
					const chorusTap5A = chorusDelayLineR[(chorusTap5Index) & chorusMask];
					const chorusTap5B = chorusDelayLineR[(chorusTap5Index + 1) & chorusMask];
					const chorusTap0 = chorusTap0A + (chorusTap0B - chorusTap0A) * chorusTap0Ratio;
					const chorusTap1 = chorusTap1A + (chorusTap1B - chorusTap1A) * chorusTap1Ratio;
					const chorusTap2 = chorusTap2A + (chorusTap2B - chorusTap2A) * chorusTap2Ratio;
					const chorusTap3 = chorusTap3A + (chorusTap3B - chorusTap3A) * chorusTap3Ratio;
					const chorusTap4 = chorusTap4A + (chorusTap4B - chorusTap4A) * chorusTap4Ratio;
					const chorusTap5 = chorusTap5A + (chorusTap5B - chorusTap5A) * chorusTap5Ratio;
					chorusDelayLineL[chorusDelayPos] = sampleL * delayInputMult;
					chorusDelayLineR[chorusDelayPos] = sampleR * delayInputMult;
					sampleL = chorusCombinedMult * (sampleL + chorusVoiceMult * (chorusTap1 - chorusTap0 - chorusTap2));
					sampleR = chorusCombinedMult * (sampleR + chorusVoiceMult * (chorusTap4 - chorusTap3 - chorusTap5));
					chorusDelayPos = (chorusDelayPos + 1) & chorusMask;
					chorusTap0Index += chorusTap0Delta;
					chorusTap1Index += chorusTap1Delta;
					chorusTap2Index += chorusTap2Delta;
					chorusTap3Index += chorusTap3Delta;
					chorusTap4Index += chorusTap4Delta;
					chorusTap5Index += chorusTap5Delta;
					chorusVoiceMult += chorusVoiceMultDelta;
					chorusCombinedMult += chorusCombinedMultDelta;`;
	}

	if (usesEcho) {
		effectsSource += `
					
					const echoTapStartIndex = (echoDelayPos + echoDelayOffsetStart) & echoMask;
					const echoTapEndIndex   = (echoDelayPos + echoDelayOffsetEnd  ) & echoMask;
					const echoTapStartL = echoDelayLineL[echoTapStartIndex];
					const echoTapEndL   = echoDelayLineL[echoTapEndIndex];
					const echoTapStartR = echoDelayLineR[echoTapStartIndex];
					const echoTapEndR   = echoDelayLineR[echoTapEndIndex];
					const echoTapL = (echoTapStartL + (echoTapEndL - echoTapStartL) * echoDelayOffsetRatio) * echoMult;
					const echoTapR = (echoTapStartR + (echoTapEndR - echoTapStartR) * echoDelayOffsetRatio) * echoMult;
					
					echoShelfSampleL = echoShelfB0 * echoTapL + echoShelfB1 * echoShelfPrevInputL - echoShelfA1 * echoShelfSampleL;
					echoShelfSampleR = echoShelfB0 * echoTapR + echoShelfB1 * echoShelfPrevInputR - echoShelfA1 * echoShelfSampleR;
					echoShelfPrevInputL = echoTapL;
					echoShelfPrevInputR = echoTapR;
					sampleL += echoShelfSampleL;
					sampleR += echoShelfSampleR;
					
					echoDelayLineL[echoDelayPos] = sampleL * delayInputMult;
					echoDelayLineR[echoDelayPos] = sampleR * delayInputMult;
					echoDelayPos = (echoDelayPos + 1) & echoMask;
					echoDelayOffsetRatio += echoDelayOffsetRatioDelta;
					echoMult += echoMultDelta;
                    `;
	}

	if (usesReverb) {
		effectsSource += `
					
					// Reverb, implemented using a feedback delay network with a Hadamard matrix and lowpass filters.
					// good ratios:    0.555235 + 0.618033 + 0.818 +   1.0 = 2.991268
					// Delay lengths:  3041     + 3385     + 4481  +  5477 = 16384 = 2^14
					// Buffer offsets: 3041    -> 6426   -> 10907 -> 16384
					const reverbDelayPos1 = (reverbDelayPos +  3041) & reverbMask;
					const reverbDelayPos2 = (reverbDelayPos +  6426) & reverbMask;
					const reverbDelayPos3 = (reverbDelayPos + 10907) & reverbMask;
					const reverbSample0 = (reverbDelayLine[reverbDelayPos]);
					const reverbSample1 = reverbDelayLine[reverbDelayPos1];
					const reverbSample2 = reverbDelayLine[reverbDelayPos2];
					const reverbSample3 = reverbDelayLine[reverbDelayPos3];
					const reverbTemp0 = -(reverbSample0 + sampleL) + reverbSample1;
					const reverbTemp1 = -(reverbSample0 + sampleR) - reverbSample1;
					const reverbTemp2 = -reverbSample2 + reverbSample3;
					const reverbTemp3 = -reverbSample2 - reverbSample3;
					const reverbShelfInput0 = (reverbTemp0 + reverbTemp2) * reverb;
					const reverbShelfInput1 = (reverbTemp1 + reverbTemp3) * reverb;
					const reverbShelfInput2 = (reverbTemp0 - reverbTemp2) * reverb;
					const reverbShelfInput3 = (reverbTemp1 - reverbTemp3) * reverb;
					reverbShelfSample0 = reverbShelfB0 * reverbShelfInput0 + reverbShelfB1 * reverbShelfPrevInput0 - reverbShelfA1 * reverbShelfSample0;
					reverbShelfSample1 = reverbShelfB0 * reverbShelfInput1 + reverbShelfB1 * reverbShelfPrevInput1 - reverbShelfA1 * reverbShelfSample1;
					reverbShelfSample2 = reverbShelfB0 * reverbShelfInput2 + reverbShelfB1 * reverbShelfPrevInput2 - reverbShelfA1 * reverbShelfSample2;
					reverbShelfSample3 = reverbShelfB0 * reverbShelfInput3 + reverbShelfB1 * reverbShelfPrevInput3 - reverbShelfA1 * reverbShelfSample3;
					reverbShelfPrevInput0 = reverbShelfInput0;
					reverbShelfPrevInput1 = reverbShelfInput1;
					reverbShelfPrevInput2 = reverbShelfInput2;
					reverbShelfPrevInput3 = reverbShelfInput3;
					reverbDelayLine[reverbDelayPos1] = reverbShelfSample0 * delayInputMult;
					reverbDelayLine[reverbDelayPos2] = reverbShelfSample1 * delayInputMult;
					reverbDelayLine[reverbDelayPos3] = reverbShelfSample2 * delayInputMult;
					reverbDelayLine[reverbDelayPos ] = reverbShelfSample3 * delayInputMult;
					reverbDelayPos = (reverbDelayPos + 1) & reverbMask;
					sampleL += reverbSample1 + reverbSample2 + reverbSample3;
					sampleR += reverbSample0 + reverbSample2 - reverbSample3;
					reverb += reverbDelta;`;
	}

	effectsSource += `
					
					outputDataL[sampleIndex] += sampleL * mixVolume;
					outputDataR[sampleIndex] += sampleR * mixVolume;
					mixVolume += mixVolumeDelta;`;

	if (usesDelays) {
		effectsSource += `
					
					delayInputMult += delayInputMultDelta;`;
	}

	effectsSource += `
				}
				
				instrumentState.mixVolume = mixVolume;
				instrumentState.eqFilterVolume = eqFilterVolume;
				
				// Avoid persistent denormal or NaN values in the delay buffers and filter history.
				const epsilon = (1.0e-24);`;

	if (usesDelays) {
		effectsSource += `
				
				instrumentState.delayInputMult = delayInputMult;`;
	}

	if (usesGranular) {
		effectsSource += `
                    instrumentState.granularMix = granularWet;
                    instrumentState.granularGrainsLength = granularGrainCount;
                    instrumentState.granularDelayLineIndex = granularDelayLineIndex;
                `;
	}

	if (usesDistortion) {
		effectsSource += `
				
				instrumentState.distortion = distortion;
				instrumentState.distortionDrive = distortionDrive;
				
				if (!Number.isFinite(distortionFractionalInput1) || Math.abs(distortionFractionalInput1) < epsilon) distortionFractionalInput1 = 0.0;
				if (!Number.isFinite(distortionFractionalInput2) || Math.abs(distortionFractionalInput2) < epsilon) distortionFractionalInput2 = 0.0;
				if (!Number.isFinite(distortionFractionalInput3) || Math.abs(distortionFractionalInput3) < epsilon) distortionFractionalInput3 = 0.0;
				if (!Number.isFinite(distortionPrevInput) || Math.abs(distortionPrevInput) < epsilon) distortionPrevInput = 0.0;
				if (!Number.isFinite(distortionNextOutput) || Math.abs(distortionNextOutput) < epsilon) distortionNextOutput = 0.0;
				
				instrumentState.distortionFractionalInput1 = distortionFractionalInput1;
				instrumentState.distortionFractionalInput2 = distortionFractionalInput2;
				instrumentState.distortionFractionalInput3 = distortionFractionalInput3;
				instrumentState.distortionPrevInput = distortionPrevInput;
				instrumentState.distortionNextOutput = distortionNextOutput;`;
	}

	if (usesBitcrusher) {
		effectsSource += `
					
				if (Math.abs(bitcrusherPrevInput) < epsilon) bitcrusherPrevInput = 0.0;
				if (Math.abs(bitcrusherCurrentOutput) < epsilon) bitcrusherCurrentOutput = 0.0;
				instrumentState.bitcrusherPrevInput = bitcrusherPrevInput;
				instrumentState.bitcrusherCurrentOutput = bitcrusherCurrentOutput;
				instrumentState.bitcrusherPhase = bitcrusherPhase;
				instrumentState.bitcrusherPhaseDelta = bitcrusherPhaseDelta;
				instrumentState.bitcrusherScale = bitcrusherScale;
				instrumentState.bitcrusherFoldLevel = bitcrusherFoldLevel;`;
	}

	if (usesRingModulation) {
		effectsSource += ` 
                instrumentState.ringModMix = ringModMix;
                instrumentState.ringModMixDelta = ringModMixDelta;
                instrumentState.ringModPhase = ringModPhase;
                instrumentState.ringModPhaseDelta = ringModPhaseDelta;
                instrumentState.ringModPhaseDeltaScale = ringModPhaseDeltaScale;
                instrumentState.ringModWaveformIndex = ringModWaveformIndex;
                instrumentState.ringModPulseWidth = ringModPulseWidth;
                instrumentState.ringModMixFade = ringModMixFade;
                 `;
	}
	if (usesPhaser) {
		effectsSource += `
                
                for (let stage = 0; stage < phaserStages; stage++) {
                    if (!Number.isFinite(phaserPrevInputs[stage]) || Math.abs(phaserPrevInputs[stage]) < epsilon) phaserPrevInputs[stage] = 0.0;
                    if (!Number.isFinite(phaserSamples[stage]) || Math.abs(phaserSamples[stage]) < epsilon) phaserSamples[stage] = 0.0;
                }
                
                instrumentState.phaserMix = phaserMix;
                instrumentState.phaserFeedbackMult = phaserFeedbackMult;
                instrumentState.phaserBreakCoef = phaserBreakCoef;
                `;
	}

	if (usesCompressor) {
		effectsSource += `
                compressor.sanitize();
                `;
	}

	if (usesEqFilter) {
		effectsSource += `
					
				synth.sanitizeFilters(filters);
				// The filter input here is downstream from another filter;
				// sanitize it before use.
				if (!(initialFilterInput1 < 100) || !(initialFilterInput2 < 100)) {
					initialFilterInput1 = 0.0;
					initialFilterInput2 = 0.0;
				}
				if (Math.abs(initialFilterInput1) < epsilon) initialFilterInput1 = 0.0;
				if (Math.abs(initialFilterInput2) < epsilon) initialFilterInput2 = 0.0;
				instrumentState.initialEqFilterInput1 = initialFilterInput1;
				instrumentState.initialEqFilterInput2 = initialFilterInput2;`;
	}

	if (usesPanning) {
		effectsSource += `
				
				Synth.sanitizeDelayLine(panningDelayLine, panningDelayPos, panningMask);
				instrumentState.panningDelayPos = panningDelayPos;
				instrumentState.panningVolumeL = panningVolumeL;
				instrumentState.panningVolumeR = panningVolumeR;
				instrumentState.panningOffsetL = panningOffsetL;
				instrumentState.panningOffsetR = panningOffsetR;`;
	}

	if (usesChorus) {
		effectsSource += `
				
				Synth.sanitizeDelayLine(chorusDelayLineL, chorusDelayPos, chorusMask);
				Synth.sanitizeDelayLine(chorusDelayLineR, chorusDelayPos, chorusMask);
				instrumentState.chorusPhase = chorusPhase;
				instrumentState.chorusDelayPos = chorusDelayPos;
				instrumentState.chorusVoiceMult = chorusVoiceMult;
				instrumentState.chorusCombinedMult = chorusCombinedMult;`;
	}

	if (usesEcho) {
		effectsSource += `
				
				Synth.sanitizeDelayLine(echoDelayLineL, echoDelayPos, echoMask);
				Synth.sanitizeDelayLine(echoDelayLineR, echoDelayPos, echoMask);
				instrumentState.echoDelayPos = echoDelayPos;
				instrumentState.echoMult = echoMult;
				instrumentState.echoDelayOffsetRatio = echoDelayOffsetRatio;
				
				if (!Number.isFinite(echoShelfSampleL) || Math.abs(echoShelfSampleL) < epsilon) echoShelfSampleL = 0.0;
				if (!Number.isFinite(echoShelfSampleR) || Math.abs(echoShelfSampleR) < epsilon) echoShelfSampleR = 0.0;
				if (!Number.isFinite(echoShelfPrevInputL) || Math.abs(echoShelfPrevInputL) < epsilon) echoShelfPrevInputL = 0.0;
				if (!Number.isFinite(echoShelfPrevInputR) || Math.abs(echoShelfPrevInputR) < epsilon) echoShelfPrevInputR = 0.0;
				instrumentState.echoShelfSampleL = echoShelfSampleL;
				instrumentState.echoShelfSampleR = echoShelfSampleR;
				instrumentState.echoShelfPrevInputL = echoShelfPrevInputL;
				instrumentState.echoShelfPrevInputR = echoShelfPrevInputR;`;
	}

	if (usesReverb) {
		effectsSource += `
				
				Synth.sanitizeDelayLine(reverbDelayLine, reverbDelayPos        , reverbMask);
				Synth.sanitizeDelayLine(reverbDelayLine, reverbDelayPos +  3041, reverbMask);
				Synth.sanitizeDelayLine(reverbDelayLine, reverbDelayPos +  6426, reverbMask);
				Synth.sanitizeDelayLine(reverbDelayLine, reverbDelayPos + 10907, reverbMask);
				instrumentState.reverbDelayPos = reverbDelayPos;
				instrumentState.reverbMult = reverb;
				
				if (!Number.isFinite(reverbShelfSample0) || Math.abs(reverbShelfSample0) < epsilon) reverbShelfSample0 = 0.0;
				if (!Number.isFinite(reverbShelfSample1) || Math.abs(reverbShelfSample1) < epsilon) reverbShelfSample1 = 0.0;
				if (!Number.isFinite(reverbShelfSample2) || Math.abs(reverbShelfSample2) < epsilon) reverbShelfSample2 = 0.0;
				if (!Number.isFinite(reverbShelfSample3) || Math.abs(reverbShelfSample3) < epsilon) reverbShelfSample3 = 0.0;
				if (!Number.isFinite(reverbShelfPrevInput0) || Math.abs(reverbShelfPrevInput0) < epsilon) reverbShelfPrevInput0 = 0.0;
				if (!Number.isFinite(reverbShelfPrevInput1) || Math.abs(reverbShelfPrevInput1) < epsilon) reverbShelfPrevInput1 = 0.0;
				if (!Number.isFinite(reverbShelfPrevInput2) || Math.abs(reverbShelfPrevInput2) < epsilon) reverbShelfPrevInput2 = 0.0;
				if (!Number.isFinite(reverbShelfPrevInput3) || Math.abs(reverbShelfPrevInput3) < epsilon) reverbShelfPrevInput3 = 0.0;
				instrumentState.reverbShelfSample0 = reverbShelfSample0;
				instrumentState.reverbShelfSample1 = reverbShelfSample1;
				instrumentState.reverbShelfSample2 = reverbShelfSample2;
				instrumentState.reverbShelfSample3 = reverbShelfSample3;
				instrumentState.reverbShelfPrevInput0 = reverbShelfPrevInput0;
				instrumentState.reverbShelfPrevInput1 = reverbShelfPrevInput1;
				instrumentState.reverbShelfPrevInput2 = reverbShelfPrevInput2;
				instrumentState.reverbShelfPrevInput3 = reverbShelfPrevInput3;`;
	}

	effectsSource += "}";
	return effectsSource;
}
