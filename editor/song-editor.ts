import { Sizing, Typography } from "./ui/style-constants";
// SongEditor
//
// Purpose: Main editor UI composing all sub-editors and managing editor layout
//
// This module:
// - Assembles pattern, track, and settings editor panels
// - Handles top-level keyboard shortcuts and menu interactions
// - Coordinates editor state refresh on song changes

// Copyright (c) 2012-2022 John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

import { type ChannelColors, ColorConfig } from "../shared/color-config";
import { Config, DropdownID, type SampleLoadedEvent } from "../synth/synth-config";
import { BarScrollBar } from "./components/bar-scroll-bar";
import { Shiggy } from "./components/shiggy-component";
import { EditorConfig, isMobile } from "./config/editor-config";
import type { Change } from "./core/change";
import { registerSongEditorThemeRasterOwner } from "./core/theme-raster-redraw";
import "./ui/layout/layout"; // Imported here for the sake of ensuring this code is transpiled early.
import { HTML, SVG } from "imperative-html/dist/esm/elements-strict";
import { spectrumCanvas } from "../shared/spectrum";
import {
	type Channel,
	getRegisteredPlugins,
	type Instrument,
	InstrumentType,
	type Pattern,
} from "../synth";
import { getInstrumentCapabilities } from "../synth/socket/capability-lookup";
import {
	ChangeArpeggioSpeed,
	ChangeBitcrusherFreq,
	ChangeBitcrusherQuantization,
	ChangeCustomAlgorythmorFeedback,
	ChangeCustomWave,
	ChangeDecimalOffset,
	ChangeDetune,
	ChangeDistortion,
	ChangeEnvelopeSpeed,
	ChangeEQFilterSimpleCut,
	ChangeEQFilterSimplePeak,
	ChangeFeedbackAmplitude,
	ChangeHoldingModRecording,
	ChangeInstrumentType,
	ChangeNoteFilterSimpleCut,
	ChangeNoteFilterSimplePeak,
	ChangePan,
	ChangePanDelay,
	ChangePitchShift,
	ChangePulseWidth,
	ChangeSongTitle,
	ChangeStringSustain,
	ChangeSupersawDynamism,
	ChangeSupersawShape,
	ChangeSupersawSpread,
	ChangeVibratoDelay,
	ChangeVibratoDepth,
	ChangeVibratoSpeed,
	ChangeVolume,
} from "./changes";
import {
	LoopEditor,
	MuteEditor,
	PatternEditor,
	Piano,
	SpectrumEditor,
	TrackEditor,
} from "./components";
import { ChannelRow } from "./components/channel-row";
import { CommandPalette } from "./components/command-palette";
import { EffectsPanel } from "./components/effects-panel";
import { EnvelopeEditor } from "./components/envelope-editor";
import { FadeInOutEditor } from "./components/fade-in-out-editor";
import { FilterEditor } from "./components/filter-editor";
import { HarmonicsEditor } from "./components/harmonics-editor";
import { MenuBar } from "./components/menu-bar";
import { OctaveScrollBar } from "./components/octave-scroll-bar";
import { PlaybackControls } from "./components/playback-controls";
import { SongSettingsPanel } from "./components/song-settings-panel";
import { KeyboardLayout } from "./config/keyboard-layout";
import { ApplicationRouter } from "./core/application-router";
import { ChangeDispatcher } from "./core/change-dispatcher";
import { makeLogger } from "./core/debug-log";
import { DrumsetSetup, type DrumsetSetupHost } from "./core/drumset-setup";
import { EventListenerSetup, type EventListenerSetupHost } from "./core/event-listener-setup";
import { FmOperatorSetup, type FmOperatorSetupHost } from "./core/fm-operator-setup";
import { KeyboardHandler, routeGlobalSlashKey } from "./core/keyboard-handler";
import { MenuHandler, type MenuHandlerHost } from "./core/menu-handler";

const log = makeLogger("song-editor");

import { frameScheduler } from "./core/frame-scheduler";
import { type ModSliderProvider, ModSliderRegistry } from "./core/mod-slider-registry";
import { ModulatorSetup, type ModulatorSetupHost } from "./core/modulator-setup";
import { PlayerAnimator } from "./core/player-animator";
import { getPMDRealtimeHueCoordinator } from "./core/pmd-realtime-hue";
import type { Preferences } from "./core/preferences";
import { type PromptEditorRefs, type PromptHost, PromptManager } from "./core/prompt-manager";

import { MidiInputHandler } from "./io/midi-input";
import { NativePaneFactory } from "./navigator/native-panes";
import { NavigatorDetachedHost } from "./navigator/navigator-detached-host";
import { LegacyPromptPaneFactory } from "./navigator/navigator-route-host";
import { NavigatorRuntime } from "./navigator/navigator-runtime";
import { NavigatorShell } from "./navigator/navigator-shell";
import { getNavigatorRouteAvailability } from "./navigator/route-catalog";
import { CustomChipPrompt } from "./prompts/custom-chip-prompt";
import type { Prompt } from "./prompts/prompt";
import {
	applyInstrumentVisibility,
	type InstrumentVisibilityRefs,
} from "./renderers/instrument-visibility";
import { renderEffectsSelect } from "./renderers/render-effects";
import {
	type InstrumentValueRefs,
	renderInstrumentValues,
} from "./renderers/render-instrument-values";
import { type LayoutRefs, renderLayout } from "./renderers/render-layout";
import {
	type ModSettingsCallbacks,
	type ModSettingsRefs,
	renderModSettings,
} from "./renderers/render-mod-settings";
import { renderOptionsMenu } from "./renderers/render-options-menu";
import { type PostSyncRefs, renderPostBranchSync } from "./renderers/render-post-sync";
import { type PresetSetupRefs, renderPresetSetup } from "./renderers/render-preset-setup";
import { renderSongSettings, type SongSettingsRefs } from "./renderers/render-song-settings";
import { SongDocument } from "./song-document";
import {
	buildHeaderedOptions,
	buildOptions,
	buildPresetButton,
	dropdownButton,
	InputBox,
	iconButton,
	inlineSliderRow,
	numberInput,
	Slider,
	SliderNumWidget,
	setDisabled,
	tipSpan,
	toggleButton,
	valueLabel,
} from "./ui";

const { button, div, input, select, span, optgroup, option, canvas } = HTML;

import { CustomAlgorithmCanvas } from "./rendering/custom-algorithm-canvas";
import { CustomChipCanvas } from "./rendering/custom-chip-canvas";

declare const GIT_HASH: string;
declare const GIT_BRANCH: string;
declare const BUILD_DATE: string;

