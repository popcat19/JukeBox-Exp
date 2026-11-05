// Effects Panel
//
// Purpose: Audio effects controls (ring mod, granular, echo, phaser, compressor, comb flanger, etc.)
//
// This module:
// - Creates effect sliders and controls for instruments
// - Groups related effects into container rows
// - Manages effect visibility and state

import { HTML } from "imperative-html/dist/esm/elements-strict";
import { Config } from "../../synth/synth-config";
import {
	ChangeCombDelay,
	ChangeCombDepth,
	ChangeCombFeedback,
	ChangeCombMix,
	ChangeCombRate,
	ChangeCompressorAttack,
	ChangeCompressorRatio,
	ChangeCompressorRelease,
	ChangeCompressorSync,
	ChangeCompressorThreshold,
	ChangeEchoDelay,
	ChangeEchoSustain,
	ChangeGrainAmounts,
	ChangeGrainRange,
	ChangeGrainSize,
	ChangeGranular,
	ChangePhaserFeedback,
	ChangePhaserFreq,
	ChangePhaserMix,
	ChangePhaserStages,
	ChangeRingMod,
	ChangeRingModHz,
	ChangeRingModPulseWidth,
} from "../changes";
import type { SongDocument } from "../song-document";
import { buildOptions, type Slider, SliderNumWidget } from "../ui";

const { div, select, span } = HTML;

export interface EffectRow {
	label: string;
	slider: Slider;
	container: HTMLDivElement;
	onPrompt?: () => void;
}

export interface EffectGroup {
	container: HTMLDivElement;
	rows: EffectRow[];
}

export class EffectsPanel {
	// Ring Mod
	public readonly ringModWidget: SliderNumWidget;
	public readonly ringModSlider: Slider;
	public readonly ringModRow: HTMLDivElement;
	public readonly ringModHzWidget: SliderNumWidget;
	public readonly ringModHzSlider: Slider;
	public readonly ringModHzNum: HTMLParagraphElement;
	public readonly ringModHzSliderRow: HTMLDivElement;
	public readonly ringModWaveSelect: HTMLSelectElement;
	public readonly ringModPulsewidthWidget: SliderNumWidget;
	public readonly ringModPulsewidthSlider: Slider;
	public readonly ringModWaveSelectRow: HTMLDivElement;
	public readonly ringModContainerRow: HTMLDivElement;

	// Granular
	public readonly granularWidget: SliderNumWidget;
	public readonly granularSlider: Slider;
	public readonly granularRow: HTMLDivElement;
	public readonly grainSizeWidget: SliderNumWidget;
	public readonly grainSizeSlider: Slider;
	public readonly grainSizeNum: HTMLParagraphElement;
	public readonly grainSizeSliderRow: HTMLDivElement;
	public readonly grainAmountsWidget: SliderNumWidget;
	public readonly grainAmountsSlider: Slider;
	public readonly grainAmountsRow: HTMLDivElement;
	public readonly grainRangeWidget: SliderNumWidget;
	public readonly grainRangeSlider: Slider;
	public readonly grainRangeNum: HTMLParagraphElement;
	public readonly grainRangeSliderRow: HTMLDivElement;
	public readonly granularContainerRow: HTMLDivElement;

	// Echo
	public readonly echoSustainWidget: SliderNumWidget;
	public readonly echoSustainSlider: Slider;
	public readonly echoSustainRow: HTMLDivElement;
	public readonly echoDelayWidget: SliderNumWidget;
	public readonly echoDelaySlider: Slider;
	public readonly echoDelayRow: HTMLDivElement;

	// Phaser
	public readonly phaserMixWidget: SliderNumWidget;
	public readonly phaserMixSlider: Slider;
	public readonly phaserMixRow: HTMLDivElement;
	public readonly phaserFreqWidget: SliderNumWidget;
	public readonly phaserFreqSlider: Slider;
	public readonly phaserFreqRow: HTMLDivElement;
	public readonly phaserFeedbackWidget: SliderNumWidget;
	public readonly phaserFeedbackSlider: Slider;
	public readonly phaserFeedbackRow: HTMLDivElement;
	public readonly phaserStagesWidget: SliderNumWidget;
	public readonly phaserStagesSlider: Slider;
	public readonly phaserStagesRow: HTMLDivElement;

	// Compressor
	public readonly compressorThresholdWidget: SliderNumWidget;
	public readonly compressorThresholdSlider: Slider;
	public readonly compressorThresholdRow: HTMLDivElement;
	public readonly compressorRatioWidget: SliderNumWidget;
	public readonly compressorRatioSlider: Slider;
	public readonly compressorRatioRow: HTMLDivElement;
	public readonly compressorAttackWidget: SliderNumWidget;
	public readonly compressorAttackSlider: Slider;
	public readonly compressorAttackRow: HTMLDivElement;
	public readonly compressorReleaseWidget: SliderNumWidget;
	public readonly compressorReleaseSlider: Slider;
	public readonly compressorReleaseRow: HTMLDivElement;
	public readonly compressorSyncWidget: SliderNumWidget;
	public readonly compressorSyncSlider: Slider;
	public readonly compressorSyncRow: HTMLDivElement;

	// Comb flanger
	public readonly combDelayWidget: SliderNumWidget;
	public readonly combDelaySlider: Slider;
	public readonly combDelayRow: HTMLDivElement;
	public readonly combFeedbackWidget: SliderNumWidget;
	public readonly combFeedbackSlider: Slider;
	public readonly combFeedbackRow: HTMLDivElement;
	public readonly combMixWidget: SliderNumWidget;
	public readonly combMixSlider: Slider;
	public readonly combMixRow: HTMLDivElement;
	public readonly combRateWidget: SliderNumWidget;
	public readonly combRateSlider: Slider;
	public readonly combRateRow: HTMLDivElement;
	public readonly combDepthWidget: SliderNumWidget;
	public readonly combDepthSlider: Slider;
	public readonly combDepthRow: HTMLDivElement;

	// Container
	public readonly container: HTMLDivElement;