export class SongEditor
	implements
		ModSliderProvider,
		MenuHandlerHost,
		DrumsetSetupHost,
		FmOperatorSetupHost,
		ModulatorSetupHost,
		EventListenerSetupHost,
		PromptHost,
		PromptEditorRefs
{
	public get prompt(): Prompt | null {
		return this._promptManager.prompt;
	}

	public onLayoutChanged(): void {
		// Dock changes editor padding. Recalculate viewport dimensions so
		// the playhead scroll bounds and visible bar count reflect the new
		// layout even during playback. renderLayout's playback fast path
		// skips getBoundingClientRect, so we compute them here before the
		// call. Also clamp barScrollPos/channelScrollPos against the new
		// viewport size since _validateDocState runs on notifyWatchers
		// which is not called from the dock handler.
		const trackBounds: DOMRect = this._trackVisibleArea.getBoundingClientRect();
		this.doc.trackVisibleBars = Math.floor(
			(trackBounds.right - trackBounds.left - (this.doc.prefs.enableChannelMuting ? 32 : 0)) /
				this.doc.getBarWidth(),
		);
		this.doc.trackVisibleChannels = Math.floor(
			(trackBounds.bottom - trackBounds.top - 30) / ChannelRow.patternHeight,
		);
		this.doc.barScrollPos = Math.min(
			this.doc.barScrollPos,
			Math.max(0, this.doc.song.barCount - this.doc.trackVisibleBars),
		);
		this.doc.channelScrollPos = Math.min(
			this.doc.channelScrollPos,
			Math.max(0, this.doc.song.getChannelCount() - this.doc.trackVisibleChannels),
		);
		renderLayout(this._layoutRefs, this.doc);
		this._promptManager.repositionOutOfBounds();
	}

	public doc: SongDocument = new SongDocument();

	private readonly _keyboardLayout: KeyboardLayout = new KeyboardLayout(this.doc);
	private readonly _keyboardHandler: KeyboardHandler;
	private readonly _dispatch: ChangeDispatcher;
	private readonly _patternEditorPrev: PatternEditor = new PatternEditor(this.doc, false, -1);
	private readonly _patternEditor: PatternEditor = new PatternEditor(this.doc, true, 0);
	private readonly _patternEditorNext: PatternEditor = new PatternEditor(this.doc, false, 1);
	private readonly _trackEditor: TrackEditor = new TrackEditor(this.doc, this);
	private readonly _muteEditor: MuteEditor = new MuteEditor(this.doc, this);
	private readonly _loopEditor: LoopEditor = new LoopEditor(this.doc, this._trackEditor);
	private readonly _piano: Piano = new Piano(this.doc);
	private readonly _octaveScrollBar: OctaveScrollBar = new OctaveScrollBar(this.doc, this._piano);
	private readonly _playbackControls: PlaybackControls = new PlaybackControls(this.doc);
	private readonly _playButton: HTMLButtonElement = this._playbackControls.playButton;
	private readonly _pauseButton: HTMLButtonElement = this._playbackControls.pauseButton;
	private readonly _recordButton: HTMLButtonElement = this._playbackControls.recordButton;
	private readonly _stopButton: HTMLButtonElement = this._playbackControls.stopButton;
	private readonly _prevBarButton: HTMLButtonElement = this._playbackControls.prevBarButton;
	private readonly _nextBarButton: HTMLButtonElement = this._playbackControls.nextBarButton;
	private readonly _volumeSlider: Slider = this._playbackControls.volumeSlider;
	private readonly _volumeBarBox: HTMLDivElement = this._playbackControls.volumeBarBox;
	private readonly _barPosLabel: HTMLSpanElement = this._playbackControls.barPosLabel;
	private readonly _gitStatusLabel: HTMLSpanElement = (() => {
		const el = span({
			style: "font-size: 8px; font-family: monospace; color: var(--secondary-text); white-space: nowrap; line-height: 1.2; display: inline-block;",
		});
		// GIT_HASH/GIT_BRANCH/BUILD_DATE injected by esbuild defines at build time.
		// Falls back to unknown values in dev (no define) or test runners.
		try {
			el.textContent = `${GIT_HASH || "unknown"} / ${GIT_BRANCH || "unknown"} / ${BUILD_DATE || "unknown"}`;
		} catch {
			el.textContent = "unknown / unknown / unknown";
		}
		return el;
	})();
	private readonly _menuBar: MenuBar = new MenuBar();
	private readonly _fileMenu: HTMLSelectElement = this._menuBar.fileMenu;
	private readonly _editMenu: HTMLSelectElement = this._menuBar.editMenu;
	private readonly _optionsMenu: HTMLSelectElement = this._menuBar.optionsMenu;
	private readonly _songSettingsPanel: SongSettingsPanel = new SongSettingsPanel(
		this.doc,
		(prompt: string) => {
			this._openPrompt(prompt);
		},
		(simple: boolean) => {
			this._switchEQFilterType(simple);
		},
	);
	private readonly _scaleSelect: HTMLSelectElement = this._songSettingsPanel.scaleSelect;
	private readonly _keySelect: HTMLSelectElement = this._songSettingsPanel.keySelect;
	private readonly _octaveStepper: HTMLInputElement = this._songSettingsPanel.octaveStepper;
	private readonly _tempoSlider: Slider = this._songSettingsPanel.tempoSlider;
	private readonly _tempoStepper: HTMLInputElement = this._songSettingsPanel.tempoStepper;
	private readonly _songEqFilterEditor: FilterEditor = this._songSettingsPanel.songEqFilterEditor;
	private readonly _songEqFilterZoom: HTMLButtonElement = button(
		{
			class: "zoom-button zoom-button-sm",
			onclick: () => {
				this._openPrompt("customSongEQFilterSettings");
			},
		},
		"+",
	);
	private readonly _chorusSlider: Slider = this._songSettingsPanel.chorusSlider;
	private readonly _chorusRow: HTMLDivElement = this._songSettingsPanel.chorusRow;
	private readonly _chorusInputBox: HTMLInputElement =
		this._songSettingsPanel.chorusWidget.inputBox;
	private readonly _reverbSlider: Slider = this._songSettingsPanel.reverbSlider;
	private readonly _reverbRow: HTMLDivElement = this._songSettingsPanel.reverbRow;
	private readonly _reverbInputBox: HTMLInputElement =
		this._songSettingsPanel.reverbWidget.inputBox;
	private readonly _effectsPanel: EffectsPanel = new EffectsPanel(this.doc, (prompt: string) => {
		this._openPrompt(prompt);
	});
	private readonly _ringModWaveSelect: HTMLSelectElement = this._effectsPanel.ringModWaveSelect;
	private readonly _ringModPulsewidthSlider: Slider = this._effectsPanel.ringModPulsewidthSlider;
	private readonly _ringModPulsewidthInputBox: HTMLInputElement =
		this._effectsPanel.ringModPulsewidthWidget.inputBox;
	private readonly _ringModSlider: Slider = this._effectsPanel.ringModSlider;
	private readonly _ringModInputBox: HTMLInputElement = this._effectsPanel.ringModWidget.inputBox;
	private readonly _ringModHzSlider: Slider = this._effectsPanel.ringModHzSlider;
	private readonly _ringModHzInputBox: HTMLInputElement =
		this._effectsPanel.ringModHzWidget.inputBox;
	public readonly ringModHzNum: HTMLParagraphElement = this._effectsPanel.ringModHzNum;
	private readonly _ringModWaveText: HTMLSpanElement = span(
		{
			class: "tip",
			onclick: () => {
				this._openPrompt("ringModChipWave");
			},
		},
		"Wave: ",
	);
	private readonly _ringModContainerRow: HTMLDivElement = this._effectsPanel.ringModContainerRow;
	private readonly _granularSlider: Slider = this._effectsPanel.granularSlider;
	private readonly _granularInputBox: HTMLInputElement =
		this._effectsPanel.granularWidget.inputBox;
	private readonly _grainSizeSlider: Slider = this._effectsPanel.grainSizeSlider;
	private readonly _grainSizeInputBox: HTMLInputElement =
		this._effectsPanel.grainSizeWidget.inputBox;
	public readonly grainSizeNum: HTMLParagraphElement = this._effectsPanel.grainSizeNum;
	private readonly _grainAmountsSlider: Slider = this._effectsPanel.grainAmountsSlider;
	private readonly _grainAmountsInputBox: HTMLInputElement =
		this._effectsPanel.grainAmountsWidget.inputBox;
	private readonly _grainRangeSlider: Slider = this._effectsPanel.grainRangeSlider;
	private readonly _grainRangeInputBox: HTMLInputElement =
		this._effectsPanel.grainRangeWidget.inputBox;
	public readonly grainRangeNum: HTMLParagraphElement = this._effectsPanel.grainRangeNum;
	private readonly _granularContainerRow: HTMLDivElement =
		this._effectsPanel.granularContainerRow;
	private readonly _echoSustainSlider: Slider = this._effectsPanel.echoSustainSlider;
	private readonly _echoSustainRow: HTMLDivElement = this._effectsPanel.echoSustainRow;
	private readonly _echoSustainInputBox: HTMLInputElement =
		this._effectsPanel.echoSustainWidget.inputBox;
	private readonly _echoDelaySlider: Slider = this._effectsPanel.echoDelaySlider;
	private readonly _echoDelayRow: HTMLDivElement = this._effectsPanel.echoDelayRow;
	private readonly _echoDelayInputBox: HTMLInputElement =
		this._effectsPanel.echoDelayWidget.inputBox;
	private readonly _phaserMixSlider: Slider = this._effectsPanel.phaserMixSlider;
	private readonly _phaserMixRow: HTMLDivElement = this._effectsPanel.phaserMixRow;
	private readonly _phaserMixInputBox: HTMLInputElement =
		this._effectsPanel.phaserMixWidget.inputBox;
	private readonly _phaserFreqSlider: Slider = this._effectsPanel.phaserFreqSlider;
	private readonly _phaserFreqRow: HTMLDivElement = this._effectsPanel.phaserFreqRow;
	private readonly _phaserFreqInputBox: HTMLInputElement =
		this._effectsPanel.phaserFreqWidget.inputBox;
	private readonly _phaserFeedbackSlider: Slider = this._effectsPanel.phaserFeedbackSlider;
	private readonly _phaserFeedbackRow: HTMLDivElement = this._effectsPanel.phaserFeedbackRow;
	private readonly _phaserFeedbackInputBox: HTMLInputElement =
		this._effectsPanel.phaserFeedbackWidget.inputBox;
	private readonly _phaserStagesSlider: Slider = this._effectsPanel.phaserStagesSlider;
	private readonly _phaserStagesRow: HTMLDivElement = this._effectsPanel.phaserStagesRow;
	private readonly _phaserStagesInputBox: HTMLInputElement =
		this._effectsPanel.phaserStagesWidget.inputBox;
	private readonly _compressorThresholdSlider: Slider =
		this._effectsPanel.compressorThresholdSlider;
	private readonly _compressorThresholdRow: HTMLDivElement =
		this._effectsPanel.compressorThresholdRow;
	private readonly _compressorThresholdInputBox: HTMLInputElement =
		this._effectsPanel.compressorThresholdWidget.inputBox;
	private readonly _compressorRatioSlider: Slider = this._effectsPanel.compressorRatioSlider;
	private readonly _compressorRatioRow: HTMLDivElement = this._effectsPanel.compressorRatioRow;
	private readonly _compressorRatioInputBox: HTMLInputElement =
		this._effectsPanel.compressorRatioWidget.inputBox;
	private readonly _compressorAttackSlider: Slider = this._effectsPanel.compressorAttackSlider;
	private readonly _compressorAttackRow: HTMLDivElement = this._effectsPanel.compressorAttackRow;
	private readonly _compressorAttackInputBox: HTMLInputElement =
		this._effectsPanel.compressorAttackWidget.inputBox;
	private readonly _compressorReleaseSlider: Slider = this._effectsPanel.compressorReleaseSlider;
	private readonly _compressorReleaseRow: HTMLDivElement =
		this._effectsPanel.compressorReleaseRow;
	private readonly _compressorReleaseInputBox: HTMLInputElement =
		this._effectsPanel.compressorReleaseWidget.inputBox;
	private readonly _compressorSyncSlider: Slider = this._effectsPanel.compressorSyncSlider;
	private readonly _compressorSyncRow: HTMLDivElement = this._effectsPanel.compressorSyncRow;
	private readonly _compressorSyncInputBox: HTMLInputElement =
		this._effectsPanel.compressorSyncWidget.inputBox;
	private readonly _combDelaySlider: Slider = this._effectsPanel.combDelaySlider;
	private readonly _combDelayRow: HTMLDivElement = this._effectsPanel.combDelayRow;
	private readonly _combDelayInputBox: HTMLInputElement =
		this._effectsPanel.combDelayWidget.inputBox;
	private readonly _combFeedbackSlider: Slider = this._effectsPanel.combFeedbackSlider;
	private readonly _combFeedbackRow: HTMLDivElement = this._effectsPanel.combFeedbackRow;
	private readonly _combFeedbackInputBox: HTMLInputElement =
		this._effectsPanel.combFeedbackWidget.inputBox;
	private readonly _combMixSlider: Slider = this._effectsPanel.combMixSlider;
	private readonly _combMixRow: HTMLDivElement = this._effectsPanel.combMixRow;
	private readonly _combMixInputBox: HTMLInputElement = this._effectsPanel.combMixWidget.inputBox;
	private readonly _combRateSlider: Slider = this._effectsPanel.combRateSlider;
	private readonly _combRateRow: HTMLDivElement = this._effectsPanel.combRateRow;
	private readonly _combRateInputBox: HTMLInputElement =
		this._effectsPanel.combRateWidget.inputBox;
	private readonly _combDepthSlider: Slider = this._effectsPanel.combDepthSlider;
	private readonly _combDepthRow: HTMLDivElement = this._effectsPanel.combDepthRow;
	private readonly _combDepthInputBox: HTMLInputElement =
		this._effectsPanel.combDepthWidget.inputBox;
	private readonly _rhythmSelect: HTMLSelectElement = this._songSettingsPanel.rhythmSelect;
	private readonly _pitchedPresetSelect: HTMLButtonElement = (() => {
		const btn = buildPresetButton("pitchPresetSelect");
		btn.addEventListener("click", () => {
			this.openPresetSelector();
		});
		return btn;
	})();
	private readonly _drumPresetSelect: HTMLButtonElement = (() => {
		const btn = buildPresetButton("drumPresetSelect");
		btn.addEventListener("click", () => {
			this.openPresetSelector();
		});
		return btn;
	})();
	private readonly _algorithmSelect: HTMLSelectElement = buildOptions(
		select(),
		Config.algorithms.map((algorithm) => algorithm.name),
	);
	private readonly _algorithmSelectRow: HTMLDivElement = div(
		{ class: "selectRow" },
		tipSpan("Algorithm: ", () => {
			this._openPrompt("algorithm");
		}),
		div({ class: "selectContainer" }, this._algorithmSelect),
	);
	private readonly _instrumentButtons: HTMLButtonElement[] = [];
	private readonly _instrumentAddButton: HTMLButtonElement = button({
		type: "button",
		class: "add-instrument last-button",
	});
	private readonly _instrumentRemoveButton: HTMLButtonElement = button({
		type: "button",
		class: "remove-instrument",
	});
	private readonly _instrumentsButtonBar: HTMLDivElement = div(
		{ class: "instrument-bar" },
		this._instrumentRemoveButton,
		this._instrumentAddButton,
	);
	private readonly _instrumentsButtonRow: HTMLDivElement = div(
		{ class: "selectRow", style: "display: none;" },
		tipSpan("Instrument:", () => {
			this._openPrompt("instrumentIndex");
		}),
		this._instrumentsButtonBar,
	);
	private readonly _instrumentVolumeWidget: SliderNumWidget = new SliderNumWidget(
		this.doc,
		(oldValue: number, newValue: number) => new ChangeVolume(this.doc, oldValue, newValue),
		Math.floor(-Config.volumeRange / 2),
		Math.floor(Config.volumeRange / 2),
		0,
		"Volume:",
		() => {
			this._openPrompt("instrumentVolume");
		},
		{ midTick: true, getInstrumentValue: () => this.doc.getCurrentInstrumentObj().volume },
	);
	private readonly _panDropdown: HTMLButtonElement = dropdownButton({
		onclick: () => {
			this._toggleDropdownMenu(DropdownID.Pan);
		},
	});
	private readonly _panWidget: SliderNumWidget = new SliderNumWidget(
		this.doc,
		(oldValue: number, newValue: number) => new ChangePan(this.doc, oldValue, newValue),
		0,
		Config.panMax,
		Config.panCenter,
		"Pan:",
		() => {
			this._openPrompt("pan");
		},
		{
			midTick: true,
			dropdown: this._panDropdown,
			getInstrumentValue: () => this.doc.getCurrentInstrumentObj().pan,
		},
	);
	private readonly _panDelayWidget: SliderNumWidget = new SliderNumWidget(
		this.doc,
		(oldValue: number, newValue: number) => new ChangePanDelay(this.doc, oldValue, newValue),
		0,
		Config.modulators.dictionary["pan delay"].maxRawVol,
		0,
		"‣ Delay:",
		() => {
			this._openPrompt("panDelay");
		},
		{ getInstrumentValue: () => this.doc.getCurrentInstrumentObj().panDelay },
	);
	private readonly _panDropdownGroup: HTMLElement = div(
		{ class: "editor-controls", style: "display: none;" },
		this._panDelayWidget.row,
	);
	private readonly _chipWaveSelect: HTMLSelectElement = buildOptions(
		select(),
		Config.chipWaves.map((wave) => wave.name),
	);
	private readonly _chipNoiseSelect: HTMLSelectElement = buildOptions(
		select(),
		Config.chipNoises.map((wave) => wave.name),
	);
	// advloop addition
	// @TODO: Add a dropdown for these. Or maybe this checkbox is fine?
	private readonly _useChipWaveAdvancedLoopControlsBox = input({
		type: "checkbox",
		class: "select-row-checkbox-spaced",
	});
	private readonly _chipWaveLoopModeSelect = buildOptions(select(), [
		"Loop",
		"Ping-Pong",
		"Play Once",
		"Play Loop Once",
	]);
	private readonly _chipWaveLoopStartStepper = numberInput({
		type: "number",
		min: "0",
		step: "1",
		value: "0",
		class: "stepper-input",
	});
	private readonly _chipWaveLoopEndStepper = numberInput({
		type: "number",
		min: "0",
		step: "1",
		value: "0",
		class: "stepper-input",
	});
	private readonly _setChipWaveLoopEndToEndButton = button(
		{ type: "button", style: "width: 1.5em; height: 1.5em; padding: 0; margin-left: 0.5em;" },
		SVG.svg(
			{
				width: "16",
				height: "16",
				viewBox: "0 0 24 24",
				"pointer-events": "none",
				style: "width: 100%; height: 100%;",
			},
			SVG.path({
				d: "M3 5v14a1 1 0 0 0 1.504 .864l12 -7a1 1 0 0 0 0 -1.728l-12 -7a1 1 0 0 0 -1.504 .864z",
				fill: ColorConfig.primaryText,
			}),
			SVG.path({
				d: "M20 4a1 1 0 0 1 .993 .883l.007 .117v14a1 1 0 0 1 -1.993 .117l-.007 -.117v-14a1 1 0 0 1 1 -1z",
				fill: ColorConfig.primaryText,
			}),
		),
	);
	private readonly _chipWaveStartOffsetStepper = numberInput({
		type: "number",
		min: "0",
		step: "1",
		value: "0",
		class: "stepper-input",
	});
	private readonly _chipWavePlayBackwardsBox = input({
		type: "checkbox",
		class: "select-row-checkbox-spaced",
	});
	// advloop addition
	private readonly _chipWaveSelectRow: HTMLDivElement = div(
		{ class: "selectRow" },
		tipSpan("Wave: ", () => {
			this._openPrompt("chipWave");
		}),
		div({ class: "selectContainer" }, this._chipWaveSelect),
	);
	private readonly _chipNoiseSelectRow: HTMLDivElement = div(
		{ class: "selectRow" },
		tipSpan("Noise: ", () => {
			this._openPrompt("chipNoise");
		}),
		div({ class: "selectContainer" }, this._chipNoiseSelect),
	);
	private readonly _visualLoopControlsButton: HTMLButtonElement = button(
		{
			style: "margin-left: 0em; padding-left: 0.2em; height: 1.5em; max-width: 12px;",
			onclick: () => {
				this._openPrompt("visualLoopControls");
			},
		},
		"+",
	);
	private readonly _useChipWaveAdvancedLoopControlsRow: HTMLDivElement = div(
		{ class: "selectRow" },
		tipSpan(
			"Loop Controls: ",
			() => {
				this._openPrompt("loopControls");
			},
			{
				style: "flex-shrink: 0;",
			},
		),
		this._useChipWaveAdvancedLoopControlsBox,
	);
	private readonly _chipWaveLoopModeSelectRow = div(
		{ class: "selectRow" },
		tipSpan(
			"Loop Mode: ",
			() => {
				this._openPrompt("loopMode");
			},
			{ class: "tip-xs" },
		),
		div({ class: "selectContainer" }, this._chipWaveLoopModeSelect),
	);
	private readonly _chipWaveLoopStartRow = div(
		{ class: "selectRow" },
		tipSpan(
			"Loop Start: ",
			() => {
				this._openPrompt("loopStart");
			},
			{ class: "tip-xs" },
		),
		this._visualLoopControlsButton,
		span({ class: "stepper-group" }, this._chipWaveLoopStartStepper),
	);
	private readonly _chipWaveLoopEndRow = div(
		{ class: "selectRow" },
		tipSpan(
			"Loop End: ",
			() => {
				this._openPrompt("loopEnd");
			},
			{ class: "tip-xs" },
		),
		span(
			{ class: "stepper-group" },
			this._chipWaveLoopEndStepper,
			this._setChipWaveLoopEndToEndButton,
		),
	);
	private readonly _chipWaveStartOffsetRow = div(
		{ class: "selectRow" },
		tipSpan("Offset: ", () => {
			this._openPrompt("offset");
		}),
		span({ class: "stepper-group" }, this._chipWaveStartOffsetStepper),
	);
	private readonly _chipWavePlayBackwardsRow = div(
		{ class: "selectRow" },
		tipSpan("Backwards: ", () => {
			this._openPrompt("backwards");
		}),
		this._chipWavePlayBackwardsBox,
	);
	private readonly _fadeInOutEditor: FadeInOutEditor = new FadeInOutEditor(this.doc);
	private readonly _fadeInOutRow: HTMLElement = div(
		{ class: "selectRow" },
		tipSpan("Fade:", () => {
			this._openPrompt("fadeInOut");
		}),
		this._fadeInOutEditor.container,
	);
	private readonly _transitionSelect: HTMLSelectElement = buildOptions(
		select(),
		Config.transitions.map((transition) => transition.name),
	);
	private readonly _transitionDropdown: HTMLButtonElement = dropdownButton({
		onclick: () => {
			this._toggleDropdownMenu(DropdownID.Transition);
		},
	});
	private readonly _transitionRow: HTMLDivElement = div(
		{ class: "selectRow" },
		tipSpan("Transition:", () => {
			this._openPrompt("transition");
		}),
		this._transitionDropdown,
		div({ class: "selectContainer", style: "width: 52.5%;" }, this._transitionSelect),
	);
	private readonly _clicklessTransitionBox: HTMLInputElement = input({
		type: "checkbox",
		class: "select-row-checkbox-narrow",
	});
	private readonly _clicklessTransitionRow: HTMLElement = div(
		{ class: "selectRow dropFader" },
		tipSpan(
			"‣ Clickless:",
			() => {
				this._openPrompt("clicklessTransition");
			},
			{ class: "tip-indent-sm" },
		),
		this._clicklessTransitionBox,
	);
	private readonly _transitionDropdownGroup: HTMLElement = div(
		{ class: "editor-controls", style: "display: none;" },
		this._clicklessTransitionRow,
	);

	private readonly _effectsSelect: HTMLSelectElement = select(
		option({ selected: true, disabled: true, hidden: false }),
	); // todo: "hidden" should be true but looks wrong on mac chrome, adds checkmark next to first visible option even though it's not selected.
	private readonly _eqFilterToggle = toggleButton(["simple", "advanced"], (index: 0 | 1) => {
		this._switchEQFilterType(index === 0);
	});
	private readonly _eqFilterSimpleButton: HTMLButtonElement = this._eqFilterToggle.buttons[0];
	private readonly _eqFilterAdvancedButton: HTMLButtonElement = this._eqFilterToggle.buttons[1];
	private readonly _eqFilterTypeRow: HTMLElement = div(
		{ class: "selectRow filter-type-row" },
		tipSpan(
			"EQ Filt.Type:",
			() => {
				this._openPrompt("filterType");
			},
			{ class: "tip-xs" },
		),
		this._eqFilterToggle.container,
	);
	private readonly _eqFilterEditor: FilterEditor = new FilterEditor(this.doc);
	private readonly _eqFilterZoom: HTMLButtonElement = button(
		{
			class: "zoom-button zoom-button-sm",
			onclick: () => {
				this._openPrompt("customEQFilterSettings");
			},
		},
		"+",
	);
	private readonly _eqFilterRow: HTMLElement = div(
		{ class: "selectRow" },
		tipSpan("EQ Filt:", () => {
			this._openPrompt("eqFilter");
		}),
		this._eqFilterZoom,
		this._eqFilterEditor.container,
	);
	private readonly _eqFilterSimpleCutWidget: SliderNumWidget = new SliderNumWidget(
		this.doc,
		(oldValue: number, newValue: number) =>
			new ChangeEQFilterSimpleCut(this.doc, oldValue, newValue),
		0,
		Config.filterSimpleCutRange - 1,
		6,
		"Filter Cut:",
		() => {
			this._openPrompt("filterCutoff");
		},
		{ getInstrumentValue: () => this.doc.getCurrentInstrumentObj().eqFilterSimpleCut },
	);
	private readonly _eqFilterSimplePeakWidget: SliderNumWidget = new SliderNumWidget(
		this.doc,
		(oldValue: number, newValue: number) =>
			new ChangeEQFilterSimplePeak(this.doc, oldValue, newValue),
		0,
		Config.filterSimplePeakRange - 1,
		6,
		"Filter Peak:",
		() => {
			this._openPrompt("filterResonance");
		},
		{ getInstrumentValue: () => this.doc.getCurrentInstrumentObj().eqFilterSimplePeak },
	);

	private readonly _noteFilterToggle = toggleButton(["simple", "advanced"], (index: 0 | 1) => {
		this._switchNoteFilterType(index === 0);
	});
	private readonly _noteFilterSimpleButton: HTMLButtonElement = this._noteFilterToggle.buttons[0];
	private readonly _noteFilterAdvancedButton: HTMLButtonElement =
		this._noteFilterToggle.buttons[1];
	private readonly _noteFilterTypeRow: HTMLElement = div(
		{ class: "selectRow filter-type-row" },
		tipSpan(
			"Note Filt.Type:",
			() => {
				this._openPrompt("filterType");
			},
			{ class: "tip-xs" },
		),
		this._noteFilterToggle.container,
	);
	private readonly _noteFilterEditor: FilterEditor = new FilterEditor(this.doc, true);
	private readonly _noteFilterZoom: HTMLButtonElement = button(
		{
			class: "zoom-button zoom-button-sm",
			onclick: () => {
				this._openPrompt("customNoteFilterSettings");
			},
		},
		"+",
	);
	private readonly _noteFilterRow: HTMLElement = div(
		{ class: "selectRow" },
		tipSpan("Note Filt:", () => {
			this._openPrompt("noteFilter");
		}),
		this._noteFilterZoom,
		this._noteFilterEditor.container,
	);
	private readonly _noteFilterSimpleCutWidget: SliderNumWidget = new SliderNumWidget(
		this.doc,
		(oldValue: number, newValue: number) =>
			new ChangeNoteFilterSimpleCut(this.doc, oldValue, newValue),
		0,
		Config.filterSimpleCutRange - 1,
		6,
		"Filter Cut:",
		() => {
			this._openPrompt("filterCutoff");
		},
		{ getInstrumentValue: () => this.doc.getCurrentInstrumentObj().noteFilterSimpleCut },
	);
	private readonly _noteFilterSimplePeakWidget: SliderNumWidget = new SliderNumWidget(
		this.doc,
		(oldValue: number, newValue: number) =>
			new ChangeNoteFilterSimplePeak(this.doc, oldValue, newValue),
		0,
		Config.filterSimplePeakRange - 1,
		6,
		"Filter Peak:",
		() => {
			this._openPrompt("filterResonance");
		},
		{ getInstrumentValue: () => this.doc.getCurrentInstrumentObj().noteFilterSimplePeak },
	);

	private readonly _supersawDynamismWidget: SliderNumWidget = new SliderNumWidget(
		this.doc,
		(oldValue: number, newValue: number) =>
			new ChangeSupersawDynamism(this.doc, oldValue, newValue),
		0,
		Config.supersawDynamismMax,
		0,
		"Dynamism:",
		() => {
			this._openPrompt("supersawDynamism");
		},
		{ getInstrumentValue: () => this.doc.getCurrentInstrumentObj().supersawDynamism },
	);
	private readonly _supersawSpreadWidget: SliderNumWidget = new SliderNumWidget(
		this.doc,
		(oldValue: number, newValue: number) =>
			new ChangeSupersawSpread(this.doc, oldValue, newValue),
		0,
		Config.supersawSpreadMax,
		0,
		"Spread:",
		() => {
			this._openPrompt("supersawSpread");
		},
		{ getInstrumentValue: () => this.doc.getCurrentInstrumentObj().supersawSpread },
	);
	private readonly _supersawShapeWidget: SliderNumWidget = new SliderNumWidget(
		this.doc,
		(oldValue: number, newValue: number) =>
			new ChangeSupersawShape(this.doc, oldValue, newValue),
		0,
		Config.supersawShapeMax,
		0,
		"Saw/Pulse:",
		() => {
			this._openPrompt("supersawShape");
		},
		{ getInstrumentValue: () => this.doc.getCurrentInstrumentObj().supersawShape },
	);

	private readonly _pulseWidthDropdown: HTMLButtonElement = dropdownButton({
		style: "margin-right: 5px;",
		onclick: () => {
			this._toggleDropdownMenu(DropdownID.PulseWidth);
		},
	});
	private readonly _pulseWidthWidget: SliderNumWidget = new SliderNumWidget(
		this.doc,
		(oldValue: number, newValue: number) => new ChangePulseWidth(this.doc, oldValue, newValue),
		1,
		Config.pulseWidthRange,
		1,
		"Pulse W.:",
		() => {
			this._openPrompt("pulseWidth");
		},
		{
			dropdown: this._pulseWidthDropdown,
			getInstrumentValue: () => this.doc.getCurrentInstrumentObj().pulseWidth,
		},
	);
	private readonly _decimalOffsetWidget: SliderNumWidget = new SliderNumWidget(
		this.doc,
		(oldValue: number, newValue: number) =>
			new ChangeDecimalOffset(this.doc, oldValue, 99 - newValue),
		0,
		99,
		0,
		"‣ Offset:",
		() => {
			this._openPrompt("decimalOffset");
		},
		{
			getInstrumentValue: () => 99 - this.doc.getCurrentInstrumentObj().decimalOffset,
		},
	);
	private readonly _pulseWidthDropdownGroup: HTMLElement = div(
		{ class: "editor-controls", style: "display: none;" },
		this._decimalOffsetWidget.row,
	);

	private readonly _pitchShiftWidget: SliderNumWidget = new SliderNumWidget(
		this.doc,
		(oldValue: number, newValue: number) => new ChangePitchShift(this.doc, oldValue, newValue),
		0,
		Config.pitchShiftRange - 1,
		0,
		"Pitch Shift:",
		() => {
			this._openPrompt("pitchShift");
		},
		{
			midTick: true,
			getInstrumentValue: () => this.doc.getCurrentInstrumentObj().pitchShift,
		},
	);
	private readonly _pitchShiftTonicMarkers: HTMLDivElement[] = [
		div({ class: "pitchShiftMarker", style: { color: ColorConfig.tonic } }),
		div({ class: "pitchShiftMarker", style: { color: ColorConfig.tonic, left: "50%" } }),
		div({ class: "pitchShiftMarker", style: { color: ColorConfig.tonic, left: "100%" } }),
	];
	private readonly _pitchShiftFifthMarkers: HTMLDivElement[] = [
		div({
			class: "pitchShiftMarker",
			style: { color: ColorConfig.fifthNote, left: `${(100 * 7) / 24}%` },
		}),
		div({
			class: "pitchShiftMarker",
			style: { color: ColorConfig.fifthNote, left: `${(100 * 19) / 24}%` },
		}),
	];
	private readonly _pitchShiftMarkerContainer: HTMLDivElement = div(
		{ class: "pitch-shift-row" },
		this._pitchShiftWidget.slider.container,
		div(
			{ class: "pitchShiftMarkerContainer" },
			this._pitchShiftTonicMarkers,
			this._pitchShiftFifthMarkers,
		),
	);
	private readonly _pitchShiftRow: HTMLDivElement = div(
		{ class: "selectRow" },
		tipSpan("Pitch Shift:", () => {
			this._openPrompt("pitchShift");
		}),
		this._pitchShiftMarkerContainer,
	);
	private readonly _detuneSlider: Slider = new Slider(
		input({
			type: "range",
			min: Config.detuneMin - Config.detuneCenter,
			max: Config.detuneMax - Config.detuneCenter,
			value: 0,
			step: "4",
		}),
		this.doc,
		(oldValue: number, newValue: number) => new ChangeDetune(this.doc, oldValue, newValue),
		true,
	);
	private readonly _detuneSliderInputBox: HTMLInputElement = numberInput({
		style: "width: 4em; font-size: 80%; margin-left: 0.4em; vertical-align: middle;",
		id: "detuneSliderInputBox",
		type: "number",
		step: "1",
		min: Config.detuneMin - Config.detuneCenter,
		max: Config.detuneMax - Config.detuneCenter,
		value: 0,
	});
	private readonly _detuneSliderRow: HTMLDivElement = inlineSliderRow(
		"Detune: ",
		() => {
			this._openPrompt("detune");
		},
		this._detuneSlider.container,
		this._detuneSliderInputBox,
	);
	private readonly _distortionWidget: SliderNumWidget = new SliderNumWidget(
		this.doc,
		(oldValue: number, newValue: number) => new ChangeDistortion(this.doc, oldValue, newValue),
		0,
		Config.distortionRange - 1,
		0,
		"Distortion:",
		() => {
			this._openPrompt("distortion");
		},
		{ getInstrumentValue: () => this.doc.getCurrentInstrumentObj().distortion },
	);
	private readonly _aliasingBox: HTMLInputElement = input({
		type: "checkbox",
		class: "select-row-checkbox-narrow",
	});
	private readonly _aliasingRow: HTMLElement = div(
		{ class: "selectRow" },
		tipSpan(
			"Aliasing:",
			() => {
				this._openPrompt("aliases");
			},
			{ class: "tip-indent-md" },
		),
		this._aliasingBox,
	);
	private readonly _bitcrusherQuantizationWidget: SliderNumWidget = new SliderNumWidget(
		this.doc,
		(oldValue: number, newValue: number) =>
			new ChangeBitcrusherQuantization(this.doc, oldValue, newValue),
		0,
		Config.bitcrusherQuantizationRange - 1,
		0,
		"Bit Crush:",
		() => {
			this._openPrompt("bitcrusherQuantization");
		},
		{ getInstrumentValue: () => this.doc.getCurrentInstrumentObj().bitcrusherQuantization },
	);
	private readonly _bitcrusherFreqWidget: SliderNumWidget = new SliderNumWidget(
		this.doc,
		(oldValue: number, newValue: number) =>
			new ChangeBitcrusherFreq(this.doc, oldValue, newValue),
		0,
		Config.bitcrusherFreqRange - 1,
		0,
		"Freq Crush:",
		() => {
			this._openPrompt("bitcrusherFreq");
		},
		{ getInstrumentValue: () => this.doc.getCurrentInstrumentObj().bitcrusherFreq },
	);
	private readonly _stringSustainWidget: SliderNumWidget = new SliderNumWidget(
		this.doc,
		(oldValue: number, newValue: number) =>
			new ChangeStringSustain(this.doc, oldValue, newValue),
		0,
		Config.stringSustainRange - 1,
		0,
		"Sustain:",
		() => {
			this._openPrompt("stringSustain");
		},
		{ getInstrumentValue: () => this.doc.getCurrentInstrumentObj().stringSustain },
	);
	private readonly _stringSustainLabel: HTMLSpanElement = span(
		{
			class: "tip",
			onclick: () => {
				this._openPrompt("stringSustain");
			},
		},
		"Sustain:",
	);
	// Custom row: dynamic label + slider + input (widget row tip is static).
	private readonly _stringSustainRow: HTMLDivElement = (() => {
		const wrapper = div({ class: "slider-flex-row" });
		wrapper.appendChild(this._stringSustainWidget.slider.container);
		wrapper.appendChild(this._stringSustainWidget.inputBox);
		this._stringSustainWidget.slider.container.style.flex = "1 1 auto";
		this._stringSustainWidget.slider.container.style.minWidth = "0";
		this._stringSustainWidget.inputBox.classList.add("slider-flex-fixed");
		return div({ class: "selectRow" }, this._stringSustainLabel, wrapper);
	})();

	private readonly _unisonDropdown: HTMLButtonElement = dropdownButton({
		onclick: () => {
			this._toggleDropdownMenu(DropdownID.Unison);
		},
	});

	private readonly _unisonSelect: HTMLSelectElement = buildOptions(
		select(),
		Config.unisons.map((unison) => unison.name),
	);
	private readonly _unisonSelectRow: HTMLElement = div(
		{ class: "selectRow" },
		tipSpan("Unison:", () => {
			this._openPrompt("unison");
		}),
		this._unisonDropdown,
		div({ class: "selectContainer select-container-narrow" }, this._unisonSelect),
	);

	private readonly _unisonVoicesInputBox: HTMLInputElement = numberInput({
		class: "stepper-input-wide",
		id: "unisonVoicesInputBox",
		type: "number",
		step: "1",
		min: Config.unisonVoicesMin,
		max: Config.unisonVoicesMax,
		value: 1,
	});
	private readonly _unisonVoicesRow: HTMLDivElement = div(
		{ class: "selectRow dropFader" },
		div(
			{},
			span(
				{
					class: "tip tip-unison",
					onclick: () => {
						this._openPrompt("unisonVoices");
					},
				},
				"‣ Voices: ",
			),
			valueLabel(this._unisonVoicesInputBox),
		),
	);
	private readonly _unisonSpreadInputBox: HTMLInputElement = numberInput({
		class: "stepper-input-wide",
		id: "unisonSpreadInputBox",
		type: "number",
		step: "0.001",
		min: Config.unisonSpreadMin,
		max: Config.unisonSpreadMax,
		value: 0.0,
	});
	private readonly _unisonSpreadRow: HTMLDivElement = div(
		{ class: "selectRow dropFader" },
		div(
			{},
			span(
				{
					class: "tip tip-unison",
					onclick: () => {
						this._openPrompt("unisonSpread");
					},
				},
				"‣ Spread: ",
			),
			valueLabel(this._unisonSpreadInputBox),
		),
	);

	private readonly _unisonOffsetInputBox: HTMLInputElement = numberInput({
		class: "stepper-input-wide",
		id: "unisonOffsetInputBox",
		type: "number",
		step: "0.001",
		min: Config.unisonOffsetMin,
		max: Config.unisonOffsetMax,
		value: 0.0,
	});
	private readonly _unisonOffsetRow: HTMLDivElement = div(
		{ class: "selectRow dropFader" },
		div(
			{},
			span(
				{
					class: "tip tip-unison",
					onclick: () => {
						this._openPrompt("unisonOffset");
					},
				},
				"‣ Offset: ",
			),
			valueLabel(this._unisonOffsetInputBox),
		),
	);
	private readonly _unisonExpressionInputBox: HTMLInputElement = numberInput({
		class: "stepper-input-wide",
		id: "unisonExpressionInputBox",
		type: "number",
		step: "0.001",
		min: Config.unisonExpressionMin,
		max: Config.unisonExpressionMax,
		value: 1.4,
	});
	private readonly _unisonExpressionRow: HTMLDivElement = div(
		{ class: "selectRow dropFader" },
		div(
			{},
			span(
				{
					class: "tip tip-unison",
					onclick: () => {
						this._openPrompt("unisonExpression");
					},
				},
				"‣ Volume: ",
			),
			valueLabel(this._unisonExpressionInputBox),
		),
	);
	private readonly _unisonSignInputBox: HTMLInputElement = input({
		class: "stepper-input-wide",
		id: "unisonSignInputBox",
		type: "number",
		step: "0.001",
		min: Config.unisonSignMin,
		max: Config.unisonSignMax,
		value: 1.0,
	});
	private readonly _unisonSignRow: HTMLDivElement = div(
		{ class: "selectRow dropFader" },
		div(
			{},
			span(
				{
					class: "tip tip-unison",
					onclick: () => {
						this._openPrompt("unisonSign");
					},
				},
				"‣ Sign: ",
			),
			valueLabel(this._unisonSignInputBox),
		),
	);
	private readonly _unisonDropdownGroup: HTMLElement = div(
		{ class: "editor-controls", style: "display: none; gap: 3px; margin-bottom: 0.5em;" },
		this._unisonVoicesRow,
		this._unisonSpreadRow,
		this._unisonOffsetRow,
		this._unisonExpressionRow,
		this._unisonSignRow,
	);

	private readonly _chordSelect: HTMLSelectElement = buildOptions(
		select({ style: "flex-shrink: 100" }),
		Config.chords.map((chord) => chord.name),
	);
	private readonly _chordDropdown: HTMLButtonElement = dropdownButton({
		onclick: () => {
			this._toggleDropdownMenu(DropdownID.Chord);
		},
	});
	private readonly _monophonicNoteInputBox: HTMLInputElement = numberInput({
		style: "width: 2.35em; height: 1.5em; font-size: 80%; margin: 0.5em; vertical-align: middle;",
		id: "unisonSignInputBox",
		type: "number",
		step: "1",
		min: 1,
		max: Config.maxChordSize,
		value: 1.0,
	});
	private readonly _chordSelectContainer: HTMLDivElement = div(
		{ class: "selectContainer", style: "width=100%" },
		this._chordSelect,
	);

	private readonly _chordSelectRow: HTMLElement = div(
		{ class: "selectRow", style: "display: flex; flex-direction: row" },
		span(
			{
				class: "tip",
				onclick: () => {
					this._openPrompt("chords");
				},
			},
			"Chords:",
		),
		this._monophonicNoteInputBox,
		this._chordDropdown,
		this._chordSelectContainer,
	);
	private readonly _arpeggioSpeedDisplay: HTMLSpanElement = span(
		{
			style: `color: ${ColorConfig.secondaryText}; font-size: smaller; text-overflow: clip;`,
		},
		"x1",
	);
	private readonly _arpeggioSpeedWidget: SliderNumWidget = new SliderNumWidget(
		this.doc,
		(oldValue: number, newValue: number) =>
			new ChangeArpeggioSpeed(this.doc, oldValue, newValue),
		0,
		Config.modulators.dictionary["arp speed"].maxRawVol,
		0,
		"‣ Spd:",
		() => {
			this._openPrompt("arpeggioSpeed");
		},
		{ getInstrumentValue: () => this.doc.getCurrentInstrumentObj().arpeggioSpeed },
	);
	private readonly _arpeggioSpeedRow: HTMLElement = div(
		{ class: "selectRow dropFader" },
		this._arpeggioSpeedDisplay,
		this._arpeggioSpeedWidget.slider.container,
	);
	private readonly _twoNoteArpBox: HTMLInputElement = input({
		type: "checkbox",
		class: "select-row-checkbox-narrow",
	});
	private readonly _twoNoteArpRow: HTMLElement = div(
		{ class: "selectRow dropFader" },
		tipSpan(
			"‣ Fast Two-Note:",
			() => {
				this._openPrompt("twoNoteArpeggio");
			},
			{ class: "tip-indent-sm" },
		),
		this._twoNoteArpBox,
	);

	private readonly _chordDropdownGroup: HTMLElement = div(
		{ class: "editor-controls", style: "display: none;" },
		this._arpeggioSpeedRow,
		this._twoNoteArpRow,
	);

	private readonly _invertWaveBox: HTMLInputElement = input({
		type: "checkbox",
		class: "select-row-checkbox-narrow",
	});
	private readonly _invertWaveRow: HTMLElement = div(
		{ class: "selectRow" },
		tipSpan(
			"Invert Wave:",
			() => {
				this._openPrompt("invertWave");
			},
			{ class: "tip-indent-md" },
		),
		this._invertWaveBox,
	);

	private readonly _vibratoSelect: HTMLSelectElement = buildOptions(
		select(),
		Config.vibratos.map((vibrato) => vibrato.name),
	);
	private readonly _vibratoDropdown: HTMLButtonElement = dropdownButton({
		onclick: () => {
			this._toggleDropdownMenu(DropdownID.Vibrato);
		},
	});
	private readonly _vibratoSelectRow: HTMLElement = div(
		{ class: "selectRow" },
		tipSpan("Vibrato:", () => {
			this._openPrompt("vibrato");
		}),
		this._vibratoDropdown,
		div({ class: "selectContainer select-container-narrow" }, this._vibratoSelect),
	);
	private readonly _vibratoDepthWidget: SliderNumWidget = new SliderNumWidget(
		this.doc,
		(oldValue: number, newValue: number) =>
			new ChangeVibratoDepth(this.doc, oldValue, newValue),
		0,
		Config.modulators.dictionary["vibrato depth"].maxRawVol,
		0,
		"‣ Depth:",
		() => {
			this._openPrompt("vibratoDepth");
		},
		{ getInstrumentValue: () => this.doc.getCurrentInstrumentObj().vibratoDepth },
	);
	private readonly _vibratoSpeedDisplay: HTMLSpanElement = span(
		{
			style: `color: ${ColorConfig.secondaryText}; font-size: smaller; text-overflow: clip;`,
		},
		"x1",
	);
	private readonly _vibratoSpeedWidget: SliderNumWidget = new SliderNumWidget(
		this.doc,
		(oldValue: number, newValue: number) =>
			new ChangeVibratoSpeed(this.doc, oldValue, newValue),
		0,
		Config.modulators.dictionary["vibrato speed"].maxRawVol,
		0,
		"‣ Spd:",
		() => {
			this._openPrompt("vibratoSpeed");
		},
		{ getInstrumentValue: () => this.doc.getCurrentInstrumentObj().vibratoSpeed },
	);
	private readonly _vibratoSpeedRow: HTMLElement = div(
		{ class: "selectRow dropFader" },
		this._vibratoSpeedDisplay,
		this._vibratoSpeedWidget.slider.container,
	);
	private readonly _vibratoDelayWidget: SliderNumWidget = new SliderNumWidget(
		this.doc,
		(oldValue: number, newValue: number) =>
			new ChangeVibratoDelay(this.doc, oldValue, newValue),
		0,
		Config.modulators.dictionary["vibrato delay"].maxRawVol,
		0,
		"‣ Delay:",
		() => {
			this._openPrompt("vibratoDelay");
		},
		{ getInstrumentValue: () => this.doc.getCurrentInstrumentObj().vibratoDelay },
	);
	private readonly _vibratoTypeSelect: HTMLSelectElement = buildOptions(
		select(),
		Config.vibratoTypes.map((vibrato) => vibrato.name),
	);
	private readonly _vibratoTypeSelectRow: HTMLElement = div(
		{ class: "selectRow dropFader" },
		tipSpan(
			"‣ Type:",
			() => {
				this._openPrompt("vibratoType");
			},
			{ class: "tip-indent-sm" },
		),
		div({ class: "selectContainer select-container-narrow" }, this._vibratoTypeSelect),
	);
	private readonly _vibratoDropdownGroup: HTMLElement = div(
		{ class: "editor-controls", style: `display: none;` },
		this._vibratoDepthWidget.row,
		this._vibratoSpeedRow,
		this._vibratoDelayWidget.row,
		this._vibratoTypeSelectRow,
	);
	private readonly _phaseModGroup: HTMLElement = div({ class: "editor-controls" });
	private readonly _opl3AlgorithmSelect: HTMLSelectElement = buildOptions(
		select(),
		Config.algorithmsOpl3.map((algorithm) => algorithm.name),
	);
	private readonly _opl3AlgorithmSelectRow: HTMLDivElement = div(
		{ class: "selectRow" },
		tipSpan("OPL3 Algorithm: ", () => {
			this._openPrompt("algorithm");
		}),
		div({ class: "selectContainer" }, this._opl3AlgorithmSelect),
	);
	private readonly _feedbackTypeSelect: HTMLSelectElement = buildOptions(
		select(),
		Config.feedbacks.map((feedback) => feedback.name),
	);
	private readonly _feedbackRow1: HTMLDivElement = div(
		{ class: "selectRow" },
		tipSpan("Feedback:", () => {
			this._openPrompt("feedbackType");
		}),
		div({ class: "selectContainer" }, this._feedbackTypeSelect),
	);
	private readonly _spectrumEditor: SpectrumEditor = new SpectrumEditor(this.doc, null);
	private readonly _spectrumZoom: HTMLButtonElement = button(
		{
			class: "zoom-button zoom-button-sm",
			onclick: () => {
				this._openPrompt("spectrumSettings");
			},
		},
		"+",
	);
	private readonly _spectrumRow: HTMLElement = div(
		{ class: "selectRow" },
		tipSpan(
			"Spectrum:",
			() => {
				this._openPrompt("spectrum");
			},
			{ class: "tip-sm" },
		),
		this._spectrumZoom,
		this._spectrumEditor.container,
	);
	private readonly _harmonicsEditor: HarmonicsEditor = new HarmonicsEditor(this.doc);
	private readonly _harmonicsZoom: HTMLButtonElement = button(
		{
			class: "zoom-button zoom-button-sm",
			onclick: () => {
				this._openPrompt("harmonicsSettings");
			},
		},
		"+",
	);
	private readonly _harmonicsRow: HTMLElement = div(
		{ class: "selectRow" },
		tipSpan(
			"Harmonics:",
			() => {
				this._openPrompt("harmonics");
			},
			{ class: "tip-sm" },
		),
		this._harmonicsZoom,
		this._harmonicsEditor.container,
	);

	// SongEditor.ts
	readonly envelopeEditor: EnvelopeEditor = new EnvelopeEditor(
		this.doc,
		(id: number, submenu: number, subtype: string) => {
			this._toggleDropdownMenu(id, submenu, subtype);
		},
		(name: string) => {
			this._openPrompt(name);
		},
	);
	private readonly _envelopeSpeedDisplay: HTMLSpanElement = span(
		{
			style: `color: ${ColorConfig.secondaryText}; font-size: smaller; text-overflow: clip;`,
		},
		"x1",
	);
	private readonly _envelopeSpeedWidget: SliderNumWidget = new SliderNumWidget(
		this.doc,
		(oldValue: number, newValue: number) =>
			new ChangeEnvelopeSpeed(this.doc, oldValue, newValue),
		0,
		Config.modulators.dictionary["envelope speed"].maxRawVol,
		0,
		"‣ Spd:",
		() => {
			this._openPrompt("envelopeSpeed");
		},
		{ getInstrumentValue: () => this.doc.getCurrentInstrumentObj().envelopeSpeed },
	);
	private readonly _envelopeSpeedRow: HTMLElement = div(
		{ class: "selectRow dropFader" },
		this._envelopeSpeedDisplay,
		this._envelopeSpeedWidget.slider.container,
	);
	private readonly _envelopeDropdownGroup: HTMLElement = div(
		{ class: "editor-controls", style: "display: none;" },
		this._envelopeSpeedRow,
	);
	private readonly _envelopeDropdown: HTMLButtonElement = dropdownButton({
		style: "margin-right: 1em;",
		onclick: () => {
			this._toggleDropdownMenu(DropdownID.Envelope);
		},
	});

	private readonly _drumsetGroup: HTMLElement = div({ class: "editor-controls" });
	private readonly _drumsetZoom: HTMLButtonElement = button(
		{
			class: "zoom-button zoom-button-md",
			onclick: () => {
				this._openPrompt("drumsetSettings");
			},
		},
		"+",
	);
	private readonly _modulatorGroup: HTMLElement = div({ class: "editor-controls" });
	private readonly _modNameRows: HTMLElement[] = [];
	private readonly _modChannelBoxes: HTMLSelectElement[] = [];
	private readonly _modInstrumentBoxes: HTMLSelectElement[] = [];
	private readonly _modSetRows: HTMLElement[] = [];
	private readonly _modSetBoxes: HTMLSelectElement[] = [];
	private readonly _modFilterRows: HTMLElement[] = [];
	private readonly _modFilterBoxes: HTMLSelectElement[] = [];
	private readonly _modEnvelopeRows: HTMLElement[] = [];
	private readonly _modEnvelopeBoxes: HTMLSelectElement[] = [];
	private readonly _modTargetIndicators: SVGElement[] = [];

	private readonly _upperNoteLimitInputBox: HTMLInputElement = numberInput({
		class: "note-limit-input",
		id: "upperNoteLimitInputBox",
		type: "number",
		step: "1",
		min: 0,
		max: Config.maxPitch,
		value: 60,
	});
	private readonly _upperNoteLimitRow: HTMLElement = div(
		{ class: "selectRow" },
		tipSpan("Upper Note Limit:", () => {
			this._openPrompt("upperNoteLimit");
		}),
		this._upperNoteLimitInputBox,
	);
	private readonly _lowerNoteLimitInputBox: HTMLInputElement = numberInput({
		class: "note-limit-input",
		id: "lowerNoteLimitInputBox",
		type: "number",
		step: "1",
		min: 0,
		max: Config.maxPitch,
		value: 60,
	});
	private readonly _lowerNoteLimitRow: HTMLElement = div(
		{ class: "selectRow" },
		tipSpan("Lower Note Limit:", () => {
			this._openPrompt("lowerNoteLimit");
		}),
		this._lowerNoteLimitInputBox,
	);

	private readonly _feedback6OpTypeSelect: HTMLSelectElement = buildOptions(
		select(),
		Config.feedbacks6Op.map((feedback) => feedback.name),
	);
	private readonly _feedback6OpRow1: HTMLDivElement = div(
		{ class: "selectRow" },
		tipSpan("Feedback:", () => {
			this._openPrompt("feedbackType");
		}),
		div({ class: "selectContainer" }, this._feedback6OpTypeSelect),
	);

	private readonly _algorithmCanvasSwitch: HTMLButtonElement = button(
		{
			style: `margin-left:0em; height:1.5em; width: 10px; padding: 0px; font-size: ${Typography.sizeXs};`,
			onclick: (e: Event) => {
				this._toggleAlgorithmCanvas(e);
			},
		},
		"A",
	);
	private readonly _customAlgorithmCanvas: CustomAlgorithmCanvas = new CustomAlgorithmCanvas(
		canvas({
			width: 144,
			height: 144,
			style: `border:2px solid ${ColorConfig.uiWidgetBackground}`,
			id: "customAlgorithmCanvas",
		}),
		this.doc,
		(newArray: number[][], carry: number, mode: string) =>
			new ChangeCustomAlgorythmorFeedback(this.doc, newArray, carry, mode),
	);
	private readonly _algorithm6OpSelect: HTMLSelectElement = buildOptions(
		select(),
		Config.algorithms6Op.map((algorithm) => algorithm.name),
	);
	private readonly _algorithm6OpSelectRow: HTMLDivElement = div(
		div(
			{ class: "selectRow" },
			tipSpan("Algorithm: ", () => {
				this._openPrompt("algorithm");
			}),
			div({ class: "selectContainer" }, this._algorithm6OpSelect),
		),
		div(
			{
				style: "height:144px; display:flex; flex-direction: row; align-items:center; justify-content:center;",
			},
			div(
				{ style: "display:block; width:10px; margin-right: 0.2em" },
				this._algorithmCanvasSwitch,
			),
			div({ style: "width:144px; height:144px;" }, this._customAlgorithmCanvas.canvas),
		),
	); // temp

	private readonly _instrumentCopyButton: HTMLButtonElement = button(
		{
			style: `max-width:${Sizing.inputSm}; width:${Sizing.inputSm};`,
			class: "copyButton",
			title: "Copy Instrument (⇧C)",
		},
		[
			// Copy icon:
			SVG.svg(
				{
					class: "icon-overlay",
					width: Sizing.iconMd,
					height: Sizing.iconMd,
					viewBox: "0 0 24 24",
				},
				[
					SVG.path({
						d: "M7 9.667a2.667 2.667 0 0 1 2.667 -2.667h8.666a2.667 2.667 0 0 1 2.667 2.667v8.666a2.667 2.667 0 0 1 -2.667 2.667h-8.666a2.667 2.667 0 0 1 -2.667 -2.667l0 -8.666",
						stroke: "currentColor",
						"stroke-width": "2",
						"stroke-linecap": "round",
						"stroke-linejoin": "round",
						fill: "none",
					}),
					SVG.path({
						d: "M4.012 16.737a2.005 2.005 0 0 1 -1.012 -1.737v-10c0 -1.1 .9 -2 2 -2h10c.75 0 1.158 .385 1.5 1",
						stroke: "currentColor",
						"stroke-width": "2",
						"stroke-linecap": "round",
						"stroke-linejoin": "round",
						fill: "none",
					}),
				],
			),
			"Copy",
		],
	);
	private readonly _instrumentPasteButton: HTMLButtonElement = button(
		{
			style: `max-width:${Sizing.inputSm};`,
			class: "pasteButton",
			title: "Paste Instrument (⇧V)",
		},
		[
			// Paste icon:
			SVG.svg(
				{
					class: "icon-overlay",
					width: Sizing.iconMd,
					height: Sizing.iconMd,
					viewBox: "0 0 24 24",
				},
				[
					SVG.path({
						d: "M9 5h-2a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h3m9 -9v-5a2 2 0 0 0 -2 -2h-2",
						stroke: "currentColor",
						"stroke-width": "2",
						"stroke-linecap": "round",
						"stroke-linejoin": "round",
						fill: "none",
					}),
					SVG.path({
						d: "M13 17v-1a1 1 0 0 1 1 -1h1m3 0h1a1 1 0 0 1 1 1v1m0 3v1a1 1 0 0 1 -1 1h-1m-3 0h-1a1 1 0 0 1 -1 -1v-1",
						stroke: "currentColor",
						"stroke-width": "2",
						"stroke-linecap": "round",
						"stroke-linejoin": "round",
						fill: "none",
					}),
					SVG.path({
						d: "M9 5a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2a2 2 0 0 1 -2 2h-2a2 2 0 0 1 -2 -2",
						stroke: "currentColor",
						"stroke-width": "2",
						"stroke-linecap": "round",
						"stroke-linejoin": "round",
						fill: "none",
					}),
				],
			),
			"Paste",
		],
	);

	private readonly _instrumentExportButton: HTMLButtonElement = button(
		{
			style: `max-width:${Sizing.inputSm}; width:${Sizing.inputSm};`,
			class: "exportInstrumentButton",
		},
		[
			// Export icon:
			SVG.svg(
				{
					class: "icon-overlay",
					width: Sizing.iconMd,
					height: Sizing.iconMd,
					viewBox: "0 0 24 24",
				},
				[
					SVG.path({
						d: "M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2 M7 11l5 5l5 -5 M12 4l0 12",
						stroke: "currentColor",
						"stroke-width": "2",
						"stroke-linecap": "round",
						"stroke-linejoin": "round",
						fill: "none",
					}),
				],
			),
			"Export",
		],
	);
	private readonly _instrumentImportButton: HTMLButtonElement = button(
		{
			style: `max-width:${Sizing.inputSm};`,
			class: "importInstrumentButton",
		},
		[
			// Import icon:
			SVG.svg(
				{
					class: "icon-overlay",
					width: Sizing.iconMd,
					height: Sizing.iconMd,
					viewBox: "0 0 24 24",
				},
				[
					SVG.path({
						d: "M14 3v4a1 1 0 0 0 1 1h4 M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2 M12 11v6 M9 14l3 3l3 -3",
						stroke: "currentColor",
						"stroke-width": "2",
						"stroke-linecap": "round",
						"stroke-linejoin": "round",
						fill: "none",
					}),
				],
			),
			"Import",
		],
	);

	public readonly _globalSpectrum: spectrumCanvas = new spectrumCanvas(
		canvas({
			width: 384,
			height: 64,
			id: "spectrumAll",
		}),
		1,
	);
	private readonly _globalSpectrumContainer: HTMLDivElement = div(
		{ class: "spectrum-container" },
		this._globalSpectrum.canvas,
	);
	// Overlay spectrum rendered on track editor (separate canvas, controlled by showSpectrumOverlay pref)
	private readonly _overlaySpectrum: spectrumCanvas = new spectrumCanvas(
		canvas({
			width: 384,
			height: 64,
			id: "spectrumOverlay",
		}),
		1,
		true,
	);
	private readonly _overlaySpectrumContainer: HTMLDivElement = div(
		{ class: "spectrum-overlay-container" },
		this._overlaySpectrum.canvas,
	);
	private readonly _customWaveDrawCanvas: CustomChipCanvas = new CustomChipCanvas(
		canvas({
			width: 128,
			height: 52,
			style: `border:2px solid ${ColorConfig.uiWidgetBackground}`,
			id: "customWaveDrawCanvas",
		}),
		this.doc,
		(newArray: Float32Array) => new ChangeCustomWave(this.doc, newArray),
	);
	private readonly _customWavePresetDrop: HTMLSelectElement = buildHeaderedOptions(
		"Load Preset",
		select({ style: "width: 50%; height:1.5em; text-align: center; text-align-last: center;" }),
		Config.chipWaves.map((wave) => wave.name),
	);
	private readonly _customWaveZoom: HTMLButtonElement = button(
		{
			class: "zoom-button zoom-button-lg",
			onclick: () => {
				this._openPrompt("customChipSettings");
			},
		},
		"+",
	);

	private readonly _customWaveDraw: HTMLDivElement = div(
		{ style: "height:80px; margin-top:10px; margin-bottom:5px" },
		[
			div({ style: "height:54px; display:flex; justify-content:center;" }, [
				this._customWaveDrawCanvas.canvas,
			]),
			div({ style: "margin-top:5px; display:flex; justify-content:center;" }, [
				this._customWavePresetDrop,
				this._customWaveZoom,
			]),
		],
	);

	private readonly _songTitleInputBox: InputBox = new InputBox(
		input({
			style: `font-weight: bold; border: none; width: 98%; background-color: ${ColorConfig.editorBackground}; color: ${ColorConfig.settingsHeaderText}; text-align: center;`,
			maxlength: "30",
			type: "text",
			value: EditorConfig.versionDisplayName,
		}),
		this.doc,
		(oldValue: string, newValue: string) => new ChangeSongTitle(this.doc, oldValue, newValue),
	);

	private readonly _feedbackAmplitudeWidget: SliderNumWidget = new SliderNumWidget(
		this.doc,
		(oldValue: number, newValue: number) =>
			new ChangeFeedbackAmplitude(this.doc, oldValue, newValue),
		0,
		Config.operatorAmplitudeMax,
		0,
		"Fdback Vol:",
		() => {
			this._openPrompt("feedbackVolume");
		},
		{
			title: "Feedback Amplitude",
			getInstrumentValue: () => this.doc.getCurrentInstrumentObj().feedbackAmplitude,
		},
	);
	/*
     * @jummbus - This button was cut for editorial reasons.
     *
    private readonly _customizeInstrumentButton: HTMLButtonElement = button({type: "button", style: "margin: 2px 0"},

        "Customize Instrument",
    );
    */
	private readonly _addEnvelopeButton: HTMLButtonElement = button({
		type: "button",
		class: "add-envelope",
	});
	private readonly _customInstrumentSettingsGroup: HTMLDivElement = div(
		{ class: "editor-controls" },
		this._panWidget.row,
		this._panDropdownGroup,
		this._chipWaveSelectRow,
		this._chipNoiseSelectRow,
		this._useChipWaveAdvancedLoopControlsRow,
		this._chipWaveLoopModeSelectRow,
		this._chipWaveLoopStartRow,
		this._chipWaveLoopEndRow,
		this._chipWaveStartOffsetRow,
		this._chipWavePlayBackwardsRow,
		this._customWaveDraw,
		this._eqFilterTypeRow,
		this._eqFilterRow,
		this._eqFilterSimpleCutWidget.row,
		this._eqFilterSimplePeakWidget.row,
		this._fadeInOutRow,
		this._opl3AlgorithmSelectRow,
		this._algorithmSelectRow,
		this._algorithm6OpSelectRow,
		this._phaseModGroup,
		this._feedbackRow1,
		this._feedback6OpRow1,
		this._feedbackAmplitudeWidget.row,
		this._spectrumRow,
		this._harmonicsRow,
		this._drumsetGroup,
		this._supersawDynamismWidget.row,
		this._supersawSpreadWidget.row,
		this._supersawShapeWidget.row,
		this._pulseWidthWidget.row,
		this._pulseWidthDropdownGroup,
		this._stringSustainRow,
		this._unisonSelectRow,
		this._unisonDropdownGroup,
		div(
			{ class: "settings-section-header" },
			span(
				{ class: "settings-section-header-label" },
				tipSpan("Effects", () => {
					this._openPrompt("effects");
				}),
			),
			div({ class: "effects-menu" }, this._effectsSelect),
		),
		this._transitionRow,
		this._transitionDropdownGroup,
		this._chordSelectRow,
		this._chordDropdownGroup,
		this._pitchShiftRow,
		this._detuneSliderRow,
		this._vibratoSelectRow,
		this._vibratoDropdownGroup,
		this._noteFilterTypeRow,
		this._noteFilterRow,
		this._noteFilterSimpleCutWidget.row,
		this._noteFilterSimplePeakWidget.row,
		this._distortionWidget.row,
		this._aliasingRow,
		this._bitcrusherQuantizationWidget.row,
		this._bitcrusherFreqWidget.row,
		this._chorusRow,
		this._echoSustainRow,
		this._echoDelayRow,
		this._reverbRow,
		this._ringModContainerRow,
		this._phaserMixRow,
		this._phaserFreqRow,
		this._phaserFeedbackRow,
		this._phaserStagesRow,
		this._compressorThresholdRow,
		this._compressorRatioRow,
		this._compressorAttackRow,
		this._compressorReleaseRow,
		this._compressorSyncRow,
		this._combDelayRow,
		this._combFeedbackRow,
		this._combMixRow,
		this._combRateRow,
		this._combDepthRow,
		this._invertWaveRow,
		this._upperNoteLimitRow,
		this._lowerNoteLimitRow,
		this._granularContainerRow,
		div(
			{ class: "settings-section-header" },
			span(
				{ class: "settings-section-header-label" },
				tipSpan("Envelopes", () => {
					this._openPrompt("envelopes");
				}),
			),
			this._envelopeDropdown,
			this._addEnvelopeButton,
		),
		this._envelopeDropdownGroup,
		this.envelopeEditor.container,
	);
	private readonly _instrumentCopyGroup: HTMLDivElement = div(
		{ class: "editor-controls" },
		div({ class: "selectRow" }, this._instrumentCopyButton, this._instrumentPasteButton),
	);
	private readonly _instrumentExportGroup: HTMLDivElement = div(
		{ class: "editor-controls" },
		div({ class: "selectRow" }, this._instrumentExportButton, this._instrumentImportButton),
	);
	private readonly _instrumentSettingsTextRow: HTMLDivElement = div(
		{
			id: "instrumentSettingsText",
			style: `padding: 3px 0; max-width: 15em; text-align: center; color: ${ColorConfig.settingsHeaderText};`,
		},
		"Instrument Settings",
	);

	private readonly _instrumentTypeSelect: HTMLSelectElement = buildOptions(
		select(),
		getRegisteredPlugins()
			.filter((p) => p.type !== InstrumentType.mod && p.type !== InstrumentType.drumset)
			.map((p) => p.displayName ?? p.name),
	);
	private readonly _onInstrumentTypeChange = (): void => {
		const plugins = getRegisteredPlugins().filter(
			(p) => p.type !== InstrumentType.mod && p.type !== InstrumentType.drumset,
		);
		const idx = this._instrumentTypeSelect.selectedIndex;
		const plugin = plugins[idx];
		if (plugin) {
			this.doc.record(new ChangeInstrumentType(this.doc, plugin.type));
		}
	};
	private readonly _instrumentTypeRow: HTMLDivElement = div(
		{ class: "selectRow", id: "instrumentTypeRow" },
		tipSpan("Type:", () => {
			this._openPrompt("instrumentType");
		}),
		div({ class: "selectContainer" }, this._instrumentTypeSelect),
	);
	private readonly _instrumentPresetSelectRow: HTMLDivElement = div(
		{ class: "selectRow", id: "presetSelectRow" },
		tipSpan("Preset:", () => {
			this.openPresetSelector();
		}),
		div(
			div({ class: "pitchSelect" }, this._pitchedPresetSelect),
			div({ class: "drumSelect" }, this._drumPresetSelect),
		),
	);
	private readonly _instrumentSettingsGroup: HTMLDivElement = div(
		{ class: "editor-controls" },
		this._instrumentSettingsTextRow,
		this._instrumentsButtonRow,
		this._instrumentTypeRow,
		this._instrumentPresetSelectRow,
		this._instrumentVolumeWidget.row,
		this._customInstrumentSettingsGroup,
	);
	private readonly _usedPatternIndicator: SVGElement = SVG.path({
		d: "M -6 -6 H 6 V 6 H -6 V -6 M -2 -3 L -2 -3 L -1 -4 H 1 V 4 H -1 V -1.2 L -1.2 -1 H -2 V -3 z",
		fill: ColorConfig.indicatorSecondary,
		"fill-rule": "evenodd",
	});
	private readonly _usedInstrumentIndicator: SVGElement = SVG.path({
		d: "M -6 -0.8 H -3.8 V -6 H 0.8 V 4.4 H 2.2 V -0.8 H 6 V 0.8 H 3.8 V 6 H -0.8 V -4.4 H -2.2 V 0.8 H -6 z",
		fill: ColorConfig.indicatorSecondary,
	});
	private readonly _jumpToModIndicator: SVGElement = SVG.svg(
		{
			style: "width: 92%; height: 1.3em; flex-shrink: 0; position: absolute;",
			viewBox: "0 0 200 200",
		},
		[
			SVG.path({
				d: "M90 155 l0 -45 -45 0 c-25 0 -45 -4 -45 -10 0 -5 20 -10 45 -10 l45 0 0 -45 c0 -25 5 -45 10 -45 6 0 10 20 10 45 l0 45 45 0 c25 0 45 5 45 10 0 6 -20 10 -45 10 l -45 0 0 45 c0 25 -4 45 -10 45 -5 0 -10 -20 -10 -45z",
			}),
			SVG.path({
				d: "M42 158 c-15 -15 -16 -38 -2 -38 6 0 10 7 10 15 0 8 7 15 15 15 8 0 15 5 15 10 0 14 -23 13 -38 -2z",
			}),
			SVG.path({
				d: "M120 160 c0 -5 7 -10 15 -10 8 0 15 -7 15 -15 0 -8 5 -15 10 -15 14 0 13 23 -2 38 -15 15 -38 16 -38 2z",
			}),
			SVG.path({
				d: "M32 58 c3 -23 48 -40 48 -19 0 6 -7 11 -15 11 -8 0 -15 7 -15 15 0 8 -5 15 -11 15 -6 0 -9 -10 -7 -22z",
			}),
			SVG.path({
				d: "M150 65 c0 -8 -7 -15 -15 -15 -8 0 -15 -4 -15 -10 0 -14 23 -13 38 2 15 15 16 38 2 38 -5 0 -10 -7 -10 -15z",
			}),
		],
	);

	private readonly _promptContainer: HTMLDivElement = div({
		class: "promptContainer",
		style: "display: none;",
	});
	private readonly _zoomInButton: HTMLButtonElement = iconButton("zoomInButton", {
		title: "Zoom In",
	});
	private readonly _zoomOutButton: HTMLButtonElement = iconButton("zoomOutButton", {
		title: "Zoom Out",
	});
	private readonly _patternEditorRow: HTMLDivElement = div(
		{
			class: "pattern-editor-row",
		},
		this._patternEditorPrev.container,
		this._patternEditor.container,
		this._patternEditorNext.container,
	);
	private readonly _patternArea: HTMLDivElement = div(
		{ class: "pattern-area" },
		this._piano.container,
		this._patternEditorRow,
		this._octaveScrollBar.container,
		this._zoomInButton,
		this._zoomOutButton,
	);
	private readonly _trackContainer: HTMLDivElement = div(
		{ class: "trackContainer" },
		this._trackEditor.container,
		this._loopEditor.container,
	);
	private readonly _trackVisibleArea: HTMLDivElement = div({
		class: "track-visible-area",
	});
	private readonly _trackAndMuteContainer: HTMLDivElement = div(
		{ class: "trackAndMuteContainer" },
		this._muteEditor.container,
		this._trackContainer,
		this._trackVisibleArea,
	);
	public readonly _barScrollBar: BarScrollBar = new BarScrollBar(this.doc);
	private readonly _trackArea: HTMLDivElement = div(
		{ class: "track-area" },
		this._trackAndMuteContainer,
		this._barScrollBar.container,
		this._overlaySpectrumContainer,
	);

	private readonly _menuArea: HTMLDivElement = div(
		{ class: "menu-area" },
		div({ class: "selectContainer menu file" }, this._fileMenu),
		div({ class: "selectContainer menu edit" }, this._editMenu),
		div({ class: "selectContainer menu preferences" }, this._optionsMenu),
	);

	private readonly _sampleLoadingBar: HTMLDivElement = div({
		style: `width: 0%; height: 100%; background-color: ${ColorConfig.indicatorPrimary};`,
	});
	private readonly _sampleLoadingBarContainer: HTMLDivElement = div(
		{
			style: `width: 80%; height: 4px; overflow: hidden; margin-left: auto; margin-right: auto; margin-top: 0.5em; cursor: pointer; background-color: ${ColorConfig.indicatorSecondary};`,
		},
		this._sampleLoadingBar,
	);
	private readonly _sampleLoadingStatusContainer: HTMLDivElement = div(
		{ style: "cursor: pointer;" },
		div(
			{
				style: `margin-top: 0.5em; text-align: center; color: ${ColorConfig.secondaryText};`,
			},
			"Sample Loading Status",
		),
		div(
			{ class: "selectRow", style: "height: 6px; margin-bottom: 0.5em;" },
			this._sampleLoadingBarContainer,
		),
	);

	private readonly _shiggy: Shiggy = new Shiggy();
	private readonly _shiggyToggle: HTMLDivElement = this._shiggy.container;

	private readonly _songSettingsArea: HTMLDivElement = div(
		{ class: "song-settings-area" },
		div(
			{ class: "editor-controls" },
			div(
				{ class: "editor-song-settings" },
				div(
					{
						style: `margin: 3px 0; position: relative; text-align: center; color: ${ColorConfig.secondaryText};`,
					},
					div(
						{
							class: "tip song-settings-indicator",
							style: "left: 0",
							onclick: () => {
								this._openPrompt("usedPattern");
							},
						},
						SVG.svg(
							{
								width: "12px",
								height: "12px",
								"margin-right": "0.5em",
								viewBox: "-6 -6 12 12",
							},
							this._usedPatternIndicator,
						),
					),
					div(
						{
							class: "tip song-settings-indicator",
							style: "left: 14px",
							onclick: () => {
								this._openPrompt("usedInstrument");
							},
						},
						SVG.svg(
							{
								width: "12px",
								height: "12px",
								"margin-right": "1em",
								viewBox: "-6 -6 12 12",
							},
							this._usedInstrumentIndicator,
						),
					),
					span({ style: `color: ${ColorConfig.settingsHeaderText};` }, "Song Settings"),
					div(
						{
							style: "width: 100%; left: 0; top: -1px; position:absolute; overflow-x:clip;",
						},
						this._jumpToModIndicator,
					),
				),
			),
			div(
				{ class: "selectRow" },
				tipSpan("Scale: ", () => {
					this._openPrompt("scale");
				}),
				div({ class: "selectContainer" }, this._scaleSelect),
			),
			div(
				{ class: "selectRow" },
				tipSpan("Key: ", () => {
					this._openPrompt("key");
				}),
				div({ class: "selectContainer" }, this._keySelect),
			),
			div(
				{ class: "selectRow" },
				tipSpan("Octave: ", () => {
					this._openPrompt("key_octave");
				}),
				this._octaveStepper,
			),
			div(
				{ class: "selectRow" },
				tipSpan("Tempo: ", () => {
					this._openPrompt("tempo");
				}),
				// Wrap slider + stepper with align-items to match widget row vertical centering.
				(() => {
					this._tempoSlider.container.style.flex = "1 1 auto";
					this._tempoSlider.container.style.minWidth = "0";
					this._tempoStepper.classList.add("slider-flex-fixed");
					return span(
						{ class: "slider-flex-row" },
						this._tempoSlider.container,
						this._tempoStepper,
					);
				})(),
			),
			div(
				{ class: "selectRow" },
				tipSpan("Rhythm: ", () => {
					this._openPrompt("rhythm");
				}),
				div({ class: "selectContainer" }, this._rhythmSelect),
			),
			div(
				{ class: "selectRow" },
				tipSpan("Song EQ:", () => {
					this._openPrompt("songeq");
				}),
				this._songEqFilterZoom,
				this._songEqFilterEditor.container,
			),
			this._sampleLoadingStatusContainer,
			this._shiggyToggle,
		),
	);
	private readonly _instrumentSettingsArea: HTMLDivElement = div(
		{ class: "instrument-settings-area" },
		this._instrumentSettingsGroup,
		this._modulatorGroup,
	);
	public readonly _settingsArea: HTMLDivElement = div(
		{ class: "settings-area noSelection" },
		div(
			{ class: "version-area" },
			div(
				{
					style: `text-align: center; margin: 3px 0; color: ${ColorConfig.settingsHeaderText};`,
				},
				this._songTitleInputBox.input,
			),
		),
		div(
			{ class: "play-pause-area" },
			this._volumeBarBox,
			div(
				{ class: "playback-bar-controls" },
				this._playButton,
				this._pauseButton,
				this._recordButton,
				this._stopButton,
				this._prevBarButton,
				this._nextBarButton,
			),
			div(
				{
					style: "text-align: center; font-size: 10px; color: var(--primary-text); margin-top: 2px;",
				},
				this._barPosLabel,
				div(
					{
						style: "margin-top: 1px;",
					},
					this._gitStatusLabel,
				),
			),
			div(
				{ class: "playback-volume-controls" },
				span({ class: "volume-speaker" }),
				this._volumeSlider.container,
				this._playbackControls.volumeInputBox,
			),
			this._globalSpectrumContainer,
		),
		this._menuArea,
		this._songSettingsArea,
		this._instrumentSettingsArea,
	);

	private readonly _navigatorShell = new NavigatorShell(
		"Navigator",
		() => {
			this.popoutCurrentPrompt();
		},
		() => void this._closeNavigatorMode(),
		(scope) => this._applicationRouter.routePrompt(scope),
		undefined,
		() => this.doc.getCurrentInstrumentObj(),
		(section) =>
			this.doc.prefs.navigatorSectionsExpanded[section] ??
			this.doc.prefs.navigatorSectionsExpanded["*"] ??
			true,
		(section, expanded) => {
			this.doc.prefs.navigatorSectionsExpanded = {
				...this.doc.prefs.navigatorSectionsExpanded,
				[section]: expanded,
			};
			this.doc.prefs.save();
		},
	);
	public readonly mainLayer: HTMLDivElement = div(
		{ class: "beepboxEditor", tabIndex: "0" },
		this._patternArea,
		this._trackArea,
		this._settingsArea,
		this._promptContainer,
	);

	private readonly _promptManager: PromptManager = new PromptManager(this, this);
	private readonly _legacyPromptPanes: LegacyPromptPaneFactory = new LegacyPromptPaneFactory(
		this._promptManager,
		() => this._closeNavigatorMode(),
		async (scope) => {
			await this._applicationRouter.routePrompt(scope);
		},
		() => this.doc.getCurrentInstrumentObj(),
	);
	private readonly _nativePanes = new NativePaneFactory(
		this.doc,
		this,
		() => this._closeNavigatorMode(),
		async (scope) => {
			await this._applicationRouter.routePrompt(scope);
		},
	);
	private readonly _navigatorRuntime: NavigatorRuntime = new NavigatorRuntime(
		this._navigatorShell,
		(route) =>
			this._nativePanes.supports(route)
				? this._nativePanes.create(route)
				: this._legacyPromptPanes.create(route),
	);
	private readonly _applicationRouter: ApplicationRouter = new ApplicationRouter({
		openGlobal: () => undefined,
		navigator: {
			canOpen: (route) => {
				const result = getNavigatorRouteAvailability(
					route.paneId,
					this.doc.getCurrentInstrumentObj(),
				);
				return result.available ? undefined : result.error;
			},
			open: (route) => this._navigatorRuntime.open(route),
			onOpened: (route) => {
				this._lastPrompt = route.paneId;
				this.doc.prompt = route.paneId;
			},
			focus: () => {
				this._navigatorShell.focus();
			},
		},
	});
	private readonly _commandPalette = new CommandPalette(
		{
			getBarCount: () => this.doc.song.barCount,
			openNavigator: (route) =>
				this._applicationRouter.routePrompt(route.paneId, route.context),
			goToBar: (bar) => {
				this.doc.selection.setChannelBar(this.doc.channel, bar);
				this.doc.selection.resetBoxSelection();
				this.doc.synth.goToBar(bar);
				this.doc.synth.snapToBar();
			},
			selectBars: (firstBar, lastBar) => {
				this.doc.selection.setChannelBar(this.doc.channel, firstBar);
				this.doc.selection.setTrackSelection(
					firstBar,
					lastBar,
					this.doc.channel,
					this.doc.channel,
				);
				this.doc.selection.scrollToEndOfSelection();
			},
		},
		() => {
			this.refocusStage();
		},
	);
	private _highlightedInstrumentIndex: number = -1;
	private _lastPrompt: string | null = null;
	private _pendingPromptChange: { requested: string | null } | null = null;
	private _queuedPromptChange: string | null | undefined;

	private _onDocPromptChange(): void {
		const requested = this.doc.prompt;
		if (this._pendingPromptChange !== null) {
			this._queuedPromptChange =
				requested === this._pendingPromptChange.requested ? undefined : requested;
			return;
		}
		if (requested === this._lastPrompt) return;

		const attempt = { requested };
		this._pendingPromptChange = attempt;
		const finish = (opened: boolean): void => {
			if (this._pendingPromptChange !== attempt) return;
			this._pendingPromptChange = null;
			if (!opened && this.doc.prompt === requested) {
				this.doc.prompt = this._lastPrompt;
			}
			const queued = this._queuedPromptChange;
			this._queuedPromptChange = undefined;
			if (queued !== undefined) this.doc.prompt = queued;
			this._onDocPromptChange();
		};

		try {
			const operation =
				requested === null
					? this._closeNavigatorMode()
					: this._applicationRouter.routePrompt(requested);
			void operation.then(finish, () => {
				finish(false);
			});
		} catch {
			finish(false);
		}
	}

	private _renderedInstrumentCount: number = 0;
	private _renderedChannel: number = -1;
	private _renderedInstrument: number = -1;
	private _renderedIsPlaying: boolean = false;
	private _renderedIsRecording: boolean = false;
	private _renderedShowRecordButton: boolean = false;
	private _renderedCtrlHeld: boolean = false;
	private _ctrlHeld: boolean = false;
	private _shiftHeld: boolean = false;
	private _deactivatedInstruments: boolean = false;
	private readonly _operatorRows: HTMLDivElement[] = [];
	private readonly _operatorAmplitudeSliders: Slider[] = [];
	private readonly _operatorAmplitudeInputBoxes: HTMLInputElement[] = [];
	private readonly _operatorFrequencySelects: HTMLSelectElement[] = [];
	private readonly _operatorDropdowns: HTMLButtonElement[] = [];
	private readonly _operatorWaveformSelects: HTMLSelectElement[] = [];
	private readonly _operatorWaveformHints: HTMLSpanElement[] = [];
	private readonly _operatorWaveformPulsewidthSliders: Slider[] = [];
	private readonly _operatorWaveformPulsewidthInputBoxes: HTMLInputElement[] = [];
	private readonly _operatorDropdownRows: HTMLElement[] = [];
	private readonly _operatorDropdownGroups: HTMLDivElement[] = [];
	private readonly _operatorAdsrAttackSliders: Slider[] = [];
	private readonly _operatorAdsrDecaySliders: Slider[] = [];
	private readonly _operatorAdsrSustainSliders: Slider[] = [];
	private readonly _operatorAdsrReleaseSliders: Slider[] = [];
	private readonly _operatorAdsrAttackInputBoxes: HTMLInputElement[] = [];
	private readonly _operatorAdsrDecayInputBoxes: HTMLInputElement[] = [];
	private readonly _operatorAdsrSustainInputBoxes: HTMLInputElement[] = [];
	private readonly _operatorAdsrReleaseInputBoxes: HTMLInputElement[] = [];
	private readonly _operatorAdsrRows: HTMLDivElement[] = [];
	readonly _drumsetSpectrumEditors: SpectrumEditor[] = [];
	private readonly _drumsetEnvelopeSelects: HTMLSelectElement[] = [];
	private _showModSliders: boolean[][] = [];
	private _newShowModSliders: boolean[][] = [];
	private _modSliderValues: number[][] = [];
	private _hasActiveModSliders: boolean = false;
	public readonly modSliders = new ModSliderRegistry(this);

	public get panSlider(): Slider {
		return this._panWidget.slider;
	}
	public get detuneSlider(): Slider {
		return this._detuneSlider;
	}
	public get operatorAmplitudeSliders(): Slider[] {
		return this._operatorAmplitudeSliders;
	}
	public get operatorAmplitudeInputBoxes(): HTMLInputElement[] {
		return this._operatorAmplitudeInputBoxes;
	}
	public get feedbackAmplitudeSlider(): Slider {
		return this._feedbackAmplitudeWidget.slider;
	}
	public get pulseWidthSlider(): Slider {
		return this._pulseWidthWidget.slider;
	}
	public get decimalOffsetSlider(): Slider {
		return this._decimalOffsetWidget.slider;
	}
	public get reverbSlider(): Slider {
		return this._reverbSlider;
	}
	public get distortionSlider(): Slider {
		return this._distortionWidget.slider;
	}
	public get instrumentVolumeSlider(): Slider {
		return this._instrumentVolumeWidget.slider;
	}
	public get vibratoDepthSlider(): Slider {
		return this._vibratoDepthWidget.slider;
	}
	public get vibratoSpeedSlider(): Slider {
		return this._vibratoSpeedWidget.slider;
	}
	public get vibratoDelaySlider(): Slider {
		return this._vibratoDelayWidget.slider;
	}
	public get arpeggioSpeedSlider(): Slider {
		return this._arpeggioSpeedWidget.slider;
	}
	public get panDelaySlider(): Slider {
		return this._panDelayWidget.slider;
	}
	public get tempoSlider(): Slider {
		return this._tempoSlider;
	}
	public get volumeSlider(): Slider {
		return this._volumeSlider;
	}
	public get eqFilterSimpleCutSlider(): Slider {
		return this._eqFilterSimpleCutWidget.slider;
	}
	public get eqFilterSimplePeakSlider(): Slider {
		return this._eqFilterSimplePeakWidget.slider;
	}
	public get noteFilterSimpleCutSlider(): Slider {
		return this._noteFilterSimpleCutWidget.slider;
	}
	public get noteFilterSimplePeakSlider(): Slider {
		return this._noteFilterSimplePeakWidget.slider;
	}
	public get bitcrusherQuantizationSlider(): Slider {
		return this._bitcrusherQuantizationWidget.slider;
	}
	public get bitcrusherFreqSlider(): Slider {
		return this._bitcrusherFreqWidget.slider;
	}
	public get pitchShiftSlider(): Slider {
		return this._pitchShiftWidget.slider;
	}
	public get chorusSlider(): Slider {
		return this._chorusSlider;
	}
	public get echoSustainSlider(): Slider {
		return this._echoSustainSlider;
	}
	public get echoDelaySlider(): Slider {
		return this._echoDelaySlider;
	}
	public get stringSustainSlider(): Slider {
		return this._stringSustainWidget.slider;
	}
	public get envelopeSpeedSlider(): Slider {
		return this._envelopeSpeedWidget.slider;
	}
	public get supersawDynamismSlider(): Slider {
		return this._supersawDynamismWidget.slider;
	}
	public get supersawSpreadSlider(): Slider {
		return this._supersawSpreadWidget.slider;
	}
	public get supersawShapeSlider(): Slider {
		return this._supersawShapeWidget.slider;
	}

	public get ringModSlider(): Slider {
		return this._ringModSlider;
	}
	public get ringModHzSlider(): Slider {
		return this._ringModHzSlider;
	}
	public get phaserMixSlider(): Slider {
		return this._phaserMixSlider;
	}
	public get phaserFreqSlider(): Slider {
		return this._phaserFreqSlider;
	}
	public get phaserFeedbackSlider(): Slider {
		return this._phaserFeedbackSlider;
	}
	public get phaserStagesSlider(): Slider {
		return this._phaserStagesSlider;
	}
	public get granularSlider(): Slider {
		return this._granularSlider;
	}
	public get grainAmountsSlider(): Slider {
		return this._grainAmountsSlider;
	}
	public get grainSizeSlider(): Slider {
		return this._grainSizeSlider;
	}
	public get grainRangeSlider(): Slider {
		return this._grainRangeSlider;
	}
	public get showModSliders(): boolean[][] {
		return this._showModSliders;
	}

	// KeyboardHandlerHost interface getters
	public get patternEditor(): PatternEditor {
		return this._patternEditor;
	}
	public get muteEditor(): MuteEditor {
		return this._muteEditor;
	}
	public get trackEditor(): TrackEditor {
		return this._trackEditor;
	}
	public get loopEditor(): LoopEditor {
		return this._loopEditor;
	}
	public get barScrollBar(): BarScrollBar {
		return this._barScrollBar;
	}
	public get keyboardLayout(): KeyboardLayout {
		return this._keyboardLayout;
	}
	public get openOperatorDropdowns(): boolean[] {
		return this._openOperatorDropdowns;
	}
	public get songTitleInputBox(): HTMLInputElement {
		return this._songTitleInputBox.input;
	}
	public get upperNoteLimitInputBox(): HTMLInputElement {
		return this._upperNoteLimitInputBox;
	}
	public get lowerNoteLimitInputBox(): HTMLInputElement {
		return this._lowerNoteLimitInputBox;
	}
	public get panSliderInputBox(): HTMLInputElement {
		return this._panWidget.inputBox;
	}
	public get pwmSliderInputBox(): HTMLInputElement {
		return this._pulseWidthWidget.inputBox;
	}
	public get detuneSliderInputBox(): HTMLInputElement {
		return this._detuneSliderInputBox;
	}
	public get distortionInputBox(): HTMLInputElement {
		return this._distortionWidget.inputBox;
	}
	public get instrumentVolumeSliderInputBox(): HTMLInputElement {
		return this._instrumentVolumeWidget.inputBox;
	}

	public get chipWaveLoopStartStepper(): HTMLInputElement {
		return this._chipWaveLoopStartStepper;
	}
	public get chipWaveLoopEndStepper(): HTMLInputElement {
		return this._chipWaveLoopEndStepper;
	}
	public get chipWaveStartOffsetStepper(): HTMLInputElement {
		return this._chipWaveStartOffsetStepper;
	}
	public get octaveStepper(): HTMLInputElement {
		return this._octaveStepper;
	}
	public get unisonVoicesInputBox(): HTMLInputElement {
		return this._unisonVoicesInputBox;
	}
	public get unisonSpreadInputBox(): HTMLInputElement {
		return this._unisonSpreadInputBox;
	}
	public get unisonOffsetInputBox(): HTMLInputElement {
		return this._unisonOffsetInputBox;
	}
	public get unisonExpressionInputBox(): HTMLInputElement {
		return this._unisonExpressionInputBox;
	}
	public get unisonSignInputBox(): HTMLInputElement {
		return this._unisonSignInputBox;
	}
	public get monophonicNoteInputBox(): HTMLInputElement {
		return this._monophonicNoteInputBox;
	}
	public get drumsetGroup(): HTMLElement {
		return this._drumsetGroup;
	}
	public get drumsetZoom(): HTMLButtonElement {
		return this._drumsetZoom;
	}
	public get drumsetEnvelopeSelects(): HTMLSelectElement[] {
		return this._drumsetEnvelopeSelects;
	}
	public get drumsetSpectrumEditors(): SpectrumEditor[] {
		return this._drumsetSpectrumEditors;
	}
	public get phaseModGroup(): HTMLElement {
		return this._phaseModGroup;
	}
	public get operatorRows(): HTMLDivElement[] {
		return this._operatorRows;
	}
	public get operatorFrequencySelects(): HTMLSelectElement[] {
		return this._operatorFrequencySelects;
	}
	public get operatorDropdowns(): HTMLButtonElement[] {
		return this._operatorDropdowns;
	}
	public get operatorWaveformHints(): HTMLSpanElement[] {
		return this._operatorWaveformHints;
	}
	public get operatorWaveformSelects(): HTMLSelectElement[] {
		return this._operatorWaveformSelects;
	}
	public get operatorWaveformPulsewidthSliders(): Slider[] {
		return this._operatorWaveformPulsewidthSliders;
	}
	public get operatorWaveformPulsewidthInputBoxes(): HTMLInputElement[] {
		return this._operatorWaveformPulsewidthInputBoxes;
	}
	public get operatorDropdownRows(): HTMLElement[] {
		return this._operatorDropdownRows;
	}
	public get operatorAdsrAttackSliders(): Slider[] {
		return this._operatorAdsrAttackSliders;
	}
	public get operatorAdsrDecaySliders(): Slider[] {
		return this._operatorAdsrDecaySliders;
	}
	public get operatorAdsrSustainSliders(): Slider[] {
		return this._operatorAdsrSustainSliders;
	}
	public get operatorAdsrReleaseSliders(): Slider[] {
		return this._operatorAdsrReleaseSliders;
	}
	public get operatorAdsrAttackInputBoxes(): HTMLInputElement[] {
		return this._operatorAdsrAttackInputBoxes;
	}
	public get operatorAdsrDecayInputBoxes(): HTMLInputElement[] {
		return this._operatorAdsrDecayInputBoxes;
	}
	public get operatorAdsrSustainInputBoxes(): HTMLInputElement[] {
		return this._operatorAdsrSustainInputBoxes;
	}
	public get operatorAdsrReleaseInputBoxes(): HTMLInputElement[] {
		return this._operatorAdsrReleaseInputBoxes;
	}
	public get operatorAdsrRows(): HTMLDivElement[] {
		return this._operatorAdsrRows;
	}
	public get operatorDropdownGroups(): HTMLDivElement[] {
		return this._operatorDropdownGroups;
	}
	public get modulatorGroup(): HTMLElement {
		return this._modulatorGroup;
	}
	public get modNameRows(): HTMLElement[] {
		return this._modNameRows;
	}
	public get modSetRows(): HTMLElement[] {
		return this._modSetRows;
	}
	public get modFilterRows(): HTMLElement[] {
		return this._modFilterRows;
	}
	public get modEnvelopeRows(): HTMLElement[] {
		return this._modEnvelopeRows;
	}
	public get modTargetIndicators(): SVGElement[] {
		return this._modTargetIndicators;
	}
	private get _layoutRefs(): LayoutRefs {
		return {
			muteEditor: this._muteEditor,
			trackVisibleArea: this._trackVisibleArea,
			barScrollBar: this._barScrollBar,
			trackEditor: this._trackEditor,
			trackAndMuteContainer: this._trackAndMuteContainer,
			patternEditor: this._patternEditor,
			piano: this._piano,
			octaveScrollBar: this._octaveScrollBar,
			volumeBarBox: this._volumeBarBox,
			globalSpectrumContainer: this._globalSpectrumContainer,
			overlaySpectrumContainer: this._overlaySpectrumContainer,
			overlaySpectrum: this._overlaySpectrum,
			sampleLoadingStatusContainer: this._sampleLoadingStatusContainer,
			instrumentCopyGroup: this._instrumentCopyGroup,
			instrumentExportGroup: this._instrumentExportGroup,
			instrumentSettingsArea: this._instrumentSettingsArea,
			patternEditorRow: this._patternEditorRow,
			patternEditorPrev: this._patternEditorPrev,
			patternEditorNext: this._patternEditorNext,
			zoomInButton: this._zoomInButton,
			zoomOutButton: this._zoomOutButton,
		};
	}
	private get _songSettingsRefs(): SongSettingsRefs {
		return {
			scaleSelect: this._scaleSelect,
			keySelect: this._keySelect,
			octaveStepper: this._octaveStepper,
			tempoSlider: this._tempoSlider,
			tempoStepper: this._tempoStepper,
			songTitleInputBox: this._songTitleInputBox,
			songEqFilterEditor: this._songEqFilterEditor,
			eqFilterTypeRow: this._eqFilterTypeRow,
			eqFilterSimpleButton: this._eqFilterSimpleButton,
			eqFilterAdvancedButton: this._eqFilterAdvancedButton,
			eqFilterRow: this._eqFilterRow,
			eqFilterSimpleCutRow: this._eqFilterSimpleCutWidget.row,
			eqFilterSimplePeakRow: this._eqFilterSimplePeakWidget.row,
			rhythmSelect: this._rhythmSelect,
		};
	}
	private get _presetSetupRefs(): PresetSetupRefs {
		return {
			customInstrumentSettingsGroup: this._customInstrumentSettingsGroup,
			panSliderRow: this._panWidget.row,
			panDropdownGroup: this._panDropdownGroup,
			detuneSliderRow: this._detuneSliderRow,
			instrumentVolumeSliderRow: this._instrumentVolumeWidget.row,
			instrumentTypeSelectRow: this._instrumentPresetSelectRow,
			instrumentTypeRow: this._instrumentTypeRow,
			instrumentSettingsGroup: this._instrumentSettingsGroup,
			instrumentExportGroup: this._instrumentExportGroup,
			instrumentCopyGroup: this._instrumentCopyGroup,
			instrumentsButtonRow: this._instrumentsButtonRow,
			instrumentSettingsTextRow: this._instrumentSettingsTextRow,
			modulatorGroup: this._modulatorGroup,
			pitchedPresetSelect: this._pitchedPresetSelect,
			drumPresetSelect: this._drumPresetSelect,
		};
	}
	private get _instrumentValueRefs(): InstrumentValueRefs {
		return {
			instrumentTypeSelect: this._instrumentTypeSelect,
			transitionSelect: this._transitionSelect,
			vibratoSelect: this._vibratoSelect,
			vibratoTypeSelect: this._vibratoTypeSelect,
			chordSelect: this._chordSelect,
			panSliderInputBox: this._panWidget.inputBox,
			pwmSliderInputBox: this._pulseWidthWidget.inputBox,
			detuneSliderInputBox: this._detuneSliderInputBox,
			ringModHzNum: this.ringModHzNum,
			grainSizeNum: this.grainSizeNum,
			grainRangeNum: this.grainRangeNum,
			instrumentVolumeSlider: this._instrumentVolumeWidget.slider,
			instrumentVolumeSliderInputBox: this._instrumentVolumeWidget.inputBox,
			vibratoDepthInputBox: this._vibratoDepthWidget.inputBox,
			vibratoDelayInputBox: this._vibratoDelayWidget.inputBox,
			vibratoSpeedInputBox: this._vibratoSpeedWidget.inputBox,
			arpeggioSpeedInputBox: this._arpeggioSpeedWidget.inputBox,
			panDelayInputBox: this._panDelayWidget.inputBox,
			eqFilterSimpleCutInputBox: this._eqFilterSimpleCutWidget.inputBox,
			eqFilterSimplePeakInputBox: this._eqFilterSimplePeakWidget.inputBox,
			noteFilterSimpleCutInputBox: this._noteFilterSimpleCutWidget.inputBox,
			noteFilterSimplePeakInputBox: this._noteFilterSimplePeakWidget.inputBox,
			envelopeSpeedInputBox: this._envelopeSpeedWidget.inputBox,
			vibratoDepthSlider: this._vibratoDepthWidget.slider,
			vibratoDelaySlider: this._vibratoDelayWidget.slider,
			vibratoSpeedSlider: this._vibratoSpeedWidget.slider,
			vibratoSpeedDisplay: this._vibratoSpeedDisplay,
			panDelaySlider: this._panDelayWidget.slider,
			arpeggioSpeedSlider: this._arpeggioSpeedWidget.slider,
			arpeggioSpeedDisplay: this._arpeggioSpeedDisplay,
			eqFilterSimpleCutSlider: this._eqFilterSimpleCutWidget.slider,
			eqFilterSimplePeakSlider: this._eqFilterSimplePeakWidget.slider,
			noteFilterSimpleCutSlider: this._noteFilterSimpleCutWidget.slider,
			noteFilterSimplePeakSlider: this._noteFilterSimplePeakWidget.slider,
			envelopeSpeedSlider: this._envelopeSpeedWidget.slider,
			envelopeSpeedDisplay: this._envelopeSpeedDisplay,
			upperNoteLimitRow: this._upperNoteLimitRow,
			lowerNoteLimitRow: this._lowerNoteLimitRow,
		};
	}
	private get _postSyncRefs(): PostSyncRefs {
		return {
			instrumentSettingsGroup: this._instrumentSettingsGroup,
			eqFilterEditor: this._eqFilterEditor,
			songEqFilterEditor: this._songEqFilterEditor,
			instrumentVolumeSlider: this._instrumentVolumeWidget.slider,
			detuneSlider: this._detuneSlider,
			twoNoteArpBox: this._twoNoteArpBox,
			clicklessTransitionBox: this._clicklessTransitionBox,
			aliasingBox: this._aliasingBox,
			invertWaveBox: this._invertWaveBox,
			addEnvelopeButton: this._addEnvelopeButton,
			volumeSlider: this._volumeSlider,
			volumeInputBox: this._playbackControls.volumeInputBox,
			ringModWaveSelect: this._ringModWaveSelect,
			ringModPulsewidthSlider: this._ringModPulsewidthSlider,
			ringModWaveText: this._ringModWaveText,
			instrumentSettingsArea: this._instrumentSettingsArea,
			settingsArea: this._settingsArea,
		};
	}
	public get piano(): Piano {
		return this._piano;
	}
	public get customAlgorithmCanvas(): CustomAlgorithmCanvas {
		return this._customAlgorithmCanvas;
	}

	/**
	 * Plays the pitch currently under the mouse in whichever piano-roll
	 * component is being hovered (side piano or pattern editor). The
	 * caller must invoke `releaseHoveredPreview()` on keyup to stop
	 * the note. Returns true if a preview was actually started.
	 */
	public playHoveredPreview(): boolean {
		// The pattern editor and the side piano are siblings. We try the
		// pattern editor first because it covers the vast majority of the
		// editor area; the side piano is a narrow column.
		if (this.patternEditor.isHovering()) {
			return this.patternEditor.previewHoveredNote();
		}
		if (this.piano.isHovering()) {
			return this.piano.previewHoveredNote();
		}
		return false;
	}

	public releaseHoveredPreview(): void {
		this.patternEditor.releaseHoveredPreview();
		this.piano.releaseHoveredPreview();
	}
	public get tempoStepper(): HTMLInputElement {
		return this._tempoStepper;
	}
	public get scaleSelect(): HTMLSelectElement {
		return this._scaleSelect;
	}
	public get keySelect(): HTMLSelectElement {
		return this._keySelect;
	}
	public get rhythmSelect(): HTMLSelectElement {
		return this._rhythmSelect;
	}
	public get feedbackTypeSelect(): HTMLSelectElement {
		return this._feedbackTypeSelect;
	}
	public get opl3AlgorithmSelect(): HTMLSelectElement {
		return this._opl3AlgorithmSelect;
	}
	public get algorithmSelect(): HTMLSelectElement {
		return this._algorithmSelect;
	}
	public get feedback6OpTypeSelect(): HTMLSelectElement {
		return this._feedback6OpTypeSelect;
	}
	public get algorithm6OpSelect(): HTMLSelectElement {
		return this._algorithm6OpSelect;
	}
	public get instrumentButtons(): HTMLButtonElement[] {
		return this._instrumentButtons;
	}
	public get instrumentAddButton(): HTMLButtonElement {
		return this._instrumentAddButton;
	}
	public get instrumentRemoveButton(): HTMLButtonElement {
		return this._instrumentRemoveButton;
	}
	public get modChannelBoxes(): HTMLSelectElement[] {
		return this._modChannelBoxes;
	}
	public get modInstrumentBoxes(): HTMLSelectElement[] {
		return this._modInstrumentBoxes;
	}
	public get modSetBoxes(): HTMLSelectElement[] {
		return this._modSetBoxes;
	}
	public get modFilterBoxes(): HTMLSelectElement[] {
		return this._modFilterBoxes;
	}
	public get modEnvelopeBoxes(): HTMLSelectElement[] {
		return this._modEnvelopeBoxes;
	}
	public get chipWaveSelect(): HTMLSelectElement {
		return this._chipWaveSelect;
	}
	public get ringModWaveSelect(): HTMLSelectElement {
		return this._ringModWaveSelect;
	}
	public get useChipWaveAdvancedLoopControlsBox(): HTMLInputElement {
		return this._useChipWaveAdvancedLoopControlsBox;
	}
	public get chipWaveLoopModeSelect(): HTMLSelectElement {
		return this._chipWaveLoopModeSelect;
	}
	public get chipWavePlayBackwardsBox(): HTMLInputElement {
		return this._chipWavePlayBackwardsBox;
	}
	public get chipNoiseSelect(): HTMLSelectElement {
		return this._chipNoiseSelect;
	}
	public get transitionSelect(): HTMLSelectElement {
		return this._transitionSelect;
	}
	public get effectsSelect(): HTMLSelectElement {
		return this._effectsSelect;
	}
	public get vibratoSelect(): HTMLSelectElement {
		return this._vibratoSelect;
	}
	public get vibratoTypeSelect(): HTMLSelectElement {
		return this._vibratoTypeSelect;
	}
	public get unisonSelect(): HTMLSelectElement {
		return this._unisonSelect;
	}
	public get chordSelect(): HTMLSelectElement {
		return this._chordSelect;
	}
	public get pitchedPresetSelect(): HTMLButtonElement {
		return this._pitchedPresetSelect;
	}
	public get drumPresetSelect(): HTMLButtonElement {
		return this._drumPresetSelect;
	}
	public get setChipWaveLoopEndToEndButton(): HTMLButtonElement {
		return this._setChipWaveLoopEndToEndButton;
	}
	public get addEnvelopeButton(): HTMLButtonElement {
		return this._addEnvelopeButton;
	}

	// EventListenerSetupHost getters
	public get dispatch(): ChangeDispatcher {
		return this._dispatch;
	}
	public get keyboardHandler(): KeyboardHandler {
		return this._keyboardHandler;
	}
	public get customWaveDrawCanvas(): CustomChipCanvas {
		return this._customWaveDrawCanvas;
	}
	public get customWavePresetDrop(): HTMLSelectElement {
		return this._customWavePresetDrop;
	}
	public get playButton(): HTMLButtonElement {
		return this._playButton;
	}
	public get pauseButton(): HTMLButtonElement {
		return this._pauseButton;
	}
	public get recordButton(): HTMLButtonElement {
		return this._recordButton;
	}
	public get stopButton(): HTMLButtonElement {
		return this._stopButton;
	}
	public get prevBarButton(): HTMLButtonElement {
		return this._prevBarButton;
	}
	public get nextBarButton(): HTMLButtonElement {
		return this._nextBarButton;
	}
	public get volumeBarContainer(): SVGSVGElement {
		return this._playbackControls.volumeBarContainer;
	}
	public get patternArea(): HTMLDivElement {
		return this._patternArea;
	}
	public get trackArea(): HTMLDivElement {
		return this._trackArea;
	}
	public get fadeInOutEditor(): { container: HTMLElement } {
		return this._fadeInOutEditor;
	}
	public get spectrumEditor(): { container: HTMLElement } {
		return this._spectrumEditor;
	}
	public get eqFilterEditor(): { container: HTMLElement } {
		return this._eqFilterEditor;
	}
	public get noteFilterEditor(): { container: HTMLElement } {
		return this._noteFilterEditor;
	}
	public get songEqFilterEditor(): { container: HTMLElement } {
		return this._songEqFilterEditor;
	}
	public get harmonicsEditor(): { container: HTMLElement } {
		return this._harmonicsEditor;
	}
	public getShiftHeld(): boolean {
		return this._shiftHeld;
	}
	public get instrumentCopyButton(): HTMLButtonElement {
		return this._instrumentCopyButton;
	}
	public get instrumentPasteButton(): HTMLButtonElement {
		return this._instrumentPasteButton;
	}
	public get instrumentExportButton(): HTMLButtonElement {
		return this._instrumentExportButton;
	}
	public get instrumentImportButton(): HTMLButtonElement {
		return this._instrumentImportButton;
	}
	public get jumpToModIndicator(): SVGElement {
		return this._jumpToModIndicator;
	}
	public get customWaveDraw(): HTMLDivElement {
		return this._customWaveDraw;
	}
	public get twoNoteArpBox(): HTMLInputElement {
		return this._twoNoteArpBox;
	}
	public get clicklessTransitionBox(): HTMLInputElement {
		return this._clicklessTransitionBox;
	}
	public get aliasingBox(): HTMLInputElement {
		return this._aliasingBox;
	}
	public get invertWaveBox(): HTMLInputElement {
		return this._invertWaveBox;
	}

	public get promptContainer(): HTMLDivElement {
		return this._promptContainer;
	}
	public get sampleLoadingStatusContainer(): HTMLDivElement {
		return this._sampleLoadingStatusContainer;
	}
	public get instrumentsButtonBar(): HTMLDivElement {
		return this._instrumentsButtonBar;
	}
	public get trackAndMuteContainer(): HTMLDivElement {
		return this._trackAndMuteContainer;
	}

	// EventListenerSetupHost methods
	public whenPrevBarPressed(): void {
		this._whenPrevBarPressed();
	}
	public whenNextBarPressed(): void {
		this._whenNextBarPressed();
	}
	public setVolumeSlider(): void {
		this._setVolumeSlider();
	}
	public zoomIn(): void {
		this._zoomIn();
	}
	public zoomOut(): void {
		this._zoomOut();
	}
	public refocusStageNotEditing(): void {
		this._refocusStageNotEditing();
	}
	public tempoStepperCaptureNumberKeys(event: KeyboardEvent): void {
		this._tempoStepperCaptureNumberKeys(event);
	}
	public disableCtrlContextMenu(event: MouseEvent): boolean {
		return this._disableCtrlContextMenu(event);
	}
	public handleGlobalKeyDown(event: KeyboardEvent): void {
		this._handleGlobalKeyDown(event);
	}
	public onFocusIn(event: FocusEvent): void {
		this._onFocusIn(event);
	}
	public updateSampleLoadingBar(event: SampleLoadedEvent): void {
		this._updateSampleLoadingBar(event);
	}

	public onTrackAreaScroll(event: Event): void {
		this._onTrackAreaScroll(event);
	}
	public customWavePresetHandler(event: Event): void {
		this._customWavePresetHandler(event);
	}

	// Used as click handler — Promise errors caught internally, no caller await needed

	public async toggleRecord(): Promise<void> {
		if (this.doc.synth.playing) {
			this.doc.performance.pause();
		} else {
			await this.doc.performance.record();
		}
	}
	public openPrompt(name: string): void {
		this._openPrompt(name);
	}
	public openCommandPalette(): void {
		this._commandPalette.open();
	}
	public showNavigatorRouteHints(): void {
		this._navigatorShell.showRouteHints();
	}
	public copyInstrument(): void {
		this._dispatch.copyInstrument();
	}
	public pasteInstrument(): void {
		this._dispatch.pasteInstrument();
	}
	public randomPreset(): void {
		this._dispatch.randomPreset();
	}
	public randomGenerated(alt: boolean): void {
		this._dispatch.randomGenerated(alt);
	}
	public nextPreset(): void {
		this._dispatch.nextPreset();
	}
	public copyTextToClipboard(text: string): void {
		this._copyTextToClipboard(text);
	}
	public toggleDropdownMenu(id: number, index?: number): void {
		this._toggleDropdownMenu(id, index);
	}
	public renderInstrumentBar(
		channel: Channel,
		instrumentIndex: number,
		colors: ChannelColors,
	): void {
		this._renderInstrumentBar(channel, instrumentIndex, colors);
	}
	public movePlayheadToMouseTrack(): boolean {
		return this._trackEditor.movePlayheadToMouse();
	}
	public movePlayheadToMousePattern(): boolean {
		return this._patternEditor.movePlayheadToMouse();
	}
	public setCtrlHeld(value: boolean): void {
		this._ctrlHeld = value;
	}
	public setShiftHeld(value: boolean): void {
		this._shiftHeld = value;
	}

	private _openPanDropdown: boolean = false;
	private _visRefs!: InstrumentVisibilityRefs;
	private _modSettingsRefs!: ModSettingsRefs;
	private _modSettingsCallbacks!: ModSettingsCallbacks;
	private _openVibratoDropdown: boolean = false;
	private _openEnvelopeDropdown: boolean = false;
	private _openChordDropdown: boolean = false;
	private _openTransitionDropdown: boolean = false;
	private _openOperatorDropdowns: boolean[] = [];
	private _openPulseWidthDropdown: boolean = false;
	private _openUnisonDropdown: boolean = false;

	private readonly _animator: PlayerAnimator;
	public patternUsed: boolean = false;
	private _modRecTimeout: number = -1;

	public redrawThemeRasters(): void {
		this._patternEditorPrev.render();
		this._patternEditor.render();
		this._patternEditorNext.render();
		this._customWaveDrawCanvas.redrawCanvas();
		this._customAlgorithmCanvas.redrawCanvas(true);
	}

	constructor(/*private _doc: SongDocument*/) {
		this._navigatorShell.setDockController(this._promptManager.dockController);
		this._promptContainer.append(this._navigatorShell.container);
		this.mainLayer.append(this._commandPalette.container);
		this._keyboardHandler = new KeyboardHandler(this);
		this._dispatch = new ChangeDispatcher(this);
		getPMDRealtimeHueCoordinator(window).ensureEnabled(this.doc.prefs.pmdRealtimeHue);
		registerSongEditorThemeRasterOwner(this);

		// Track the <select> opened by pointer so editor focus can be
		// restored after the dropdown closes, without stealing focus during
		// the opening click (Firefox closes the native dropdown when focus
		// is ripped within ~1 frame). The stored select persists across the
		// opening mouseup until the dropdown actually closes via pick,
		// Escape, or off-click.
		let openedSelect: HTMLSelectElement | null = null;
		let keyboardNavigatingSelect = false;
		document.addEventListener("mousedown", (event: Event) => {
			const target = (event.target as HTMLElement | null)?.closest("select");
			if (target instanceof HTMLSelectElement) {
				// Clicking the already-open select toggles it closed. The browser
				// closes the popup on mousedown, so schedule focus restore after
				// the browser settles. The opening click (openedSelect was null)
				// just arms the tracker without touching focus. Re-check inside
				// the rAF: if the user re-opened this or another select before
				// the frame fired, openedSelect is re-armed and we must not steal
				// focus from the freshly opened popup.
				if (openedSelect === target) {
					openedSelect = null;
					keyboardNavigatingSelect = false;
					requestAnimationFrame(() => {
						if (openedSelect !== null) return;
						const active = document.activeElement;
						if (active instanceof HTMLSelectElement) return;
						this.mainLayer.focus({ preventScroll: true });
					});
				} else {
					openedSelect = target;
					keyboardNavigatingSelect = false;
				}
			} else {
				// Click outside any select clears stale tracker state so a later
				// click on the same select is treated as an open, not a toggle.
				openedSelect = null;
				keyboardNavigatingSelect = false;
			}
		});
		document.addEventListener("mouseup", () => {
			keyboardNavigatingSelect = false;
			requestAnimationFrame(() => {
				const activeElement = document.activeElement;
				if (activeElement === document.body || activeElement instanceof HTMLButtonElement) {
					openedSelect = null;
					this.mainLayer.focus({ preventScroll: true });
				}
			});
		});
		// After a pointer pick from a <select>, restore mainLayer focus so the
		// next Space toggles playback instead of re-opening the select. Gated
		// on openedSelect and !keyboardNavigatingSelect so keyboard arrow
		// navigation through options (which also fires change in some browsers)
		// does not rip focus mid-navigation. Restoring on change (not mouseup)
		// avoids stealing focus during the opening click, which closes the
		// native dropdown on Firefox.
		document.addEventListener("change", (event: Event) => {
			if (
				openedSelect !== null &&
				!keyboardNavigatingSelect &&
				event.target instanceof HTMLSelectElement
			) {
				openedSelect = null;
				requestAnimationFrame(() => {
					this.mainLayer.focus({ preventScroll: true });
				});
			}
		});
		// Keyboard interaction with an open select: arrow keys mark
		// navigation (suppress change-driven focus restoration), Enter
		// commits the pick (clears the marker so the following change
		// restores focus), Escape closes the popup and restores focus.
		document.addEventListener("keydown", (event: KeyboardEvent) => {
			if (openedSelect === null) return;
			const target = event.target as HTMLElement | null;
			if (target?.closest("select") !== openedSelect) return;
			if (
				event.keyCode === 37 ||
				event.keyCode === 38 ||
				event.keyCode === 39 ||
				event.keyCode === 40
			) {
				keyboardNavigatingSelect = true;
			} else if (event.keyCode === 13) {
				keyboardNavigatingSelect = false;
			} else if (event.keyCode === 27) {
				openedSelect = null;
				keyboardNavigatingSelect = false;
				requestAnimationFrame(() => {
					this.mainLayer.focus({ preventScroll: true });
				});
			}
		});
		// Capture-phase keyboard interceptor. Routes arrow keys and
		// space to the keyboard handler instead of letting them scroll
		// the page when focus is outside mainLayer (e.g. after clicking
		// the track editor or pattern area during playback).
		document.addEventListener(
			"keydown",
			(e: KeyboardEvent) => {
				if (this.mainLayer.contains(e.target as Node)) return;
				if (e.keyCode === 32 || e.keyCode === 38 || e.keyCode === 40) {
					const target = e.target as HTMLElement;
					if (
						target instanceof HTMLInputElement ||
						target instanceof HTMLTextAreaElement ||
						target instanceof HTMLSelectElement ||
						target instanceof HTMLButtonElement ||
						target.isContentEditable
					) {
						return;
					}
					e.preventDefault();
					this._keyboardHandler.handleKeyDown(e);
				}
			},
			{ capture: true },
		);
		this._animator = new PlayerAnimator(this.doc, {
			modSliderUpdate: () => {
				this._modSliderUpdate();
			},
			getCtrlHeld: () => this._ctrlHeld,
			getShiftHeld: () => this._shiftHeld,
			eqFilterEditor: this._eqFilterEditor,
			noteFilterEditor: this._noteFilterEditor,
			songEqFilterEditor: this._songEqFilterEditor,
			barScrollBar: this._barScrollBar,
			outVolumeBar: this._playbackControls.volumeBarContainer.querySelector(
				"rect:nth-child(3)",
			) as SVGRectElement,
			outVolumeCap: this._playbackControls.volumeBarContainer.querySelector(
				"rect:nth-child(4)",
			) as SVGRectElement,
			barPosLabel: this._playbackControls.barPosLabel,
		});
		// Arm the animator from SongPerformance's play-state observer so
		// every play entry point starts the loop without per-call wiring.
		this.doc.performance.animatorStart = this._animator.start;
		new MenuHandler(this, this._fileMenu, this._editMenu, this._optionsMenu);

		this.doc.notifier.watch(this.whenUpdated);
		this.doc.notifier.watch(() => {
			this._onDocPromptChange();
		});
		this.doc.modRecordingHandler = () => {
			this.handleModRecording();
		};
		new MidiInputHandler(this.doc);

		// Drag-and-drop file import for .mid, .midi, and .json files.
		// Attach to window to ensure it always fires during playback
		// (mainLayer may not receive events when player animator is active).
		const _onDragOver = (e: DragEvent) => {
			if (e.dataTransfer && e.dataTransfer.types.indexOf("Files") !== -1) {
				e.preventDefault();
			}
		};
		const _onDrop = (e: DragEvent) => {
			if (!e.dataTransfer) return;
			const files: FileList = e.dataTransfer.files;
			if (files.length === 0) return;
			const file: File = files[0];
			const name: string = file.name.toLowerCase();
			if (name.endsWith(".mid") || name.endsWith(".midi") || name.endsWith(".json")) {
				e.preventDefault();
				this.handleImportFile(file);
			}
		};
		window.addEventListener("dragover", _onDragOver);
		window.addEventListener("drop", _onDrop);

		window.addEventListener("resize", this._onResize);
		frameScheduler.register(this.updatePlayButton);
		// Animator loop is no longer started unconditionally; it self-gates
		// on synth.playing/recording and is armed by SongPerformance's
		// rAF observer on the rising edge of playback (see animatorStart).

		this._scaleSelect.appendChild(
			optgroup(
				{ label: "Edit" },
				option({ value: "forceScale" }, "Snap Notes To Scale"),
				option({ value: "customize" }, "Edit Custom Scale"),
			),
		);
		this._keySelect.appendChild(
			optgroup({ label: "Edit" }, option({ value: "detectKey" }, "Detect Key")),
		);
		this._rhythmSelect.appendChild(
			optgroup({ label: "Edit" }, option({ value: "forceRhythm" }, "Snap Notes To Rhythm")),
		);

		this._vibratoSelect.appendChild(option({ hidden: true, value: 5 }, "custom"));

		this._unisonSelect.appendChild(
			option({ hidden: true, value: Config.unisons.length }, "custom"),
		);

		this._showModSliders = new Array<boolean[]>(Config.modulators.length);
		this._modSliderValues = new Array<number[]>(Config.modulators.length);
		// set default values
		for (let i = 0; i < Config.modulators.length; i++) {
			this._newShowModSliders[i] = [];
			this._showModSliders[i] = [];
			this._modSliderValues[i] = [];
		}

		new FmOperatorSetup(this);

		new DrumsetSetup(this);

		new ModulatorSetup(this);

		new EventListenerSetup(this);

		this._instrumentTypeSelect.addEventListener("change", this._onInstrumentTypeChange);
		// Prevent page scroll when using arrow keys on type select
		this._instrumentTypeSelect.addEventListener("keydown", (event: KeyboardEvent) => {
			if (event.key === "ArrowUp" || event.key === "ArrowDown") {
				event.preventDefault();
			}
		});

		this._zoomInButton.addEventListener("click", () => {
			this._zoomIn();
		});
		this._zoomOutButton.addEventListener("click", () => {
			this._zoomOut();
		});

		if (isMobile) {
			const autoPlayOption: HTMLOptionElement = <HTMLOptionElement>(
				this._optionsMenu.querySelector("[value=autoPlay]")
			);
			setDisabled(autoPlayOption, true);
			autoPlayOption.setAttribute("hidden", "");
		}

		// Beepbox uses availHeight too, but certain displays may fail the check even when one of the other layouts would look better. -jummbus
		if (window.screen.availWidth < 710 /*|| window.screen.availHeight < 710*/) {
			const layoutOption: HTMLOptionElement = <HTMLOptionElement>(
				this._optionsMenu.querySelector("[value=layout]")
			);
			setDisabled(layoutOption, true);
			layoutOption.setAttribute("hidden", "");
		}

		this._visRefs = {
			chipWaveSelectRow: this._chipWaveSelectRow,
			chipWaveSelect: this._chipWaveSelect,
			chipNoiseSelectRow: this._chipNoiseSelectRow,
			chipNoiseSelect: this._chipNoiseSelect,
			useChipWaveAdvancedLoopControlsRow: this._useChipWaveAdvancedLoopControlsRow,
			useChipWaveAdvancedLoopControlsBox: this._useChipWaveAdvancedLoopControlsBox,
			chipWaveLoopModeSelectRow: this._chipWaveLoopModeSelectRow,
			chipWaveLoopModeSelect: this._chipWaveLoopModeSelect,
			chipWaveLoopStartRow: this._chipWaveLoopStartRow,
			chipWaveLoopStartStepper: this._chipWaveLoopStartStepper,
			chipWaveLoopEndRow: this._chipWaveLoopEndRow,
			chipWaveLoopEndStepper: this._chipWaveLoopEndStepper,
			chipWaveStartOffsetRow: this._chipWaveStartOffsetRow,
			chipWaveStartOffsetStepper: this._chipWaveStartOffsetStepper,
			chipWavePlayBackwardsRow: this._chipWavePlayBackwardsRow,
			chipWavePlayBackwardsBox: this._chipWavePlayBackwardsBox,
			spectrumRow: this._spectrumRow,
			spectrumEditor: this._spectrumEditor,
			harmonicsRow: this._harmonicsRow,
			harmonicsEditor: this._harmonicsEditor,
			stringSustainRow: this._stringSustainWidget.row,
			stringSustainSlider: this._stringSustainWidget.slider,
			stringSustainInputBox: this._stringSustainWidget.inputBox,
			stringSustainLabel: this._stringSustainLabel,
			drumsetGroup: this._drumsetGroup,
			drumsetEnvelopeSelects: this._drumsetEnvelopeSelects,
			drumsetSpectrumEditors: this._drumsetSpectrumEditors,
			fadeInOutRow: this._fadeInOutRow,
			fadeInOutEditor: this._fadeInOutEditor,
			customWaveDraw: this._customWaveDraw,
			supersawDynamismRow: this._supersawDynamismWidget.row,
			supersawDynamismSlider: this._supersawDynamismWidget.slider,
			supersawDynamismInputBox: this._supersawDynamismWidget.inputBox,
			supersawSpreadRow: this._supersawSpreadWidget.row,
			supersawSpreadSlider: this._supersawSpreadWidget.slider,
			supersawSpreadInputBox: this._supersawSpreadWidget.inputBox,
			supersawShapeRow: this._supersawShapeWidget.row,
			supersawShapeSlider: this._supersawShapeWidget.slider,
			supersawShapeInputBox: this._supersawShapeWidget.inputBox,
			pulseWidthRow: this._pulseWidthWidget.row,
			pulseWidthSlider: this._pulseWidthWidget.slider,
			decimalOffsetSlider: this._decimalOffsetWidget.slider,
			decimalOffsetInputBox: this._decimalOffsetWidget.inputBox,
			pulseWidthDropdownGroup: this._pulseWidthDropdownGroup,
			phaseModGroup: this._phaseModGroup,
			opl3AlgorithmSelect: this._opl3AlgorithmSelect,
			algorithmSelect: this._algorithmSelect,
			feedbackTypeSelect: this._feedbackTypeSelect,
			feedbackAmplitudeSlider: this._feedbackAmplitudeWidget.slider,
			feedbackAmplitudeInputBox: this._feedbackAmplitudeWidget.inputBox,
			operatorRows: this._operatorRows,
			operatorFrequencySelects: this._operatorFrequencySelects,
			operatorAmplitudeSliders: this._operatorAmplitudeSliders,
			operatorAmplitudeInputBoxes: this._operatorAmplitudeInputBoxes,
			operatorWaveformSelects: this._operatorWaveformSelects,
			operatorWaveformPulsewidthSliders: this._operatorWaveformPulsewidthSliders,
			operatorWaveformPulsewidthInputBoxes: this._operatorWaveformPulsewidthInputBoxes,
			operatorDropdownGroups: this._operatorDropdownGroups,
			operatorWaveformHints: this._operatorWaveformHints,
			operatorAdsrAttackSliders: this._operatorAdsrAttackSliders,
			operatorAdsrDecaySliders: this._operatorAdsrDecaySliders,
			operatorAdsrSustainSliders: this._operatorAdsrSustainSliders,
			operatorAdsrReleaseSliders: this._operatorAdsrReleaseSliders,
			operatorAdsrAttackInputBoxes: this._operatorAdsrAttackInputBoxes,
			operatorAdsrDecayInputBoxes: this._operatorAdsrDecayInputBoxes,
			operatorAdsrSustainInputBoxes: this._operatorAdsrSustainInputBoxes,
			operatorAdsrReleaseInputBoxes: this._operatorAdsrReleaseInputBoxes,
			operatorAdsrRows: this._operatorAdsrRows,
			algorithm6OpSelect: this._algorithm6OpSelect,
			feedback6OpTypeSelect: this._feedback6OpTypeSelect,
			customAlgorithmCanvas: this._customAlgorithmCanvas,
			algorithm6OpSelectRow: this._algorithm6OpSelectRow,
			feedback6OpRow1: this._feedback6OpRow1,
			opl3AlgorithmSelectRow: this._opl3AlgorithmSelectRow,
			algorithmSelectRow: this._algorithmSelectRow,
			feedbackRow1: this._feedbackRow1,
			feedbackRow2: this._feedbackAmplitudeWidget.row,
			transitionRow: this._transitionRow,
			transitionSelect: this._transitionSelect,
			transitionDropdownGroup: this._transitionDropdownGroup,
			chordSelectRow: this._chordSelectRow,
			chordSelect: this._chordSelect,
			chordDropdown: this._chordDropdown,
			chordDropdownGroup: this._chordDropdownGroup,
			monophonicNoteInputBox: this._monophonicNoteInputBox,
			chordSelectContainer: this._chordSelectContainer,
			pitchShiftRow: this._pitchShiftRow,
			pitchShiftSlider: this._pitchShiftWidget.slider,
			pitchShiftInputBox: this._pitchShiftWidget.inputBox,
			pitchShiftFifthMarkers: this._pitchShiftFifthMarkers,
			detuneSliderRow: this._detuneSliderRow,
			detuneSlider: this._detuneSlider,
			vibratoSelectRow: this._vibratoSelectRow,
			vibratoSelect: this._vibratoSelect,
			vibratoDropdownGroup: this._vibratoDropdownGroup,
			noteFilterTypeRow: this._noteFilterTypeRow,
			noteFilterEditor: this._noteFilterEditor,
			noteFilterSimpleButton: this._noteFilterSimpleButton,
			noteFilterAdvancedButton: this._noteFilterAdvancedButton,
			noteFilterRow: this._noteFilterRow,
			noteFilterSimpleCutRow: this._noteFilterSimpleCutWidget.row,
			noteFilterSimpleCutSlider: this._noteFilterSimpleCutWidget.slider,
			noteFilterSimpleCutInputBox: this._noteFilterSimpleCutWidget.inputBox,
			noteFilterSimplePeakRow: this._noteFilterSimplePeakWidget.row,
			noteFilterSimplePeakSlider: this._noteFilterSimplePeakWidget.slider,
			noteFilterSimplePeakInputBox: this._noteFilterSimplePeakWidget.inputBox,
			distortionRow: this._distortionWidget.row,
			aliasingRow: this._aliasingRow,
			distortionSlider: this._distortionWidget.slider,
			distortionInputBox: this._distortionWidget.inputBox,
			bitcrusherQuantizationRow: this._bitcrusherQuantizationWidget.row,
			bitcrusherQuantizationSlider: this._bitcrusherQuantizationWidget.slider,
			bitcrusherQuantizationInputBox: this._bitcrusherQuantizationWidget.inputBox,
			bitcrusherFreqRow: this._bitcrusherFreqWidget.row,
			bitcrusherFreqSlider: this._bitcrusherFreqWidget.slider,
			bitcrusherFreqInputBox: this._bitcrusherFreqWidget.inputBox,
			panSliderRow: this._panWidget.row,
			panDropdownGroup: this._panDropdownGroup,
			panSlider: this._panWidget.slider,
			chorusRow: this._chorusRow,
			chorusSlider: this._chorusSlider,
			chorusInputBox: this._chorusInputBox,
			echoSustainRow: this._echoSustainRow,
			echoSustainSlider: this._echoSustainSlider,
			echoSustainInputBox: this._echoSustainInputBox,
			echoDelayRow: this._echoDelayRow,
			echoDelaySlider: this._echoDelaySlider,
			echoDelayInputBox: this._echoDelayInputBox,
			reverbRow: this._reverbRow,
			reverbSlider: this._reverbSlider,
			reverbInputBox: this._reverbInputBox,
			ringModContainerRow: this._ringModContainerRow,
			ringModSlider: this._ringModSlider,
			ringModInputBox: this._ringModInputBox,
			ringModHzSlider: this._ringModHzSlider,
			ringModHzInputBox: this._ringModHzInputBox,
			ringModWaveSelect: this._ringModWaveSelect,
			ringModPulsewidthSlider: this._ringModPulsewidthSlider,
			ringModPulsewidthInputBox: this._ringModPulsewidthInputBox,
			granularContainerRow: this._granularContainerRow,
			granularSlider: this._granularSlider,
			granularInputBox: this._granularInputBox,
			grainSizeSlider: this._grainSizeSlider,
			grainSizeInputBox: this._grainSizeInputBox,
			grainAmountsSlider: this._grainAmountsSlider,
			grainAmountsInputBox: this._grainAmountsInputBox,
			grainRangeSlider: this._grainRangeSlider,
			grainRangeInputBox: this._grainRangeInputBox,
			phaserMixRow: this._phaserMixRow,
			phaserMixSlider: this._phaserMixSlider,
			phaserMixInputBox: this._phaserMixInputBox,
			phaserFreqRow: this._phaserFreqRow,
			phaserFreqSlider: this._phaserFreqSlider,
			phaserFreqInputBox: this._phaserFreqInputBox,
			phaserFeedbackRow: this._phaserFeedbackRow,
			phaserFeedbackSlider: this._phaserFeedbackSlider,
			phaserFeedbackInputBox: this._phaserFeedbackInputBox,
			phaserStagesRow: this._phaserStagesRow,
			phaserStagesSlider: this._phaserStagesSlider,
			phaserStagesInputBox: this._phaserStagesInputBox,
			compressorThresholdRow: this._compressorThresholdRow,
			compressorThresholdSlider: this._compressorThresholdSlider,
			compressorThresholdInputBox: this._compressorThresholdInputBox,
			compressorRatioRow: this._compressorRatioRow,
			compressorRatioSlider: this._compressorRatioSlider,
			compressorRatioInputBox: this._compressorRatioInputBox,
			compressorAttackRow: this._compressorAttackRow,
			compressorAttackSlider: this._compressorAttackSlider,
			compressorAttackInputBox: this._compressorAttackInputBox,
			compressorReleaseRow: this._compressorReleaseRow,
			compressorReleaseSlider: this._compressorReleaseSlider,
			compressorReleaseInputBox: this._compressorReleaseInputBox,
			compressorSyncRow: this._compressorSyncRow,
			compressorSyncSlider: this._compressorSyncSlider,
			compressorSyncInputBox: this._compressorSyncInputBox,
			combDelayRow: this._combDelayRow,
			combDelaySlider: this._combDelaySlider,
			combDelayInputBox: this._combDelayInputBox,
			combFeedbackRow: this._combFeedbackRow,
			combFeedbackSlider: this._combFeedbackSlider,
			combFeedbackInputBox: this._combFeedbackInputBox,
			combMixRow: this._combMixRow,
			combMixSlider: this._combMixSlider,
			combMixInputBox: this._combMixInputBox,
			combRateRow: this._combRateRow,
			combRateSlider: this._combRateSlider,
			combRateInputBox: this._combRateInputBox,
			combDepthRow: this._combDepthRow,
			combDepthSlider: this._combDepthSlider,
			combDepthInputBox: this._combDepthInputBox,
			invertWaveRow: this._invertWaveRow,
			upperNoteLimitRow: this._upperNoteLimitRow,
			upperNoteLimitInputBox: this._upperNoteLimitInputBox,
			lowerNoteLimitRow: this._lowerNoteLimitRow,
			lowerNoteLimitInputBox: this._lowerNoteLimitInputBox,
			unisonSelectRow: this._unisonSelectRow,
			unisonSelect: this._unisonSelect,
			unisonVoicesInputBox: this._unisonVoicesInputBox,
			unisonSpreadInputBox: this._unisonSpreadInputBox,
			unisonOffsetInputBox: this._unisonOffsetInputBox,
			unisonExpressionInputBox: this._unisonExpressionInputBox,
			unisonSignInputBox: this._unisonSignInputBox,
			unisonDropdownGroup: this._unisonDropdownGroup,
			envelopeDropdownGroup: this._envelopeDropdownGroup,
			envelopeEditor: this.envelopeEditor,
			instrumentSettingsGroup: this._instrumentSettingsGroup,
		};

		this._modSettingsRefs = {
			modulatorGroup: this._modulatorGroup,
			instrumentSettingsTextRow: this._instrumentSettingsTextRow,
			instrumentCopyGroup: this._instrumentCopyGroup,
			instrumentExportGroup: this._instrumentExportGroup,
			instrumentsButtonRow: this._instrumentsButtonRow,
			chipNoiseSelectRow: this._chipNoiseSelectRow,
			chipWaveSelectRow: this._chipWaveSelectRow,
			useChipWaveAdvancedLoopControlsRow: this._useChipWaveAdvancedLoopControlsRow,
			chipWaveLoopModeSelectRow: this._chipWaveLoopModeSelectRow,
			chipWaveLoopStartRow: this._chipWaveLoopStartRow,
			chipWaveLoopEndRow: this._chipWaveLoopEndRow,
			chipWaveStartOffsetRow: this._chipWaveStartOffsetRow,
			chipWavePlayBackwardsRow: this._chipWavePlayBackwardsRow,
			spectrumRow: this._spectrumRow,
			harmonicsRow: this._harmonicsRow,
			drumsetGroup: this._drumsetGroup,
			customWaveDraw: this._customWaveDraw,
			supersawDynamismRow: this._supersawDynamismWidget.row,
			supersawSpreadRow: this._supersawSpreadWidget.row,
			supersawShapeRow: this._supersawShapeWidget.row,
			algorithmSelectRow: this._algorithmSelectRow,
			phaseModGroup: this._phaseModGroup,
			feedbackRow1: this._feedbackRow1,
			feedbackRow2: this._feedbackAmplitudeWidget.row,
			pulseWidthRow: this._pulseWidthWidget.row,
			vibratoSelectRow: this._vibratoSelectRow,
			vibratoDropdownGroup: this._vibratoDropdownGroup,
			envelopeDropdownGroup: this._envelopeDropdownGroup,
			detuneSliderRow: this._detuneSliderRow,
			panSliderRow: this._panWidget.row,
			panDropdownGroup: this._panDropdownGroup,
			pulseWidthDropdownGroup: this._pulseWidthDropdownGroup,
			unisonDropdownGroup: this._unisonDropdownGroup,
			chordSelectRow: this._chordSelectRow,
			chordDropdownGroup: this._chordDropdownGroup,
			transitionRow: this._transitionRow,
			customInstrumentSettingsGroup: this._customInstrumentSettingsGroup,
			instrumentVolumeSliderRow: this._instrumentVolumeWidget.row,
			instrumentTypeSelectRow: this._instrumentPresetSelectRow,
			instrumentTypeRow: this._instrumentTypeRow,
			instrumentSettingsGroup: this._instrumentSettingsGroup,
			pitchedPresetSelect: this._pitchedPresetSelect,
			drumPresetSelect: this._drumPresetSelect,
			modChannelBoxes: this._modChannelBoxes,
			modInstrumentBoxes: this._modInstrumentBoxes,
			modSetBoxes: this._modSetBoxes,
			modFilterBoxes: this._modFilterBoxes,
			modEnvelopeBoxes: this._modEnvelopeBoxes,
			modTargetIndicators: this._modTargetIndicators,
			piano: this._piano,
			chordSelect: this._chordSelect,
		};

		this._modSettingsCallbacks = {
			usageCheck: (channelIndex: number, instrumentIndex: number) => {
				this._usageCheck(channelIndex, instrumentIndex);
			},
			renderInstrumentBar: (
				channel: Channel,
				instrumentIndex: number,
				colors: ChannelColors,
			) => {
				this._renderInstrumentBar(channel, instrumentIndex, colors);
			},
			whenSetModSetting: (mod: number, invalid?: boolean) => {
				this._dispatch.whenSetModSetting(mod, invalid);
			},
		};
	}

	private _updateSampleLoadingBar(e: SampleLoadedEvent): void {
		const percent: number =
			e.totalSamples === 0 ? 0 : Math.floor((e.samplesLoaded / e.totalSamples) * 100);
		this._sampleLoadingBar.style.width = `${percent}%`;
	}

	private _toggleAlgorithmCanvas(e: Event): void {
		if (this._customAlgorithmCanvas.mode !== "feedback") {
			this._customAlgorithmCanvas.mode = "feedback";
			(e.target as Element).textContent = "F";
			this._algorithmCanvasSwitch.value = "feedback";
		} else {
			this._customAlgorithmCanvas.mode = "algorithm";
			(e.target as Element).textContent = "A";
		}
		this._customAlgorithmCanvas.redrawCanvas();
	}

	private _toggleDropdownMenu(
		dropdown: DropdownID,
		submenu: number = 0,
		_subtype: string | null = null,
	): void {
		let target: HTMLButtonElement = this._vibratoDropdown;
		let group: HTMLElement = this._vibratoDropdownGroup;
		switch (dropdown) {
			case DropdownID.Envelope:
				target = this._envelopeDropdown;
				this._openEnvelopeDropdown = !this._openEnvelopeDropdown;
				group = this._envelopeDropdownGroup;
				break;
			case DropdownID.Vibrato:
				target = this._vibratoDropdown;
				this._openVibratoDropdown = !this._openVibratoDropdown;
				group = this._vibratoDropdownGroup;
				break;
			case DropdownID.Pan:
				target = this._panDropdown;
				this._openPanDropdown = !this._openPanDropdown;
				group = this._panDropdownGroup;
				break;
			case DropdownID.Chord:
				target = this._chordDropdown;
				this._openChordDropdown = !this._openChordDropdown;
				group = this._chordDropdownGroup;
				break;
			case DropdownID.Transition:
				target = this._transitionDropdown;
				this._openTransitionDropdown = !this._openTransitionDropdown;
				group = this._transitionDropdownGroup;
				break;
			case DropdownID.FM:
				target = this._operatorDropdowns[submenu];
				this._openOperatorDropdowns[submenu] = !this._openOperatorDropdowns[submenu];
				group = this._operatorDropdownGroups[submenu];
				break;
			case DropdownID.PulseWidth:
				target = this._pulseWidthDropdown;
				this._openPulseWidthDropdown = !this._openPulseWidthDropdown;
				group = this._pulseWidthDropdownGroup;
				break;
			case DropdownID.Unison:
				target = this._unisonDropdown;
				this._openUnisonDropdown = !this._openUnisonDropdown;
				group = this._unisonDropdownGroup;
				break;
			case DropdownID.EnvelopeSettings:
				target = this.envelopeEditor.extraSettingsDropdowns[submenu];
				this.envelopeEditor.openExtraSettingsDropdowns[submenu] =
					!this.envelopeEditor.openExtraSettingsDropdowns[submenu];
				group = this.envelopeEditor.extraSettingsDropdownGroups[submenu];
				break;
		}

		if (target.classList.contains("dropdown-open")) {
			// Close: group is visible → hide it
			for (let i: number = 0; i < group.children.length; i++) {
				(group.children[i] as HTMLElement).style.animationDelay = "0s";
				(group.children[i] as HTMLElement).style.opacity = "0";
			}
			target.classList.remove("dropdown-open");
			group.style.display = "none";
		} else {
			// Open: group is hidden → show it
			const instrument: Instrument = this.doc.getCurrentInstrumentObj();
			target.classList.add("dropdown-open");
			if (dropdown === DropdownID.EnvelopeSettings) {
				group.style.display = "flex";
				this.envelopeEditor.rerenderExtraSettings();
			} else if (group !== this._chordDropdownGroup) {
				group.style.display = "";
			} // Only show arpeggio dropdown if chord arpeggiates
			else if (instrument.chord === Config.chords.dictionary.arpeggio.index) {
				group.style.display = "";
				if (instrument.chord === Config.chords.dictionary.arpeggio.index) {
					this._chordDropdownGroup.style.display = "";
				} else {
					this._chordDropdownGroup.style.display = "none";
				}
			}

			for (let i: number = 0; i < group.children.length; i++) {
				// A timeout is needed so that the previous 0s, 0 opacity settings can be applied. They're not done until the group is visible again because display: none prunes animation steps.
				setTimeout(() => {
					(group.children[i] as HTMLElement).style.animationDelay = "0.17s";
					(group.children[i] as HTMLElement).style.opacity = "1";
				});
			}
		}
		setTimeout(() => {
			window.dispatchEvent(new Event("resize"));
			window.dispatchEvent(new Event("scroll"));
		});
	}

	private _modSliderUpdate(): void {
		if (!this.doc.synth.playing) {
			this._hasActiveModSliders = false;
			this._songEqFilterEditor.render();

			for (let setting: number = 0; setting < Config.modulators.length; setting++) {
				for (let index: number = 0; index <= Config.modulators[setting].maxIndex; index++) {
					if (this._showModSliders[setting][index]) {
						this._showModSliders[setting][index] = false;
						this._newShowModSliders[setting][index] = false;
						const slider: Slider | null = this.modSliders.getSliderForModSetting(
							setting,
							index,
						);

						if (slider != null) {
							slider.container.classList.remove("modSlider");
						}
					}
				}
			}

			// Reset tempo stepper to base value
			const baseTempo: number = Math.max(0, Math.round(this.doc.song.tempo));
			this._tempoStepper.value = baseTempo.toString();
			this._tempoStepper.classList.remove("modActive");
			this._tempoStepper.style.removeProperty("--mod-color");
		} else {
			const instrument: number = this.doc.getCurrentInstrument();
			const anyModActive: boolean = this.doc.synth.isAnyModActive(
				this.doc.channel,
				instrument,
			);

			// Check and update mod values on sliders
			if (anyModActive) {
				const instrument: number = this.doc.getCurrentInstrument();

				function updateModSlider(
					editor: SongEditor,
					slider: Slider,
					setting: number,
					channel: number,
					instrument: number,
					index: number,
				): boolean {
					if (editor.doc.synth.isModActive(setting, channel, instrument)) {
						if (Config.modulators[setting].maxIndex > 0) {
							// detect that the mod actually does need updating for the specific index
							const envelope =
								editor.doc.synth.song!.channels[channel].instruments[instrument]
									.envelopes[index];
							switch (setting) {
								case Config.modulators.dictionary["individual envelope speed"]
									.index: {
									if (envelope.tempEnvelopeSpeed == null) {
										return false;
									}
									break;
								}
								case Config.modulators.dictionary["individual envelope lower bound"]
									.index: {
									if (envelope.tempEnvelopeLowerBound == null) {
										return false;
									}
									break;
								}
								case Config.modulators.dictionary["individual envelope upper bound"]
									.index: {
									if (envelope.tempEnvelopeUpperBound == null) {
										return false;
									}
									break;
								}
							}
						}
						let currentVal: number =
							(editor.doc.synth.getModValue(setting, channel, instrument, false) -
								Config.modulators[setting].convertRealFactor) /
							Config.modulators[setting].maxRawVol;

						if (Config.modulators[setting].invertSliderIndicator === true) {
							currentVal = 1 - currentVal;
						}

						if (currentVal !== editor._modSliderValues[setting][index]) {
							editor._modSliderValues[setting][index] = currentVal;
							slider.container.style.setProperty(
								"--mod-position",
								`${currentVal * 96.0 + 2.0}%`,
							);
						}
						return true;
					}
					return false;
				}

				// Set mod sliders to present values
				for (let setting: number = 0; setting < Config.modulators.length; setting++) {
					for (
						let index: number = 0;
						index <= Config.modulators[setting].maxIndex;
						index++
					) {
						// Set to last value
						this._newShowModSliders[setting][index] = Boolean(
							this._showModSliders[setting][index],
						);

						// Check for newer value
						const slider: Slider | null = this.modSliders.getSliderForModSetting(
							setting,
							index,
						);

						if (slider != null) {
							this._newShowModSliders[setting][index] = updateModSlider(
								this,
								slider,
								setting,
								this.doc.channel,
								instrument,
								index,
							);
						}
					}
				}
			} else if (this._hasActiveModSliders) {
				// Zero out show-mod-slider settings (since none are active) to kill active mod slider flag
				for (let setting: number = 0; setting < Config.modulators.length; setting++) {
					for (
						let index: number = 0;
						index <= Config.modulators[setting].maxIndex;
						index++
					) {
						this._newShowModSliders[setting][index] = false;
					}
				}
			}

			// Class or unclass mod sliders based on present status
			if (anyModActive || this._hasActiveModSliders) {
				let anySliderActive: boolean = false;

				for (let setting: number = 0; setting < Config.modulators.length; setting++) {
					for (
						let index: number = 0;
						index <= Config.modulators[setting].maxIndex;
						index++
					) {
						if (
							this._newShowModSliders[setting][index] !==
							this._showModSliders[setting][index]
						) {
							this._showModSliders[setting][index] =
								this._newShowModSliders[setting][index];
							const slider: Slider | null = this.modSliders.getSliderForModSetting(
								setting,
								index,
							);

							if (slider != null) {
								if (this._showModSliders[setting][index]) {
									slider.container.classList.add("modSlider");
								} else {
									slider.container.classList.remove("modSlider");
								}
							}
						}

						if (this._newShowModSliders[setting][index]) {
							anySliderActive = true;
						}
					}
				}

				this._hasActiveModSliders = anySliderActive;
			}

			// Update tempo stepper with modded value every rAF frame
			const tempoModActive: boolean = this.doc.synth.isModActive(
				Config.modulators.dictionary.tempo.index,
			);
			const displayTempo: number = tempoModActive
				? Math.max(
						0,
						Math.round(
							this.doc.synth.getModValue(Config.modulators.dictionary.tempo.index),
						),
					)
				: Math.max(0, Math.round(this.doc.song.tempo));
			this._tempoStepper.value = displayTempo.toString();
			this._tempoStepper.classList.toggle("modActive", tempoModActive);
			if (tempoModActive) {
				this._tempoStepper.style.setProperty("--mod-color", "var(--subtext)");
			} else {
				this._tempoStepper.style.removeProperty("--mod-color");
			}
		}
	}

	private async _closeNavigatorMode(): Promise<boolean> {
		const closed = await this._navigatorRuntime.closeNavigator();
		if (closed) {
			this._lastPrompt = null;
			this.doc.prompt = null;
			// A pane that removed its own focused control (import swaps its
			// DOM for a loading view) leaves focus on <body>, where global
			// shortcuts such as Ctrl+O are not routed. Hand focus back.
			const active = document.activeElement;
			if (active === null || active === document.body) this.refocusStage();
		}
		return closed;
	}

	private _openPrompt(promptName: string): void {
		log.log("_openPrompt", promptName, { docPrompt: this.doc.prompt });
		if (promptName === "stringSustain" || promptName === "sampleLoadingStatus") {
			this._promptManager.open(promptName);
			return;
		}
		void this._applicationRouter.routePrompt(promptName);
	}

	public openPresetSelector(): void {
		log.log("openPresetSelector", { docPrompt: this.doc.prompt });
		this._openPrompt("instrumentBrowser");
	}

	public openShortcuts(): void {
		log.log("openShortcuts", { docPrompt: this.doc.prompt });
		this._openPrompt("keyboardShortcuts");
	}

	public closePrompt(prompt: Prompt | null): void {
		log.log("closePrompt", prompt?.name ?? null);
		void this._closeNavigatorMode();
	}

	public popoutCurrentPrompt(): void {
		const host = NavigatorDetachedHost.open(() => {
			this._promptManager.dockController.undock(this._navigatorShell);
		});
		if (host === null) return;
		void this._navigatorRuntime
			.detach((owner, _host, close, forceClose) => host.bind(owner, close, forceClose), host)
			.then((pane) => {
				if (pane === null) host.closeEmpty();
			})
			.catch(() => {
				host.closeEmpty();
			});
	}

	public promptShouldReceiveKeys = (): boolean => {
		return this._promptManager.shouldReceiveKeys();
	};

	public refocusStage = (): void => {
		this.mainLayer.focus({ preventScroll: true });
	};

	private _onFocusIn(event: Event): void {
		if (
			this.doc.synth.recording &&
			event.target !== this.mainLayer &&
			event.target !== this._stopButton &&
			event.target !== this._volumeSlider.input
		) {
			// Don't allow using tab to focus on the song settings while recording,
			// since interacting with them while recording would mess up the recording.
			this.refocusStage();
		}
	}

	// Global keydown handler: routes shortcuts when focus is outside mainLayer.
	// Captures arrow keys before document scrolls, routes them back to mainLayer.
	// Skips if focus is on an input, textarea, select, button, or contenteditable element.
	private _handleGlobalKeyDown(event: KeyboardEvent): void {
		if (event.isComposing) return; // Skip during IME composition
		if (this._keyboardHandler.handleNavigatorHintShortcut(event)) return;

		// If mainLayer has focus, its own handler already processes keys.
		if (this.mainLayer.contains(document.activeElement)) return;

		// Don't steal keys from form elements or contenteditable.
		const target = event.target as HTMLElement;
		const isFormElement =
			target instanceof HTMLInputElement ||
			target instanceof HTMLTextAreaElement ||
			target instanceof HTMLSelectElement ||
			target instanceof HTMLButtonElement;

		// Arrow keys: prevent page scroll and route to mainLayer's keyboard handler,
		// unless the target is a form element that needs them.
		if (
			event.key === "ArrowUp" ||
			event.key === "ArrowDown" ||
			event.key === "ArrowLeft" ||
			event.key === "ArrowRight"
		) {
			if (isFormElement || target.isContentEditable) return;
			event.preventDefault();
			this.mainLayer.focus({ preventScroll: true });
			this._keyboardHandler.handleKeyDown(event);
			return;
		}

		if (isFormElement || target.isContentEditable) return;

		// Slash is global outside note-input surfaces. The keyboard policy
		// chooses Command Palette, Shortcuts, ignore, or prompt isolation.
		if (routeGlobalSlashKey(event, this._keyboardHandler.handleKeyDown)) return;

		// Prompt-only shortcuts: only route if a prompt is open.
		if (!this.prompt) return;
		this._keyboardHandler.handleKeyDown(event);
	}

	// Refocus stage if a sub-element that needs focus isn't being edited.
	private _refocusStageNotEditing(): void {
		if (!this._patternEditor.editingModLabel) {
			this.mainLayer.focus({ preventScroll: true });
		}
	}

	public changeBarScrollPos(offset: number) {
		this._barScrollBar.changePos(offset);
	}

	// Resize events need full renderLayout even during playback
	// to recalculate trackVisibleBars, bar widths, etc.
	private _onResize = (): void => {
		renderLayout(this._layoutRefs, this.doc);
		this._promptManager.repositionOutOfBounds();
	};

	public whenUpdated = (): void => {
		const prefs: Preferences = this.doc.prefs;
		renderLayout(this._layoutRefs, this.doc);
		this._promptManager.syncBackdropPreference();
		this._navigatorShell.setBackdropPreference(prefs.showPromptBackdrop);
		this._navigatorShell.refreshRoutes();

		const instrumentIndex: number = this.doc.getCurrentInstrument();
		// During playback, skip repeated settings renders unless navigation changed
		// which channel or pattern instrument the controls must represent.
		if (
			this.doc.synth.playing &&
			this._renderedChannel === this.doc.channel &&
			this._renderedInstrument === instrumentIndex
		) {
			return;
		}

		this._promptManager.repositionOutOfBounds();

		renderOptionsMenu(this._optionsMenu, prefs, this.doc.song.scale);
		const textOnIcon: string = ColorConfig.getComputed("--text-enabled-icon");
		const textOffIcon: string = ColorConfig.getComputed("--text-disabled-icon");

		const channel: Channel = this.doc.song.channels[this.doc.channel];
		const instrument: Instrument = channel.instruments[instrumentIndex];
		const wasActive: boolean = this.mainLayer.contains(document.activeElement);
		const activeElement: Element | null = document.activeElement;
		const colors: ChannelColors = ColorConfig.getChannelColor(this.doc.song, this.doc.channel);

		renderEffectsSelect(this._effectsSelect, instrument, textOnIcon, textOffIcon);

		renderSongSettings(
			this._songSettingsRefs,
			this.doc,
			colors,
			this._ctrlHeld,
			this._shiftHeld,
		);

		if (!this.doc.song.getChannelIsMod(this.doc.channel)) {
			renderPresetSetup(
				this._presetSetupRefs,
				this.doc,
				instrument,
				prefs,
				this._openPanDropdown,
				this._usageCheck.bind(this),
			);

			if (this._visRefs != null) {
				applyInstrumentVisibility(
					this.doc,
					instrument,
					colors,
					prefs,
					this._visRefs,
					{
						openPanDropdown: this._openPanDropdown,
						openPulseWidthDropdown: this._openPulseWidthDropdown,
						openOperatorDropdowns: this._openOperatorDropdowns,
						openTransitionDropdown: this._openTransitionDropdown,
						openChordDropdown: this._openChordDropdown,
						openVibratoDropdown: this._openVibratoDropdown,
						openUnisonDropdown: this._openUnisonDropdown,
						openEnvelopeDropdown: this._openEnvelopeDropdown,
					},
					this._ctrlHeld,
					this._shiftHeld,
				);
			}

			renderInstrumentValues(this._instrumentValueRefs, this.doc, instrument);

			if (getInstrumentCapabilities(instrument).hasCustomWaveEditor) {
				this._customWaveDrawCanvas.redrawCanvas();
				const chipPrompt = this.prompt;
				if (chipPrompt instanceof CustomChipPrompt) {
					chipPrompt.customChipCanvas.render();
				}
			}

			this._renderInstrumentBar(channel, instrumentIndex, colors);
		} // Options for mod channel
		else {
			renderModSettings(
				this.doc,
				colors,
				prefs,
				this._modSettingsRefs,
				this._modSettingsCallbacks,
			);
		}

		this._onDocPromptChange();

		renderPostBranchSync(
			this._postSyncRefs,
			this.doc,
			instrument,
			colors,
			this._ctrlHeld,
			this._shiftHeld,
			prefs,
			wasActive,
			activeElement,
			() => {
				this.refocusStage();
			},
			() => {
				this.handleModRecording();
			},
		);
		this._promptManager.repositionOutOfBounds();
		this._renderedChannel = this.doc.channel;
		this._renderedInstrument = instrumentIndex;
	};

	public handleModRecording(): void {
		window.clearTimeout(this._modRecTimeout);
		const lastChange: Change | null = this.doc.checkLastChange();
		if ((this._ctrlHeld || this._shiftHeld) && lastChange != null && this.doc.synth.playing) {
			const changedPatterns = this._patternEditor.setModSettingsForChange(lastChange, this);
			if (this.doc.continuingModRecordingChange != null) {
				this._modRecTimeout = window.setTimeout(() => {
					this.handleModRecording();
				}, 10);
				this.doc.recordingModulators = true;

				if (changedPatterns) {
					this._trackEditor.render();
				}
			}
		} else if (this.doc.recordingModulators) {
			this.doc.recordingModulators = false;
			// A dummy change that pushes history state.
			this.doc.record(new ChangeHoldingModRecording(this.doc, null, null, null));
		}
	}

	private _renderInstrumentBar(channel: Channel, instrumentIndex: number, colors: ChannelColors) {
		if (this.doc.song.layeredInstruments || this.doc.song.patternInstruments) {
			this._instrumentsButtonRow.style.display = "";
			this._instrumentsButtonBar.style.setProperty("--text-color-lit", colors.primaryNote);
			this._instrumentsButtonBar.style.setProperty("--text-color-dim", colors.secondaryNote);
			this._instrumentsButtonBar.style.setProperty(
				"--background-color-lit",
				colors.primaryChannel,
			);
			this._instrumentsButtonBar.style.setProperty(
				"--background-color-dim",
				colors.secondaryChannel,
			);

			const maxInstrumentsPerChannel = this.doc.song.getMaxInstrumentsPerChannel();
			while (this._instrumentButtons.length < channel.instruments.length) {
				const instrumentButton: HTMLButtonElement = button(
					String(this._instrumentButtons.length + 1),
				);
				this._instrumentButtons.push(instrumentButton);
				this._instrumentsButtonBar.insertBefore(
					instrumentButton,
					this._instrumentRemoveButton,
				);
			}
			for (
				let i: number = this._renderedInstrumentCount;
				i < channel.instruments.length;
				i++
			) {
				this._instrumentButtons[i].style.display = "";
			}
			for (
				let i: number = channel.instruments.length;
				i < this._renderedInstrumentCount;
				i++
			) {
				this._instrumentButtons[i].style.display = "none";
			}
			this._renderedInstrumentCount = channel.instruments.length;
			while (this._instrumentButtons.length > maxInstrumentsPerChannel) {
				this._instrumentsButtonBar.removeChild(this._instrumentButtons.pop()!);
			}

			this._instrumentRemoveButton.style.display =
				channel.instruments.length > Config.instrumentCountMin ? "" : "none";
			this._instrumentAddButton.style.display =
				channel.instruments.length < maxInstrumentsPerChannel ? "" : "none";
			if (channel.instruments.length < maxInstrumentsPerChannel) {
				this._instrumentRemoveButton.classList.remove("last-button");
			} else {
				this._instrumentRemoveButton.classList.add("last-button");
			}
			if (channel.instruments.length > 1) {
				if (this._highlightedInstrumentIndex !== instrumentIndex) {
					const oldButton: HTMLButtonElement =
						this._instrumentButtons[this._highlightedInstrumentIndex];
					if (oldButton != null) oldButton.classList.remove("selected-instrument");
					const newButton: HTMLButtonElement = this._instrumentButtons[instrumentIndex];
					newButton.classList.add("selected-instrument");
					this._highlightedInstrumentIndex = instrumentIndex;
				}
			} else {
				const oldButton: HTMLButtonElement =
					this._instrumentButtons[this._highlightedInstrumentIndex];
				if (oldButton != null) oldButton.classList.remove("selected-instrument");
				this._highlightedInstrumentIndex = -1;
			}

			if (
				this.doc.song.layeredInstruments &&
				this.doc.song.patternInstruments &&
				this.doc.channel < this.doc.song.pitchChannelCount + this.doc.song.noiseChannelCount
			) {
				for (let i: number = 0; i < channel.instruments.length; i++) {
					if (this.doc.recentPatternInstruments[this.doc.channel].indexOf(i) !== -1) {
						this._instrumentButtons[i].classList.remove("deactivated");
					} else {
						this._instrumentButtons[i].classList.add("deactivated");
					}
				}
				this._deactivatedInstruments = true;
			} else if (
				this._deactivatedInstruments ||
				this.doc.channel >=
					this.doc.song.pitchChannelCount + this.doc.song.noiseChannelCount
			) {
				for (let i: number = 0; i < channel.instruments.length; i++) {
					this._instrumentButtons[i].classList.remove("deactivated");
				}
				this._deactivatedInstruments = false;
			}

			if (
				this.doc.song.layeredInstruments &&
				this.doc.song.patternInstruments &&
				channel.instruments.length > 1 &&
				this.doc.channel < this.doc.song.pitchChannelCount + this.doc.song.noiseChannelCount
			) {
				for (let i: number = 0; i < channel.instruments.length; i++) {
					this._instrumentButtons[i].classList.remove("no-underline");
				}
			} else {
				for (let i: number = 0; i < channel.instruments.length; i++) {
					this._instrumentButtons[i].classList.add("no-underline");
				}
			}
		} else {
			this._instrumentsButtonRow.style.display = "none";
		}
	}

	public updatePlayButton = (): void => {
		if (
			this._renderedIsPlaying !== this.doc.synth.playing ||
			this._renderedIsRecording !== this.doc.synth.recording ||
			this._renderedShowRecordButton !== this.doc.prefs.showRecordButton ||
			this._renderedCtrlHeld !== this._ctrlHeld
		) {
			this._renderedIsPlaying = this.doc.synth.playing;
			this._renderedIsRecording = this.doc.synth.recording;
			this._renderedShowRecordButton = this.doc.prefs.showRecordButton;
			this._renderedCtrlHeld = this._ctrlHeld;

			if (
				document.activeElement === this._playButton ||
				document.activeElement === this._pauseButton ||
				document.activeElement === this._recordButton ||
				document.activeElement === this._stopButton
			) {
				// When a focused element is hidden, focus is transferred to the document, so let's refocus the editor instead to make sure we can still capture keyboard input.
				this.refocusStage();
			}

			this._playButton.style.display = "none";
			this._pauseButton.style.display = "none";
			this._recordButton.style.display = "none";
			this._stopButton.style.display = "none";
			this._prevBarButton.style.display = "";
			this._nextBarButton.style.display = "";
			this._playButton.classList.remove("shrunk");
			this._pauseButton.classList.remove("shrunk");
			this._recordButton.classList.remove("shrunk");
			this._stopButton.classList.remove("shrunk");
			this._patternEditorRow.style.pointerEvents = "";
			this._octaveScrollBar.container.style.pointerEvents = "";
			this._octaveScrollBar.container.style.opacity = "";
			this._trackContainer.style.pointerEvents = "";
			this._loopEditor.container.style.opacity = "";
			this._instrumentSettingsArea.style.pointerEvents = "";
			this._instrumentSettingsArea.style.opacity = "";
			this._menuArea.style.pointerEvents = "";
			this._menuArea.style.opacity = "";
			this._songSettingsArea.style.pointerEvents = "";
			this._songSettingsArea.style.opacity = "";

			if (this.doc.synth.recording) {
				this._stopButton.style.display = "";
				this._prevBarButton.style.display = "none";
				this._nextBarButton.style.display = "none";
				this._patternEditorRow.style.pointerEvents = "none";
				this._octaveScrollBar.container.style.pointerEvents = "none";
				this._octaveScrollBar.container.style.opacity = "0.5";
				this._trackContainer.style.pointerEvents = "none";
				this._loopEditor.container.style.opacity = "0.5";
				this._instrumentSettingsArea.style.pointerEvents = "none";
				this._instrumentSettingsArea.style.opacity = "0.5";
				this._menuArea.style.pointerEvents = "none";
				this._menuArea.style.opacity = "0.5";
				this._songSettingsArea.style.pointerEvents = "none";
				this._songSettingsArea.style.opacity = "0.5";
			} else if (this.doc.synth.playing) {
				this._pauseButton.style.display = "";
				this._stopButton.style.display = "";
				this._pauseButton.classList.add("shrunk");
				this._stopButton.classList.add("shrunk");
			} else if (this.doc.prefs.showRecordButton) {
				this._playButton.style.display = "";
				this._recordButton.style.display = "";
				this._playButton.classList.add("shrunk");
				this._recordButton.classList.add("shrunk");
			} else if (this._ctrlHeld) {
				this._recordButton.style.display = "";
			} else {
				this._playButton.style.display = "";
			}
		}
	};

	private _onTrackAreaScroll(_event: Event): void {
		this.doc.barScrollPos = this._trackAndMuteContainer.scrollLeft / this.doc.getBarWidth();
		this.doc.channelScrollPos =
			this._trackAndMuteContainer.scrollTop / ChannelRow.patternHeight;
	}

	private _disableCtrlContextMenu(event: MouseEvent): boolean {
		// On a Mac, clicking while holding control opens the right-click context menu.
		// But in the pattern and track editors it's better to prevent that and instead allow
		// custom behaviors such as setting the volume of a note.
		if (event.ctrlKey) {
			event.preventDefault();
			return false;
		}
		return true;
	}

	private _usageCheck(channelIndex: number, instrumentIndex: number): void {
		let instrumentUsed = false;
		let patternUsed = false;
		let modUsed = false;
		const channel: Channel = this.doc.song.channels[channelIndex];

		if (channelIndex < this.doc.song.pitchChannelCount + this.doc.song.noiseChannelCount) {
			for (
				let modChannelIdx: number =
					this.doc.song.pitchChannelCount + this.doc.song.noiseChannelCount;
				modChannelIdx < this.doc.song.channels.length;
				modChannelIdx++
			) {
				const modChannel: Channel = this.doc.song.channels[modChannelIdx];
				const patternIdx = modChannel.bars[this.doc.bar];
				if (patternIdx > 0) {
					const modPattern: Pattern | undefined = modChannel.patterns[patternIdx - 1];
					if (modPattern == null) continue;
					const modInstrumentIdx: number = modPattern.instruments[0];
					const modInstrument: Instrument = modChannel.instruments[modInstrumentIdx];
					for (let mod: number = 0; mod < Config.modCount; mod++) {
						if (
							modInstrument.modChannels[mod] === channelIndex &&
							(modInstrument.modInstruments[mod] === instrumentIndex ||
								modInstrument.modInstruments[mod] >= channel.instruments.length)
						) {
							modUsed = true;
						}
					}
				}
			}
		}

		const lowestSelX: number = Math.min(
			this.doc.selection.boxSelectionX0,
			this.doc.selection.boxSelectionX1,
		);
		const highestSelX: number = Math.max(
			this.doc.selection.boxSelectionX0,
			this.doc.selection.boxSelectionX1,
		);
		const lowestSelY: number = Math.min(
			this.doc.selection.boxSelectionY0,
			this.doc.selection.boxSelectionY1,
		);
		const highestSelY: number = Math.max(
			this.doc.selection.boxSelectionY0,
			this.doc.selection.boxSelectionY1,
		);

		if (channel.bars[this.doc.bar] !== 0) {
			for (let i: number = 0; i < this.doc.song.barCount; i++) {
				// Check for this exact bar in another place, but only count it if it's not within the selection
				if (
					channel.bars[i] === channel.bars[this.doc.bar] &&
					i !== this.doc.bar &&
					(i < lowestSelX ||
						i > highestSelX ||
						this.doc.channel < lowestSelY ||
						this.doc.channel > highestSelY)
				) {
					patternUsed = true;
					i = this.doc.song.barCount;
				}
			}
		}

		for (let i: number = 0; i < this.doc.song.barCount; i++) {
			// Check for this exact instrument in another place, but only count it if it's not within the selection
			const patternIndex: number = channel.bars[i] - 1;
			const pattern: Pattern | undefined = channel.patterns[patternIndex];
			if (
				channel.bars[i] !== 0 &&
				channel.bars[i] !== channel.bars[this.doc.bar] &&
				pattern?.instruments.includes(instrumentIndex) &&
				i !== this.doc.bar &&
				(i < lowestSelX ||
					i > highestSelX ||
					this.doc.channel < lowestSelY ||
					this.doc.channel > highestSelY)
			) {
				instrumentUsed = true;
				i = this.doc.song.barCount;
			}
		}

		if (patternUsed) {
			this._usedPatternIndicator.style.setProperty("fill", ColorConfig.indicatorPrimary);
			this.patternUsed = true;
		} else {
			this._usedPatternIndicator.style.setProperty("fill", ColorConfig.indicatorSecondary);
			this.patternUsed = false;
		}
		if (instrumentUsed) {
			this._usedInstrumentIndicator.style.setProperty("fill", ColorConfig.indicatorPrimary);
		} else {
			this._usedInstrumentIndicator.style.setProperty("fill", ColorConfig.indicatorSecondary);
		}
		if (modUsed) {
			this._jumpToModIndicator.style.setProperty("display", "");
			this._jumpToModIndicator.style.setProperty("fill", ColorConfig.indicatorPrimary);
			this._jumpToModIndicator.classList.add("modTarget");
		} else if (
			channelIndex <
			this.doc.song.pitchChannelCount + this.doc.song.noiseChannelCount
		) {
			this._jumpToModIndicator.style.setProperty("display", "");
			this._jumpToModIndicator.style.setProperty("fill", ColorConfig.indicatorSecondary);
			this._jumpToModIndicator.classList.remove("modTarget");
		} else {
			this._jumpToModIndicator.style.setProperty("display", "none");
		}
	}

	private _tempoStepperCaptureNumberKeys = (event: KeyboardEvent): void => {
		// When the number input is in focus, allow some keyboard events to
		// edit the input without accidentally editing the song otherwise.
		switch (event.keyCode) {
			case 8: // backspace/delete
			case 38: // up
			case 40: // down
			case 37: // left
			case 39: // right
			case 48: // 0
			case 49: // 1
			case 50: // 2
			case 51: // 3
			case 52: // 4
			case 53: // 5
			case 54: // 6
			case 55: // 7
			case 56: // 8
			case 57: // 9
				event.stopPropagation();
				break;
		}
	};

	private _copyTextToClipboard(text: string): void {
		// Set as any to allow compilation without clipboard types (the proper types library is not included) -jummbus
		let nav: any;
		nav = navigator;

		if (nav.clipboard?.writeText) {
			nav.clipboard.writeText(text).catch(() => {
				window.prompt("Copy to clipboard:", text);
			});
			return;
		}
		const textField: HTMLTextAreaElement = document.createElement("textarea");
		textField.textContent = text;
		document.body.appendChild(textField);
		textField.select();
		const succeeded: boolean = document.execCommand("copy");
		textField.remove();
		this.refocusStage();
		if (!succeeded) window.prompt("Copy this:", text);
	}

	private _whenPrevBarPressed(): void {
		this.doc.synth.goToPrevBar();
		if (
			Math.floor(this.doc.synth.playhead) < this.doc.synth.loopBarStart ||
			Math.floor(this.doc.synth.playhead) > this.doc.synth.loopBarEnd
		) {
			this.doc.synth.loopBarStart = -1;
			this.doc.synth.loopBarEnd = -1;
			this._loopEditor.setLoopAt(this.doc.synth.loopBarStart, this.doc.synth.loopBarEnd);
		}
		this._barScrollBar.animatePlayhead();
		this._animator.forceBarLabelUpdate();
	}

	private _whenNextBarPressed(): void {
		this.doc.synth.goToNextBar();
		if (
			Math.floor(this.doc.synth.playhead) < this.doc.synth.loopBarStart ||
			Math.floor(this.doc.synth.playhead) > this.doc.synth.loopBarEnd
		) {
			this.doc.synth.loopBarStart = -1;
			this.doc.synth.loopBarEnd = -1;
			this._loopEditor.setLoopAt(this.doc.synth.loopBarStart, this.doc.synth.loopBarEnd);
		}
		this._barScrollBar.animatePlayhead();
		this._animator.forceBarLabelUpdate();
	}

	public togglePlay(): void {
		if (this.doc.synth.playing) {
			this.doc.performance.pause();
			this._animator.outVolumeHistoricCap = 0;
		} else {
			this.doc.synth.snapToBar();
			this.doc.performance.play();
		}
	}

	public stopPlayback(): void {
		this.doc.performance.pause();
		this._animator.outVolumeHistoricCap = 0;
		this.doc.synth.goToBar(0);
		this.doc.bar = 0;
		this.doc.barScrollPos = 0;
		this.doc.selection.resetBoxSelection();
		this.doc.notifier.changed();
		this.doc.notifier.notifyWatchers();
	}

	public handleImportFile(file: File, rafWin?: Window): void {
		this._promptManager.handleImportFile(file, rafWin);
	}

	public get _animate(): () => void {
		return this._animator.animate;
	}

	private _setVolumeSlider(): void {
		// Song volume slider doesn't use a change, but it can still be modulated.
		if ((this._ctrlHeld || this._shiftHeld) && this.doc.synth.playing) {
			const prevVol = this.doc.prefs.volume;
			// Slider range 0-75 mapped to mod range 0-100.
			this.doc.prefs.volume = Math.round((Number(this._volumeSlider.input.value) * 4) / 3);
			const changedPatterns = this._patternEditor.setModSettingsForChange(null, this);
			const useVol: number = this.doc.prefs.volume;
			window.clearTimeout(this._modRecTimeout);
			this._modRecTimeout = window.setTimeout(() => {
				this._recordVolumeSlider(useVol);
			}, 10);
			this.doc.recordingModulators = true;

			this.doc.prefs.volume = prevVol;
			this._volumeSlider.updateValue(this.doc.prefs.volume);
			this._playbackControls.volumeInputBox.value = String(this.doc.prefs.volume);

			if (changedPatterns) {
				this._trackEditor.render();
			}
		} else {
			this.doc.setVolume(Number(this._volumeSlider.input.value));
			this._playbackControls.volumeInputBox.value = this._volumeSlider.input.value;
			if (this.doc.recordingModulators) {
				this.doc.recordingModulators = false;
				// A dummy change that pushes history state.
				this.doc.record(new ChangeHoldingModRecording(this.doc, null, null, null));
			}
		}
	}

	private _recordVolumeSlider(useVol: number): void {
		// Song volume slider doesn't use a change, but it can still be modulated.
		if ((this._ctrlHeld || this._shiftHeld) && this.doc.synth.playing) {
			const prevVol = this.doc.prefs.volume;
			// Slider range 0-75 mapped to mod range 0-100.
			this.doc.prefs.volume = useVol;
			this._patternEditor.setModSettingsForChange(null, this);
			window.clearTimeout(this._modRecTimeout);
			this._modRecTimeout = window.setTimeout(() => {
				this._recordVolumeSlider(useVol);
			}, 10);
			this.doc.recordingModulators = true;

			this.doc.prefs.volume = prevVol;
			this._volumeSlider.updateValue(this.doc.prefs.volume);
			this._playbackControls.volumeInputBox.value = String(this.doc.prefs.volume);
		} else {
			this.doc.setVolume(Number(this._volumeSlider.input.value));
			this._playbackControls.volumeInputBox.value = this._volumeSlider.input.value;
			if (this.doc.recordingModulators) {
				this.doc.recordingModulators = false;
				// A dummy change that pushes history state.
				this.doc.record(new ChangeHoldingModRecording(this.doc, null, null, null));
			}
		}
	}

	private _switchEQFilterType(toSimple: boolean): void {
		this._dispatch.switchEQFilterType(toSimple);
	}
	private _switchNoteFilterType(toSimple: boolean): void {
		this._dispatch.switchNoteFilterType(toSimple);
	}

	private _zoomIn(): void {
		this.doc.prefs.visibleOctaves = Math.max(1, this.doc.prefs.visibleOctaves - 1);
		this.doc.prefs.save();
		this.doc.notifier.changed();
		this.refocusStage();
	}

	private _zoomOut(): void {
		this.doc.prefs.visibleOctaves = Math.min(
			this.doc.song.octaveCount,
			this.doc.prefs.visibleOctaves + 1,
		);
		this.doc.prefs.save();
		this.doc.notifier.changed();
		this.refocusStage();
	}

	private _customWavePresetHandler(_event: Event): void {
		// Update custom wave value
		const customWaveArray: Float32Array = new Float32Array(64);
		const index: number = this._customWavePresetDrop.selectedIndex - 1;
		let maxValue: number = Number.MIN_VALUE;
		let minValue: number = Number.MAX_VALUE;
		let arrayPoint: number = 0;
		const arrayStep: number = (Config.chipWaves[index].samples.length - 1) / 64.0;

		for (let i: number = 0; i < 64; i++) {
			// Compute derivative to get original wave.
			customWaveArray[i] =
				(Config.chipWaves[index].samples[Math.floor(arrayPoint)] -
					Config.chipWaves[index].samples[Math.floor(arrayPoint) + 1]) /
				arrayStep;

			if (customWaveArray[i] < minValue) {
				minValue = customWaveArray[i];
			}

			if (customWaveArray[i] > maxValue) {
				maxValue = customWaveArray[i];
			}

			// Scale an any-size array to 64 elements
			arrayPoint += arrayStep;
		}

		for (let i: number = 0; i < 64; i++) {
			// Change array range from Min~Max to 0~(Max-Min)
			customWaveArray[i] -= minValue;
			// Divide by (Max-Min) to get a range of 0~1,
			customWaveArray[i] /= maxValue - minValue;
			// then multiply by 48 to get 0~48,
			customWaveArray[i] *= 48.0;
			// then subtract 24 to get - 24~24
			customWaveArray[i] -= 24.0;
			// need to force integers
			customWaveArray[i] = Math.ceil(customWaveArray[i]);

			// Copy back data to canvas
			this._customWaveDrawCanvas.newArray[i] = customWaveArray[i];
		}

		this.doc.record(new ChangeCustomWave(this.doc, customWaveArray));
		if (+this._instrumentVolumeWidget.slider.input.value !== -Config.volumeRange / 2) {
			this.doc.record(
				new ChangeVolume(
					this.doc,
					+this._instrumentVolumeWidget.slider.input.value,
					Math.min(
						Math.max(
							-Config.volumeRange / 2 +
								Math.round(
									(Math.sqrt(Config.chipWaves[index].expression) *
										Config.volumeRange) /
										2 +
										parseInt(
											this._instrumentVolumeWidget.slider.input.value,
											10,
										),
								),
							-Config.volumeRange / 2,
						) >> 1,
						Config.volumeRange / 2,
					),
				),
			);
		}

		this._customWavePresetDrop.selectedIndex = 0;
		this.doc.notifier.changed();
		this.doc.prefs.save();
	}
}