	constructor(doc: SongDocument, onOpenPrompt: (prompt: string) => void) {
		// Ring Mod
		this.ringModWidget = new SliderNumWidget(
			doc,
			(oldValue: number, newValue: number) => new ChangeRingMod(doc, oldValue, newValue),
			0,
			Config.ringModRange - 1,
			0,
			"Ring Mod:",
			() => {
				onOpenPrompt("ringMod");
			},
			{ getInstrumentValue: () => doc.getCurrentInstrumentObj().ringModulation },
		);
		this.ringModSlider = this.ringModWidget.slider;
		this.ringModRow = this.ringModWidget.row;

		this.ringModHzWidget = new SliderNumWidget(
			doc,
			(oldValue: number, newValue: number) => new ChangeRingModHz(doc, oldValue, newValue),
			0,
			Config.ringModHzRange - 1,
			Config.ringModHzRange - Config.ringModHzRange / 2,
			"Hertz:",
			() => {
				onOpenPrompt("RingModHz");
			},
			{
				getInstrumentValue: () => doc.getCurrentInstrumentObj().ringModulationHz,
				midTick: true,
			},
		);
		this.ringModHzSlider = this.ringModHzWidget.slider;
		this.ringModHzNum = div({ style: "font-size: 80%;", id: "ringModHzNum" });
		this.ringModHzSliderRow = this.ringModHzWidget.row;

		this.ringModWaveSelect = buildOptions(
			select({}),
			Config.operatorWaves.map((wave) => wave.name),
		);

		this.ringModPulsewidthWidget = new SliderNumWidget(
			doc,
			(oldValue: number, newValue: number) =>
				new ChangeRingModPulseWidth(doc, oldValue, newValue),
			0,
			Config.pwmOperatorWaves.length - 1,
			0,
			"",
			() => {},
			{
				getInstrumentValue: () => doc.getCurrentInstrumentObj().ringModPulseWidth,
				midTick: true,
				title: "Pulse Width",
			},
		);
		this.ringModPulsewidthSlider = this.ringModPulsewidthWidget.slider;

		this.ringModWaveSelectRow = div(
			{ class: "selectRow", style: "width: 100%;" },
			span(
				{
					class: "tip",
					onclick: () => {
						onOpenPrompt("ringModChipWave");
					},
				},
				"Wave: ",
			),
			this.ringModPulsewidthSlider.container,
			this.ringModPulsewidthWidget.inputBox,
			div({ class: "selectContainer", style: "width:40%;" }, this.ringModWaveSelect),
		);

		this.ringModContainerRow = div(
			{ style: "display:flex; flex-direction:column;" },
			this.ringModRow,
			this.ringModHzSliderRow,
			this.ringModWaveSelectRow,
		);

		// Granular
		this.granularWidget = new SliderNumWidget(
			doc,
			(oldValue: number, newValue: number) => new ChangeGranular(doc, oldValue, newValue),
			0,
			Config.granularRange,
			0,
			"Granular:",
			() => {
				onOpenPrompt("granular");
			},
			{ getInstrumentValue: () => doc.getCurrentInstrumentObj().granular },
		);
		this.granularSlider = this.granularWidget.slider;
		this.granularRow = this.granularWidget.row;

		this.grainSizeWidget = new SliderNumWidget(
			doc,
			(oldValue: number, newValue: number) => new ChangeGrainSize(doc, oldValue, newValue),
			Config.grainSizeMin / Config.grainSizeStep,
			Config.grainSizeMax / Config.grainSizeStep,
			Config.grainSizeMin / Config.grainSizeStep,
			"Grain:",
			() => {
				onOpenPrompt("grainSize");
			},
			{ getInstrumentValue: () => doc.getCurrentInstrumentObj().grainSize },
		);
		this.grainSizeSlider = this.grainSizeWidget.slider;
		this.grainSizeNum = div({ style: "font-size: 80%;", id: "grainSizeNum" });
		this.grainSizeSliderRow = this.grainSizeWidget.row;

		this.grainAmountsWidget = new SliderNumWidget(
			doc,
			(oldValue: number, newValue: number) => new ChangeGrainAmounts(doc, oldValue, newValue),
			0,
			Config.grainAmountsMax,
			8,
			"Grain Freq:",
			() => {
				onOpenPrompt("grainAmount");
			},
			{ getInstrumentValue: () => doc.getCurrentInstrumentObj().grainAmounts },
		);
		this.grainAmountsSlider = this.grainAmountsWidget.slider;
		this.grainAmountsRow = this.grainAmountsWidget.row;

		this.grainRangeWidget = new SliderNumWidget(
			doc,
			(oldValue: number, newValue: number) => new ChangeGrainRange(doc, oldValue, newValue),
			0,
			Config.grainRangeMax / Config.grainSizeStep,
			0,
			"Range:",
			() => {
				onOpenPrompt("grainRange");
			},
			{ getInstrumentValue: () => doc.getCurrentInstrumentObj().grainRange },
		);
		this.grainRangeSlider = this.grainRangeWidget.slider;
		this.grainRangeNum = div({ style: "font-size: 80%;", id: "grainRangeNum" });
		this.grainRangeSliderRow = this.grainRangeWidget.row;

		this.granularContainerRow = div(
			{ style: "display:flex; flex-direction:column;" },
			this.granularRow,
			this.grainAmountsRow,
			this.grainSizeSliderRow,
			this.grainRangeSliderRow,
		);

		// Echo
		this.echoSustainWidget = new SliderNumWidget(
			doc,
			(oldValue: number, newValue: number) => new ChangeEchoSustain(doc, oldValue, newValue),
			0,
			Config.echoSustainRange - 1,
			0,
			"Echo:",
			() => {
				onOpenPrompt("echoSustain");
			},
			{ getInstrumentValue: () => doc.getCurrentInstrumentObj().echoSustain },
		);
		this.echoSustainSlider = this.echoSustainWidget.slider;
		this.echoSustainRow = this.echoSustainWidget.row;

		this.echoDelayWidget = new SliderNumWidget(
			doc,
			(oldValue: number, newValue: number) => new ChangeEchoDelay(doc, oldValue, newValue),
			0,
			Config.echoDelayRange - 1,
			0,
			"Echo Delay:",
			() => {
				onOpenPrompt("echoDelay");
			},
			{ getInstrumentValue: () => doc.getCurrentInstrumentObj().echoDelay },
		);
		this.echoDelaySlider = this.echoDelayWidget.slider;
		this.echoDelayRow = this.echoDelayWidget.row;

		// Phaser
		this.phaserMixWidget = new SliderNumWidget(
			doc,
			(oldValue: number, newValue: number) => new ChangePhaserMix(doc, oldValue, newValue),
			0,
			Config.phaserMixRange - 1,
			0,
			"Phaser Mix:",
			() => {
				onOpenPrompt("phaserMix");
			},
			{ getInstrumentValue: () => doc.getCurrentInstrumentObj().phaserMix },
		);
		this.phaserMixSlider = this.phaserMixWidget.slider;
		this.phaserMixRow = this.phaserMixWidget.row;

		this.phaserFreqWidget = new SliderNumWidget(
			doc,
			(oldValue: number, newValue: number) => new ChangePhaserFreq(doc, oldValue, newValue),
			0,
			Config.phaserFreqRange - 1,
			0,
			"Phaser Freq:",
			() => {
				onOpenPrompt("phaserFreq");
			},
			{ getInstrumentValue: () => doc.getCurrentInstrumentObj().phaserFreq },
		);
		this.phaserFreqSlider = this.phaserFreqWidget.slider;
		this.phaserFreqRow = this.phaserFreqWidget.row;

		this.phaserFeedbackWidget = new SliderNumWidget(
			doc,
			(oldValue: number, newValue: number) =>
				new ChangePhaserFeedback(doc, oldValue, newValue),
			0,
			Config.phaserFeedbackRange - 1,
			0,
			"Phaser Fdbk:",
			() => {
				onOpenPrompt("phaserFeedback");
			},
			{ getInstrumentValue: () => doc.getCurrentInstrumentObj().phaserFeedback },
		);
		this.phaserFeedbackSlider = this.phaserFeedbackWidget.slider;
		this.phaserFeedbackRow = this.phaserFeedbackWidget.row;

		this.phaserStagesWidget = new SliderNumWidget(
			doc,
			(oldValue: number, newValue: number) => new ChangePhaserStages(doc, oldValue, newValue),
			0,
			Config.phaserMaxStages,
			2,
			"Stages:",
			() => {
				onOpenPrompt("phaserStages");
			},
			{ getInstrumentValue: () => doc.getCurrentInstrumentObj().phaserStages },
		);
		this.phaserStagesSlider = this.phaserStagesWidget.slider;
		this.phaserStagesRow = this.phaserStagesWidget.row;

		this.compressorThresholdWidget = new SliderNumWidget(
			doc,
			(oldValue: number, newValue: number) =>
				new ChangeCompressorThreshold(doc, oldValue, newValue),
			0,
			Config.compressorThresholdRange - 1,
			12,
			"Comp Thresh:",
			() => {
				onOpenPrompt("compressorThreshold");
			},
			{ getInstrumentValue: () => doc.getCurrentInstrumentObj().compressorThreshold },
		);
		this.compressorThresholdSlider = this.compressorThresholdWidget.slider;
		this.compressorThresholdRow = this.compressorThresholdWidget.row;

		this.compressorRatioWidget = new SliderNumWidget(
			doc,
			(oldValue: number, newValue: number) =>
				new ChangeCompressorRatio(doc, oldValue, newValue),
			0,
			Config.compressorRatios.length - 1,
			4,
			"Comp Ratio:",
			() => {
				onOpenPrompt("compressorRatio");
			},
			{ getInstrumentValue: () => doc.getCurrentInstrumentObj().compressorRatio },
		);
		this.compressorRatioSlider = this.compressorRatioWidget.slider;
		this.compressorRatioRow = this.compressorRatioWidget.row;

		this.compressorAttackWidget = new SliderNumWidget(
			doc,
			(oldValue: number, newValue: number) =>
				new ChangeCompressorAttack(doc, oldValue, newValue),
			0,
			Config.compressorAttackRange - 1,
			4,
			"Comp Attack:",
			() => {
				onOpenPrompt("compressorAttack");
			},
			{ getInstrumentValue: () => doc.getCurrentInstrumentObj().compressorAttack },
		);
		this.compressorAttackSlider = this.compressorAttackWidget.slider;
		this.compressorAttackRow = this.compressorAttackWidget.row;

		this.compressorReleaseWidget = new SliderNumWidget(
			doc,
			(oldValue: number, newValue: number) =>
				new ChangeCompressorRelease(doc, oldValue, newValue),
			0,
			Config.compressorReleaseRange - 1,
			8,
			"Comp Release:",
			() => {
				onOpenPrompt("compressorRelease");
			},
			{ getInstrumentValue: () => doc.getCurrentInstrumentObj().compressorRelease },
		);
		this.compressorReleaseSlider = this.compressorReleaseWidget.slider;
		this.compressorReleaseRow = this.compressorReleaseWidget.row;

		this.compressorSyncWidget = new SliderNumWidget(
			doc,
			(oldValue: number, newValue: number) =>
				new ChangeCompressorSync(doc, oldValue, newValue),
			0,
			Config.compressorSyncBeats.length - 1,
			0,
			"Comp Pump:",
			() => {
				onOpenPrompt("compressorSync");
			},
			{ getInstrumentValue: () => doc.getCurrentInstrumentObj().compressorSync },
		);
		this.compressorSyncSlider = this.compressorSyncWidget.slider;
		this.compressorSyncRow = this.compressorSyncWidget.row;

		this.combDelayWidget = new SliderNumWidget(
			doc,
			(oldValue: number, newValue: number) => new ChangeCombDelay(doc, oldValue, newValue),
			0,
			Config.combDelayRange - 1,
			10,
			"Comb Delay:",
			() => {
				onOpenPrompt("combDelay");
			},
			{ getInstrumentValue: () => doc.getCurrentInstrumentObj().combDelay },
		);
		this.combDelaySlider = this.combDelayWidget.slider;
		this.combDelayRow = this.combDelayWidget.row;

		this.combFeedbackWidget = new SliderNumWidget(
			doc,
			(oldValue: number, newValue: number) => new ChangeCombFeedback(doc, oldValue, newValue),
			0,
			Config.combFeedbackRange - 1,
			8,
			"Comb Fdbk:",
			() => {
				onOpenPrompt("combFeedback");
			},
			{ getInstrumentValue: () => doc.getCurrentInstrumentObj().combFeedback },
		);
		this.combFeedbackSlider = this.combFeedbackWidget.slider;
		this.combFeedbackRow = this.combFeedbackWidget.row;

		this.combMixWidget = new SliderNumWidget(
			doc,
			(oldValue: number, newValue: number) => new ChangeCombMix(doc, oldValue, newValue),
			0,
			Config.combMixRange - 1,
			8,
			"Comb Mix:",
			() => {
				onOpenPrompt("combMix");
			},
			{ getInstrumentValue: () => doc.getCurrentInstrumentObj().combMix },
		);
		this.combMixSlider = this.combMixWidget.slider;
		this.combMixRow = this.combMixWidget.row;

		this.combRateWidget = new SliderNumWidget(
			doc,
			(oldValue: number, newValue: number) => new ChangeCombRate(doc, oldValue, newValue),
			0,
			Config.combRateRange - 1,
			4,
			"Comb Rate:",
			() => {
				onOpenPrompt("combRate");
			},
			{ getInstrumentValue: () => doc.getCurrentInstrumentObj().combRate },
		);
		this.combRateSlider = this.combRateWidget.slider;
		this.combRateRow = this.combRateWidget.row;

		this.combDepthWidget = new SliderNumWidget(
			doc,
			(oldValue: number, newValue: number) => new ChangeCombDepth(doc, oldValue, newValue),
			0,
			Config.combDepthRange - 1,
			4,
			"Comb Depth:",
			() => {
				onOpenPrompt("combDepth");
			},
			{ getInstrumentValue: () => doc.getCurrentInstrumentObj().combDepth },
		);
		this.combDepthSlider = this.combDepthWidget.slider;
		this.combDepthRow = this.combDepthWidget.row;

		// Main container
		this.container = div(
			{ class: "editor-effects" },
			this.ringModContainerRow,
			this.granularContainerRow,
			this.echoSustainRow,
			this.echoDelayRow,
			this.phaserMixRow,
			this.phaserFreqRow,
			this.phaserFeedbackRow,
			this.phaserStagesRow,
			this.compressorThresholdRow,
			this.compressorRatioRow,
			this.compressorAttackRow,
			this.compressorReleaseRow,
			this.compressorSyncRow,
			this.combDelayRow,
			this.combFeedbackRow,
			this.combMixRow,
			this.combRateRow,
			this.combDepthRow,
		);
	}

	public updateRingMod(value: number): void {
		this.ringModWidget.updateValue(value);
	}

	public updateRingModHz(value: number): void {
		this.ringModHzWidget.updateValue(value);
	}

	public updateGranular(value: number): void {
		this.granularWidget.updateValue(value);
	}

	public updateGrainSize(value: number): void {
		this.grainSizeWidget.updateValue(value);
	}

	public updateGrainAmounts(value: number): void {
		this.grainAmountsWidget.updateValue(value);
	}

	public updateGrainRange(value: number): void {
		this.grainRangeWidget.updateValue(value);
	}

	public updateEchoSustain(value: number): void {
		this.echoSustainWidget.updateValue(value);
	}

	public updateEchoDelay(value: number): void {
		this.echoDelayWidget.updateValue(value);
	}

	public updatePhaserMix(value: number): void {
		this.phaserMixWidget.updateValue(value);
	}

	public updatePhaserFreq(value: number): void {
		this.phaserFreqWidget.updateValue(value);
	}

	public updatePhaserFeedback(value: number): void {
		this.phaserFeedbackWidget.updateValue(value);
	}

	public updatePhaserStages(value: number): void {
		this.phaserStagesWidget.updateValue(value);
	}

	public updateCompressorThreshold(value: number): void {
		this.compressorThresholdWidget.updateValue(value);
	}

	public updateCompressorRatio(value: number): void {
		this.compressorRatioWidget.updateValue(value);
	}

	public updateCompressorAttack(value: number): void {
		this.compressorAttackWidget.updateValue(value);
	}

	public updateCompressorRelease(value: number): void {
		this.compressorReleaseWidget.updateValue(value);
	}

	public updateCompressorSync(value: number): void {
		this.compressorSyncWidget.updateValue(value);
	}

	public updateCombDelay(value: number): void {
		this.combDelayWidget.updateValue(value);
	}

	public updateCombFeedback(value: number): void {
		this.combFeedbackWidget.updateValue(value);
	}

	public updateCombMix(value: number): void {
		this.combMixWidget.updateValue(value);
	}

	public updateCombRate(value: number): void {
		this.combRateWidget.updateValue(value);
	}

	public updateCombDepth(value: number): void {
		this.combDepthWidget.updateValue(value);
	}
}
