import { Sizing, Typography } from "../ui/style-constants";
// ChannelVolumeVisualizerPrompt
//
// Purpose: Modal popup displaying per-channel gain information with live updates
//
// This module:
// - Shows output volume level (same as editor volume bar)
// - Displays per-channel live output volume bars
// - Updates in real-time during playback

import { HTML, SVG } from "imperative-html/dist/esm/elements-strict";
import {
	getTimelineWidth,
	invalidateVizWidthCache,
	renderPlayhead,
	renderTimeline,
} from "../../player/player-timeline";
import { ColorConfig } from "../../shared/color-config";
import { hexToRgb } from "../../shared/color-utils";
import { events } from "../../shared/events";
import { spectrumCanvas } from "../../shared/spectrum";
import type { TimelineSurface } from "../../shared/timeline-surface";
import type { ChannelState } from "../../synth/channel-state";
import { Config } from "../../synth/config/index";
import { getInstrumentTypeName } from "../../synth/config/instrument-registry";
import { forwardRealFourierTransform } from "../../shared/fft";
import { EditorConfig } from "../config/editor-config";
import type { PromptEditorRefs } from "../core/prompt-manager";
import type { SongDocument } from "../song-document";
import { BasePrompt } from "./base-prompt";

const { div, h2, span, button, canvas } = HTML;
const { svg, path } = SVG;

// Spectrum overlay tuning, mirroring shared/spectrum.ts main FG layer so the
// per-channel overlay matches the editor's main spectrum look.
// FG bands: 151 quarter-tone bands from ~130Hz to ~10000Hz.
const FG_BANDS = 151;
// Display bars aggregated from the FG or BG bands. The channel cards are narrow
// (1:1 aspect), so a 151-point wave is unreadable; 16 rounded bars aggregate
// ~9-10 bands each and read clearly at the card width.
const BAR_COUNT = 24;
// BG bands: 67 quarter-tone bands from ~20Hz to ~130Hz (mirrors main spectrum).
const BG_BANDS = 67;
// Fixed soft-compression reference (same as main spectrum FG_REF). The bar
// height is min(1, 2*v/(v+FG_REF)), so a band reaches the ceiling only at
// ~FG_REF in magnitude. The per-channel ring holds the channel's own isolated
// diff at its true sample amplitude (a solo full-scale channel writes +/-1).
const FG_REF = 0.04;
// Display-only gain for the spectrum bars (not the meter). The per-channel
// isolated signal is quieter than the main spectrum's full-mix source, so a
// modest fixed lift makes the bars read visibly without affecting the peak
// meter, which stays accurate to the post-limiter output level. Tuned so a
// typical channel sits mid-bar rather than near the floor.
const SPECTRUM_DISPLAY_GAIN = 3;
// Cap expensive per-channel FFTs per animation frame. Large MIDI imports can
// have dozens of audio channels; doing an 8192-point FFT for every channel in
// one rAF stalls the editor and starves audio production.
const MAX_FFT_CHANNELS_PER_FRAME = 16;
const CHANNEL_RING_MASK = 8191;
// CVV favors responsiveness over analyzer precision. The source ring is 8192
// samples, but using the newest 2048 samples keeps spectrum/alpha/meter attack
// near one video frame instead of smearing over ~170ms.
const FFT_SIZE = 2048;
// Gaussian spatial-blur kernel (sigma=3 bands), truncated to +-BLUR_RADIUS.
// Precomputed once so the per-channel per-frame blur is O(FG_BANDS * kernel)
// instead of O(FG_BANDS^2). At 3 sigma the truncated tail is negligible.
const BLUR_RADIUS = 9;
const BLUR_KERNEL: readonly number[] = ChannelVolumeVisualizerPrompt_initBlurKernel();
function ChannelVolumeVisualizerPrompt_initBlurKernel(): number[] {
	const kernel: number[] = [];
	for (let d = -BLUR_RADIUS; d <= BLUR_RADIUS; d++) {
		kernel.push(Math.exp((-0.5 * d * d) / 9));
	}
	return kernel;
}
// Precomputed BG gaussian blur kernel (sigma=2 bands), truncated at 4 sigma.
// Avoids Math.exp() allocation per band per channel per FFT frame.
const BG_BLUR_RADIUS = 8;
const BG_BLUR_KERNEL: readonly number[] = ChannelVolumeVisualizerPrompt_initBgBlurKernel();

// Module-level draw helper for per-channel spectrum bars. Defined outside
// the class to avoid per-channel closure allocation every FFT frame.
function drawSpectrumBars(
	ctx: CanvasRenderingContext2D,
	col: string,
	h: number,
	barOuter: number,
	barW: number,
	radius: number,
	gap: number,
	bandCount: number,
	mags: Float32Array,
	ref: number,
	alpha: number,
	masterScale: number,
): void {
	const bandsPerBar = bandCount / BAR_COUNT;
	ctx.fillStyle = col;
	ctx.globalAlpha = alpha;
	ctx.beginPath();
	for (let bar = 0; bar < BAR_COUNT; bar++) {
		const s0 = Math.floor(bar * bandsPerBar);
		const s1 = Math.min(bandCount, Math.floor((bar + 1) * bandsPerBar));
		let peak = 0;
		for (let b = s0; b < s1; b++) if (mags[b] > peak) peak = mags[b];
		const v = peak * masterScale * SPECTRUM_DISPLAY_GAIN;
		const norm = Math.min(1, (2 * v) / (v + ref));
		const barH = norm * h;
		if (barH < 0.5) continue;
		const x = bar * barOuter + gap * 0.5;
		const y = h - barH;
		const r = Math.min(radius, barH * 0.5);
		ctx.moveTo(x, h);
		ctx.lineTo(x, y + r);
		ctx.quadraticCurveTo(x, y, x + r, y);
		ctx.lineTo(x + barW - r, y);
		ctx.quadraticCurveTo(x + barW, y, x + barW, y + r);
		ctx.lineTo(x + barW, h);
	}
	ctx.fill();
	ctx.globalAlpha = 1.0;
}

function ChannelVolumeVisualizerPrompt_initBgBlurKernel(): number[] {
	const kernel: number[] = [];
	for (let d = -BG_BLUR_RADIUS; d <= BG_BLUR_RADIUS; d++) {
		kernel.push(Math.exp((-0.5 * d * d) / 4));
	}
	return kernel;
}

function getInstrumentDisplayName(
	instrument: import("../../synth/instruments").Instrument,
): string {
	// Prefer preset name if instrument has one.
	const preset = EditorConfig.valueToPreset(instrument.preset);
	if (preset) return preset.name;
	// For chip instruments using a custom sample, show the sample name.
	const chipWave = Config.chipWaves[instrument.chipWave];
	if (chipWave?.isCustomSampled && chipWave.name) return chipWave.name;
	// Fall back to instrument type name.
	return getInstrumentTypeName(instrument.type);
}

// Format seconds as M:SS, matching player-animator.ts.
function formatTime(seconds: number): string {
	const mins = Math.floor(seconds / 60);
	const secs = Math.floor(seconds % 60);
	return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export class ChannelVolumeVisualizerPrompt extends BasePrompt {
	private _animationId: number = 0;
	private _animationGeneration: number = 0;
	// Window the current rAF id is scheduled on. Tracked so cancel targets the
	// correct window (main and popout have separate rAF id spaces) and so the
	// animate loop reschedules on whichever window currently hosts the container.
	// When popped out the container lives in the popout window, whose rAF keeps
	// firing while the main editor window is throttled out of view — this is what
	// lets the popout stay live without the editor rendering. The audio data it
	// reads (outVolumeCap, per-channel audioRing, playhead) is written by the
	// AudioWorklet on the audio thread, independent of either window's visibility.
	private _rafWin: Window = window;
	private _paneActive = true;
	private _disposed = false;
	private readonly _ownedTimers = new Set<ReturnType<typeof setTimeout>>();
	private _dragWindow: Window | null = null;
	private _dragMoveListener: ((event: PointerEvent) => void) | null = null;
	private _dragUpListener: (() => void) | null = null;

	private readonly _contentContainer: HTMLDivElement = div({
		class: "cvvContentGrid",
	});
	private readonly _channelsPane: HTMLDivElement = div(
		{
			class: "cvvChannelsPane",
			style: "flex: 1; display: flex; flex-direction: column; min-height: 0; padding: 0; position: relative; z-index: 1; overflow-y: auto; overscroll-behavior: contain;",
		},
		this._contentContainer,
	);

	// Store channel volume bar elements for live updates
	private readonly _channelVolumeBars: Map<number, HTMLDivElement> = new Map();
	private readonly _channelVolumeCaps: Map<number, HTMLDivElement> = new Map();
	private readonly _channelHistoricCaps: Map<number, { cap: number; timer: number }> = new Map();
	private readonly _channelLastWidths: Map<number, number> = new Map();
	private readonly _channelLastCaps: Map<number, number> = new Map();
	private readonly _channelDbLabels: Map<number, HTMLSpanElement> = new Map();
	private readonly _channelDivs: Map<number, HTMLDivElement> = new Map();
	// Store instrument spans for live updates: key is "channelIndex-instrumentIndex"
	private readonly _instrumentSpans: Map<string, HTMLSpanElement> = new Map();
	private readonly _instrumentEntriesByChannel: Map<
		number,
		{ key: string; index: number; span: HTMLSpanElement }[]
	> = new Map();
	// Per-channel pitch spectrum overlay canvases
	private readonly _channelSpectrumCanvases: Map<number, HTMLCanvasElement> = new Map();
	private readonly _channelSpectrumCanvas2ds: Map<number, CanvasRenderingContext2D | null> =
		new Map();
	private readonly _spectrumSmooth: Map<number, Float32Array> = new Map();
	private readonly _bgSpectrumSmooth: Map<number, Float32Array> = new Map();
	// Reusable FFT scratch buffers (avoid per-frame allocation across channels).
	private _fftScratch: Float32Array = new Float32Array(FFT_SIZE);
	private _magScratch: Float32Array = new Float32Array(FFT_SIZE / 2 + 1);
	// Reusable per-band work arrays (channels are processed sequentially per frame,
	// so a single set shared across channels avoids per-frame allocation).
	private readonly _bandMags: Float32Array = new Float32Array(FG_BANDS);
	private readonly _blurred: Float32Array = new Float32Array(FG_BANDS);
	private readonly _bgBandMags: Float32Array = new Float32Array(BG_BANDS);
	private readonly _bgBlurred: Float32Array = new Float32Array(BG_BANDS);
	// Cached per-channel overlay fill color. getComputedChannelColor calls
	// getComputedStyle 4x per call, which forces a style recalc; computing it
	// once per channel on render (and on theme change) removes that per-frame reflow.
	private readonly _channelSpectrumColors: Map<number, string> = new Map();
	// Cached per-channel canvas backing-store size in device pixels, refreshed by a
	// ResizeObserver so the animate loop never reads clientWidth/clientHeight
	// (which would force layout reflows interleaved with style writes).
	private readonly _canvasSizes: Map<number, { w: number; h: number }> = new Map();
	private _resizeObserver: ResizeObserver | null = null;
	// Per-channel post-limiter peak (0..1), populated each frame from the
	// isolated ring. Read by the metering code (one frame of latency) so metering
	// needs no second FFT.
	private readonly _channelPeak: Map<number, number> = new Map();
	// Smoothed post-limiter master gain (masterGain^2 * volume * limiter) that the
	// per-channel ring omits. Smoothed per frame so the limiter's fast dynamics and
	// startup transient don't make the meters/spectrum jump; the underlying ring
	// already integrates over ~170ms so a slow gain factor is appropriate.
	private _smoothedMasterScale: number = 1;
	// FG band center frequencies (absolute Hz, independent of sample rate).
	private readonly _fgFreqs: number[] = ChannelVolumeVisualizerPrompt._initFgFreqs();
	private readonly _bgFreqs: number[] = ChannelVolumeVisualizerPrompt._initBgFreqs();
	private readonly _spectrumFrameChannels: Set<number> = new Set();
	private readonly _renderedAudioChannelIndexes: number[] = [];
	private _spectrumChannelCursor: number = 0;

	private static _initFgFreqs(): number[] {
		const freqs: number[] = [];
		const noteStart = Math.round(12 * Math.log2(130 / 440) + 69);
		for (let b = 0; b < FG_BANDS; b++) {
			freqs.push(440 * 2 ** ((noteStart + b * 0.5 - 69) / 12));
		}
		return freqs;
	}
	private static _initBgFreqs(): number[] {
		const freqs: number[] = [];
		const noteStart = Math.round(12 * Math.log2(20 / 440) + 69);
		for (let b = 0; b < BG_BANDS; b++) {
			freqs.push(440 * 2 ** ((noteStart + b * 0.5 - 69) / 12));
		}
		return freqs;
	}

	private readonly _playPauseButton: HTMLButtonElement = button(
		{
			style: `font-size: ${Typography.sizeSm}; width: ${Sizing.button}; height: ${Sizing.button}; padding: 0; border-radius: var(--border-radius-full); display: flex; align-items: center; justify-content: center; line-height: 1;`,
			type: "button",
			title: "Play or pause",
		},
		"▶",
	);
	private readonly _stopButton: HTMLButtonElement = button(
		{
			style: `font-size: ${Typography.sizeSm}; width: ${Sizing.button}; height: ${Sizing.button}; padding: 0; border-radius: var(--border-radius-full); display: flex; align-items: center; justify-content: center; line-height: 1;`,
			type: "button",
			title: "Stop",
		},
		"■",
	);
	// Loop toggle icon (mirrors the standalone player's loopButton).
	private readonly _loopIcon: SVGPathElement = path({
		d: "M4 12v-3a3 3 0 0 1 3 -3h13m-3 -3l3 3l-3 3 M20 12v3a3 3 0 0 1 -3 3h-13m3 3l-3 -3l3 -3",
		stroke: "currentColor",
		"stroke-width": "4",
		"stroke-linecap": "round",
		"stroke-linejoin": "round",
		fill: "none",
	});
	private readonly _loopButton: HTMLButtonElement = button(
		{
			style: `width: 26px; height: 26px; padding: 0; border-radius: var(--border-radius-full); display: flex; align-items: center; justify-content: center; cursor: pointer; outline: none; line-height: 1; font-size: 12px; background: var(--tab-inactive-bg); color: var(--tab-inactive-fg);`,
			class: "cvv-loop-btn",
			title: "Toggle loop",
			type: "button",
			"aria-label": "Toggle loop",
		},
		svg({ width: 12, height: 12, viewBox: "0 0 24 24" }, this._loopIcon),
	);
	// Progress / scrub bar: a pill-shaped track div with a child
	// fill div whose width (as %) tracks the playhead.
	private readonly _scrubFill: HTMLDivElement = div({
		style: "width: 0; height: 100%; background: var(--cta-bg); border-radius: var(--border-radius-rem-sm);",
	});
	private readonly _scrubTrack: HTMLDivElement = div(
		{
			style: "width: 100%; height: 12px; display: block; margin: 0; cursor: pointer; touch-action: none; position: relative; background: var(--secondary-text); border-radius: var(--border-radius-rem-sm); overflow: hidden;",
		},
		this._scrubFill,
	);
	private _scrubDragging: boolean = false;
	// Pending setTimeout handle for a shift+click scheduled play. Cleared
	// whenever an explicit play/pause/stop action supersedes the schedule
	// (or when the prompt is torn down) so the timer cannot fire a stale
	// play after the user has moved on.
	private _scheduledPlayTimer: ReturnType<typeof setTimeout> | null = null;
	private readonly _tempoLabel: HTMLSpanElement = span(
		{
			style: `color: var(--secondary-text); font-size: ${Typography.sizeSm}; font-family: monospace; white-space: nowrap;`,
		},
		"",
	);

	private _historicVolumeCap: number = 0;
	private _historicTimer: number = 0;

	// Bar position label throttle (mirroring player-animator.ts BAR_LABEL_THROTTLE)
	private _barLabelCounter: number = 0;
	// Per-channel FFT (8192-point) is the dominant per-frame cost — N
	// channels × O(n log n) vs the editor's single spectrum FFT.
	// Throttle the FFT + spectrum draw to every 2nd frame (30fps);
	// metering (peak scan, volume bars, dB labels) stays at full rate.
	private _spectrumFrameToggle: boolean = false;
	// Separate phase for the player-overlay playhead follow so it
	// interleaves with the spectrum/peak work rather than piling on
	// the same frame.
	private _playerFrameToggle: boolean = false;
	// Perf logging: accumulate per-phase ms across frames and log a
	// summary to the console every ~1s. Shareable from devtools.

	private _cachedDuration: number = -1;
	private _cachedBarCount: number = -1;
	private _cachedGeneration: number = -1;

	// Structural signature: tracks (channelCount, perChannelInstrumentCounts)
	// to skip full DOM rebuild in _renderChannelList when nothing structurally
	// changed. During playback, notifyWatchers fires on window mousemove every
	// frame, which would tear down and recreate the entire channel card grid
	// on every bar — causing the full-grid flash flicker.
	private _renderSignature: string = "";

	// Running averages for dB
	private _masterVolumeSum: number = 0;
	private _masterSampleCount: number = 0;
	private readonly _channelVolumeSums: Map<number, number> = new Map();
	private readonly _channelSampleCounts: Map<number, number> = new Map();
	private _masterMinDb: number = Infinity;
	private _masterMaxDb: number = -Infinity;
	private readonly _channelMinDb: Map<number, number> = new Map();
	private readonly _channelMaxDb: Map<number, number> = new Map();
	private readonly _masterDbPeakLabel: HTMLSpanElement = span(
		{
			style: `color: var(--primary-text); font-size: ${Typography.sizeSm}; font-family: monospace; white-space: nowrap;`,
		},
		"Peak: -inf dB",
	);
	private readonly _masterDbAvgLabel: HTMLSpanElement = span(
		{
			style: `color: var(--secondary-text); font-size: ${Typography.sizeSm}; font-family: monospace; white-space: nowrap;`,
		},
		"Avg: -inf dB",
	);
	private readonly _masterDbMinMaxLabel: HTMLSpanElement = span(
		{
			style: `color: var(--secondary-text); font-size: ${Typography.sizeSm}; font-family: monospace; white-space: nowrap;`,
		},
		"-inf/-inf dB",
	);

	private readonly _barPosLabel: HTMLSpanElement = span(
		{
			style: `color: var(--secondary-text); font-size: ${Typography.sizeSm}; font-family: monospace; white-space: nowrap;`,
		},
		"0:00 / 0:00  -  0/0",
	);

	// Piano key octave display — two rows of octave-spanning keys that
	// light up to the channel's 80x PMD color when pitches are active.
	private readonly _octaveRow0Svg: SVGSVGElement = svg({
		style: "width: 100%; height: 20px; display: block; margin: 0; overflow: visible; shape-rendering: crispEdges;",
		viewBox: "0 0 28 1",
		preserveAspectRatio: "none",
	});
	private readonly _octaveRow1Svg: SVGSVGElement = svg({
		style: "width: 100%; height: 20px; display: block; margin: 0; overflow: visible; shape-rendering: crispEdges;",
		viewBox: "0 0 28 1",
		preserveAspectRatio: "none",
	});
	private readonly _whiteKeyRects: Map<number, SVGPathElement> = new Map();
	private readonly _blackKeyRects: Map<number, SVGPathElement> = new Map();
	// Cache last rendered fill|opacity per key so idle keys skip the
	// setAttribute writes (96 keys × 2 attrs = 192 DOM writes/frame
	// without this; most keys are idle most frames).
	private readonly _keyLastRender: Map<number, string> = new Map();
	// Reusable pitch blend accumulator for piano keys, cleared per frame
	// instead of allocating a new Map every rAF (eliminates GC pressure).
	private readonly _pitchBlend: Map<
		number,
		{ r: number; g: number; b: number; w: number; maxPeak: number }
	> = new Map();
	// Object pool for pitch blend entries. Recycles {r,g,b,w,maxPeak}
	// objects across frames so Map misses hit the pool instead of
	// allocating fresh objects (eliminates nursery GC pressure). The
	// pool grows to peak active-pitch count and never shrinks.
	private readonly _pitchBlendPool: {
		r: number;
		g: number;
		b: number;
		w: number;
		maxPeak: number;
	}[] = [];
	// Per-channel pre-parsed RGB values cached from hex, avoiding
	// hex.slice() + parseInt() allocations every frame per active instrument.
	private readonly _cachedChannelRGB: Map<number, { r: number; g: number; b: number }> =
		new Map();
	// Last rendered style signature per instrument key, so style writes
	// only fire when the value actually changes (avoid forced style recalc).
	private readonly _cachedInstrStyle: Map<string, string> = new Map();
	// Decay hold timer per instrument key: when activeTones drops to 0,
	// continue showing the active highlight for N more frames so the brief
	// gap at bar boundaries doesn't flicker to inactive then back.
	private readonly _instrActiveDecay: Map<string, number> = new Map();
	// Last opacity value written per channel div, so style writes fire
	// only on actual dim-state changes.
	private readonly _lastChannelOpacity: Map<number, string> = new Map();
	// Pre-parsed instrument index per key, avoiding key.split("-")[1]
	// which allocates a new array every frame per instrument.
	private readonly _instrumentIndex: Map<string, number> = new Map();
	// Pre-computed inactive style signatures per channel, avoiding
	// template-literal string allocation every frame per instrument.
	private readonly _inactiveSig: Map<number, string> = new Map();

	// Song-player timeline rendered as a faint background behind the
	// channel cards when popped out. Reuses the player's renderTimeline /
	// renderPlayhead so note shapes, colors, and auto-scroll match the
	// standalone player. renderTimeline is called only on song change or
	// resize (procedural); renderPlayhead runs per frame to follow the
	// playhead, keeping rAF cost low.
	private readonly _playerTimelineSvg: SVGSVGElement = svg({
		style: "min-width: 0; min-height: 0; touch-action: pan-y pinch-zoom;",
	});
	private readonly _playerPlayhead: HTMLDivElement = div({
		style: `position: absolute; left: 0; top: 0; width: 2px; height: 100%; background: ${ColorConfig.playhead}; pointer-events: none;`,
	});
	private readonly _playerTimelineContainer: HTMLDivElement = div(
		{ style: "display: flex; flex-grow: 1; flex-shrink: 1; position: relative;" },
		this._playerTimelineSvg,
		this._playerPlayhead,
	);
	private readonly _playerVizContainer: HTMLDivElement = div(
		{
			style: "display: flex; flex-grow: 1; flex-shrink: 1; height: 100%; position: relative; align-items: center; overflow: hidden;",
		},
		this._playerTimelineContainer,
	);
	private readonly _playerOverlay: HTMLDivElement = div(
		{
			style: "position: absolute; inset: 0; z-index: 2; opacity: 0.16; pointer-events: none; display: none;",
		},
		this._playerVizContainer,
	);
	private readonly _channelsWrapper: HTMLDivElement = div(
		{
			class: "cvvChannelsWrapper",
			style: "position: relative; flex: 1 1 auto; display: flex; min-height: 0; overflow: hidden;",
		},
		this._playerOverlay,
		this._channelsPane,
	);
	private _playerTimelineDirty = true;
	private _wasPopout = false;
	private _playerLastW = 0;
	private _playerLastH = 0;
	// Currently rendered bar window [start, end). Re-render only when the
	// visible window drifts past this overscan margin, so off-screen bars
	// are never drawn. Overscan of 4 bars balances re-render frequency
	// against DOM churn during playback.
	private _playerRenderedStart = -1;
	private _playerRenderedEnd = -1;
	// Piano layout: -1 unknown, 0 double row, 1 single row. Rebuild only
	// when the mode changes (throttled width check ~every 0.5s).

	private static readonly PLAYER_OVERSCAN = 8;

	// Global spectrum bar pinned to the absolute bottom of the prompt.
	// Only visible when popped out; when docked the editor's main
	// spectrum is already visible.
	private readonly _cvSpectrum: spectrumCanvas = new spectrumCanvas(
		canvas({
			width: 384,
			height: 96,
			style: "display: none; position: absolute; bottom: 0; left: 0; width: 100%; height: 96px; pointer-events: none; z-index: 1; opacity: 0.12;",
		}),
		1,
		true,
	);

	private _popoutObserver: MutationObserver | null = null;

	public container: HTMLDivElement = div(
		{
			class: "prompt noSelection fill-y cvvPrompt",
			tabindex: "0",
		},
		h2({ style: "margin: 0; text-align: center;" }, "Channel Volume Visualizer"),
		// Top bar — play/pause, volume meter, stats
		div(
			{
				class: "cvvHeader",
				style: "display: flex; align-items: center; justify-content: center; gap: 12px; flex-wrap: nowrap; padding: 0;",
			},
			this._playPauseButton,
			this._stopButton,
			this._loopButton,
			this._barPosLabel,
			this._tempoLabel,
			span(
				{
					class: "cvvHeaderStats",
					style: `display: inline-flex; gap: 10px; flex-wrap: nowrap;`,
				},
				this._masterDbPeakLabel,
				this._masterDbAvgLabel,
				this._masterDbMinMaxLabel,
			),
		),
		// Progress / scrub bar
		this._scrubTrack,
		// Divider
		div({ style: "border-top: 2px solid var(--ui-widget-background); margin: 0;" }),
		// Piano key octave rows
		this._octaveRow0Svg,
		this._octaveRow1Svg,
		// Channels grid
		this._channelsWrapper,
		// Spectrum bar
		this._cvSpectrum.canvas,
		this._cancelButton,
	);

	constructor(
		doc: SongDocument,
		private _songEditor: PromptEditorRefs,
	) {
		super(doc);
		this.buildTitlebar();
		this._onDocChange = this._renderChannelList.bind(this);
		this._doc.notifier.watch(this._onDocChange);
		this._onThemeChange = (): void => {
			this._refreshSpectrumColors();
			this._repaintChannelSpectra();
		};
		events.listen("themeChange", this._onThemeChange);
		this._doc.synth.channelAudioCaptureEnabled = true;
		this._renderChannelList();
		this._buildPianoKeyRows(1);
		this._scheduleFrame();

		// When the popout adopts the container into its own window, the
		// existing rAF callback is still scheduled on the main window. If
		// the main tab is in background its rAF is throttled (~1fps or
		// never), so the popout animation freezes. Watch for data-popout
		// and reschedule on whichever window owns the container now.
		this._popoutObserver = new MutationObserver(() => {
			const attr = this.container.getAttribute("data-popout");
			if ((attr === "true" || attr === null) && this._paneActive && !this._disposed) {
				this._cancelFrame();
				this._scheduleFrame();
			}
		});
		this._popoutObserver.observe(this.container, {
			attributes: true,
			attributeFilter: ["data-popout"],
		});
		this._playPauseButton.addEventListener("click", this._togglePlayPause);
		this._stopButton.addEventListener("click", this._stop);
		this._loopButton.addEventListener("click", this._toggleLoop);
		this._loopButton.addEventListener("mouseenter", this._onLoopMouseEnter);
		this._loopButton.addEventListener("mouseleave", this._updateLoopButton);
		this._scrubTrack.addEventListener("pointerdown", this._onScrubPointerDown);
		this._setOwnedTimeout(() => {
			this.container.focus();
		});

		// Drag-and-drop file import for .json, .mid, .midi files.
		// Attach to the container so it works in both main-window and popped-out
		// documents (popout key events are routed separately via prompt-popout).
		// Stop propagation so the editor's window-level drop handler does not
		// also fire — a double-fire would schedule the import twice, and the
		// second FileReader load would close the focused prompt (CVV itself)
		// after the first one closed the import prompt.
		const _onDragOver = (e: DragEvent) => {
			if (e.dataTransfer && e.dataTransfer.types.indexOf("Files") !== -1) {
				e.preventDefault();
				e.stopPropagation();
			}
		};
		const _onDrop = (e: DragEvent) => {
			if (!e.dataTransfer) return;
			const files: FileList = e.dataTransfer.files;
			if (files.length === 0) return;
			const file: File = files[0];
			const name: string = file.name.toLowerCase();
			if (name.endsWith(".json") || name.endsWith(".mid") || name.endsWith(".midi")) {
				e.preventDefault();
				e.stopPropagation();
				// Pass the window hosting this container so the import's
				// deferred ChangeSong runs on the visible popup rAF, not the
				// backgrounded main editor rAF (which is throttled and would
				// defer the load until the editor regains visibility).
				const rafWin: Window =
					(this.container.ownerDocument.defaultView as Window | null) ?? window;
				this._songEditor.handleImportFile(file, rafWin);
			}
		};
		this.container.addEventListener("dragover", _onDragOver);
		this.container.addEventListener("drop", _onDrop);

		// Click on the prompt body toggles play/pause; shift+click schedules
		// a restart-from-bar-0 play after 3 seconds (count-in). Works in
		// floating, docked, and popped-out states because the listener is
		// attached to this.container, which is the same element regardless
		// of dock/popout mode.
		//
		// "Body" here is the prompt's one unified background fill — the
		// container's filled region, which shows through every transparent
		// child (titlebar, channels pane, top-bar labels, octave SVGs,
		// spectrum canvas, dividers). Interactive widgets that paint their
		// own background and own the click are excluded:
		//   - buttons (play/pause, stop, loop, cancel, popout, shade)
		//   - scrub track
		//   - channel cards (click selects the channel; that handler must
		//     win, otherwise we'd both select the channel AND toggle play)
		let _bodyDownX = 0;
		let _bodyDownY = 0;
		const _onBodyMouseDown = (e: MouseEvent): void => {
			_bodyDownX = e.clientX;
			_bodyDownY = e.clientY;
		};
		const _onBodyClick = (e: MouseEvent): void => {
			// Suppress click-after-drag. The prompt manager also attaches
			// a mousedown to this container for dragging; a real drag still
			// fires click on mouseup, so we discard clicks whose cursor
			// moved more than a few pixels between mousedown and mouseup.
			const dx = e.clientX - _bodyDownX;
			const dy = e.clientY - _bodyDownY;
			if (dx * dx + dy * dy > 25) return;
			const target = e.target as HTMLElement | null;
			if (target == null) return;
			if (target.closest("button")) return;
			if (this._scrubTrack.contains(target)) return;
			for (const card of this._channelDivs.values()) {
				if (card.contains(target)) return;
			}
			if (e.shiftKey) {
				this._schedulePlayIn3s();
			} else {
				this._togglePlayPause();
			}
		};
		this.container.addEventListener("mousedown", _onBodyMouseDown);
		this.container.addEventListener("click", _onBodyClick);
	}

	private _onThemeChange!: (name: string) => void;

	private _setOwnedTimeout(callback: () => void, delay = 0): void {
		const timer = setTimeout(() => {
			this._ownedTimers.delete(timer);
			if (this._paneActive && !this._disposed) callback();
		}, delay);
		this._ownedTimers.add(timer);
	}

	private _togglePlayPause = (): void => {
		// Any explicit play/pause action cancels a pending shift+click
		// schedule so the timer cannot fire a stale play afterwards.
		if (this._scheduledPlayTimer != null) {
			clearTimeout(this._scheduledPlayTimer);
			this._scheduledPlayTimer = null;
		}
		if (this._doc.synth.playing) {
			this._doc.performance.pause();
		} else {
			this._doc.performance.play();
		}
		this._updatePlayPauseButton();
	};

	private _stop = (): void => {
		// Stop also cancels a pending shift+click schedule.
		if (this._scheduledPlayTimer != null) {
			clearTimeout(this._scheduledPlayTimer);
			this._scheduledPlayTimer = null;
		}
		// Pause and jump to bar 0. goToBar(0) seeds
		// totalSamplesRendered to 0 so the elapsed counter resets.
		this._doc.performance.pause();
		this._doc.synth.goToBar(0);
		// Move editor focus/scroll to bar 1 immediately so the user sees
		// the reset; waiting for the fade completion edge leaves the
		// highlight stranded at the previous position.
		this._doc.bar = 0;
		this._doc.barScrollPos = 0;
		this._doc.selection.resetBoxSelection();
		this._doc.notifier.changed();
		this._doc.notifier.notifyWatchers();
		this._updatePlayPauseButton();
	};

	// Schedule playback to restart from bar 0 after a 3-second delay.
	// Used by shift+click on the prompt body as a count-in for the musician.
	// Replaces any previously pending schedule so consecutive shift+clicks
	// re-cue cleanly.
	private _schedulePlayIn3s(): void {
		if (this._scheduledPlayTimer != null) {
			clearTimeout(this._scheduledPlayTimer);
		}
		this._doc.performance.pause();
		this._doc.synth.goToBar(0);
		this._updatePlayPauseButton();
		this._scheduledPlayTimer = setTimeout(() => {
			this._scheduledPlayTimer = null;
			if (this._disposed) return;
			this._doc.performance.play();
			this._updatePlayPauseButton();
		}, 3000);
	}

	private _toggleLoop = (): void => {
		// Mirror the standalone player: -1 = loop forever, 0 = no loop.
		this._doc.synth.loopRepeatCount = this._doc.synth.loopRepeatCount === -1 ? 0 : -1;
		this._doc.prefs.loopEnabled = this._doc.synth.loopRepeatCount === -1;
		this._doc.prefs.save();
		this._updateLoopButton();
		this._doc.notifier.changed();
		this._doc.notifier.notifyWatchers();
	};

	private _updateLoopButton = (): void => {
		const active: boolean = this._doc.synth.loopRepeatCount === -1;
		this._loopButton.style.background = active ? "var(--cta-bg)" : "var(--tab-inactive-bg)";
		this._loopButton.style.color = active ? "var(--cta-fg)" : "var(--tab-inactive-fg)";
		// The glyph is the only content, so the accessible name carries the
		// on/off state. Without it a screen reader reports a nameless button.
		this._loopButton.setAttribute("aria-pressed", String(active));
		this._loopButton.title = active ? "Loop enabled" : "Loop disabled";
	};

	private _onLoopMouseEnter = (): void => {
		// Hover accent depends on the loop state: when active, --cta-fg
		// (already the dark contrast text on --cta-bg) remains; when
		// inactive, --primary-text lifts the muted glyph into focus.
		// Mirrors the pre-phase-2 semantic exactly.
		this._loopButton.style.color =
			this._doc.synth.loopRepeatCount === -1 ? "var(--cta-fg)" : "var(--primary-text)";
	};

	// Seek the playhead to the bar position under the pointer.
	private _seekToPointer = (clientX: number): void => {
		const r = this._scrubTrack.getBoundingClientRect();
		const frac = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
		const barCount = this._doc.song.barCount;
		this._doc.synth.playhead = frac * barCount;
	};

	private _onScrubPointerDown = (event: PointerEvent): void => {
		event.preventDefault();
		this._scrubDragging = true;
		this._seekToPointer(event.clientX);
		const win = (this.container.ownerDocument.defaultView as Window | null) ?? window;
		this._removeDragListeners();
		this._dragWindow = win;
		this._dragMoveListener = (e: PointerEvent): void => {
			if (!this._scrubDragging) return;
			this._seekToPointer(e.clientX);
		};
		this._dragUpListener = (): void => {
			this._scrubDragging = false;
			this._removeDragListeners();
		};
		win.addEventListener("pointermove", this._dragMoveListener);
		win.addEventListener("pointerup", this._dragUpListener);
	};

	private _removeDragListeners(): void {
		if (this._dragWindow !== null && this._dragMoveListener !== null) {
			this._dragWindow.removeEventListener("pointermove", this._dragMoveListener);
		}
		if (this._dragWindow !== null && this._dragUpListener !== null) {
			this._dragWindow.removeEventListener("pointerup", this._dragUpListener);
		}
		this._dragWindow = null;
		this._dragMoveListener = null;
		this._dragUpListener = null;
	}

	private _updatePlayPauseButton = (): void => {
		this._playPauseButton.textContent = this._doc.synth.playing ? "⏸" : "▶";
	};

	private _updateBarPosLabel(): void {
		const bar = Math.floor(this._doc.synth.playhead) + 1;
		const total = this._doc.song.barCount;
		const generation = this._doc.notifier.generation;
		if (
			this._cachedDuration < 0 ||
			this._doc.song.barCount !== this._cachedBarCount ||
			generation !== this._cachedGeneration
		) {
			const totalSamples = this._doc.synth.getTotalSamples(true, true, 0);
			this._cachedDuration =
				totalSamples > 0 ? totalSamples / this._doc.synth.samplesPerSecond : 0;
			this._cachedBarCount = this._doc.song.barCount;
			this._cachedGeneration = generation;
		}
		const elapsed = this._doc.synth.totalSamplesRendered / this._doc.synth.samplesPerSecond;
		const elapsedStr = formatTime(elapsed);
		const totalStr = formatTime(this._cachedDuration);
		this._barPosLabel.textContent = `${elapsedStr} / ${totalStr}  -  ${bar}/${total}`;
		this._barLabelCounter = 5;
	}

	public override whenKeyPressed = (event: KeyboardEvent): void => {
		if (event.key === " ") {
			event.preventDefault();
			this._togglePlayPause();
		} else if (event.key === "[") {
			event.preventDefault();
			this._doc.synth.goToPrevBar();
			this._updateBarPosLabel();
		} else if (event.key === "]") {
			event.preventDefault();
			this._doc.synth.goToNextBar();
			this._updateBarPosLabel();
		}
	};

	protected override _saveChanges(): void {
		// No changes to save
	}

	public suspendPane(): void {
		this._paneActive = false;
		this._doc.synth.channelAudioCaptureEnabled = false;
		this._cancelFrame();
		this._removeDragListeners();
		this._scrubDragging = false;
		if (this._scheduledPlayTimer !== null) {
			clearTimeout(this._scheduledPlayTimer);
			this._scheduledPlayTimer = null;
		}
		this._resizeObserver?.disconnect();
	}

	public resumePane(): void {
		if (this._disposed) return;
		this._paneActive = true;
		this._doc.synth.channelAudioCaptureEnabled = true;
		this._setupResizeObserver();
		if (this._animationId === 0) this._scheduleFrame();
	}

	public override cleanUp = (): void => {
		if (this._disposed) return;
		this._disposed = true;
		this._paneActive = false;
		super.cleanUp();
		this._doc.synth.channelAudioCaptureEnabled = false;
		this._doc.notifier.unwatch(this._onDocChange);
		events.unlisten("themeChange", this._onThemeChange);
		this._cvSpectrum.dispose();
		if (this._resizeObserver != null) {
			this._resizeObserver.disconnect();
			this._resizeObserver = null;
		}
		if (this._popoutObserver != null) {
			this._popoutObserver.disconnect();
			this._popoutObserver = null;
		}
		this._removeDragListeners();
		this._cancelFrame();
		for (const timer of this._ownedTimers) clearTimeout(timer);
		this._ownedTimers.clear();
		// Cancel any pending shift+click scheduled play so the timer
		// cannot fire performance.play() after the prompt is torn down.
		if (this._scheduledPlayTimer != null) {
			clearTimeout(this._scheduledPlayTimer);
			this._scheduledPlayTimer = null;
		}
		while (this._contentContainer.firstChild !== null) {
			this._contentContainer.removeChild(this._contentContainer.firstChild);
		}
		this._channelVolumeBars.clear();
		this._channelVolumeCaps.clear();
		this._channelHistoricCaps.clear();
		this._channelLastWidths.clear();
		this._channelLastCaps.clear();
		this._channelDbLabels.clear();
		this._channelDivs.clear();
		this._instrumentSpans.clear();
		this._instrumentEntriesByChannel.clear();
		this._channelSpectrumColors.clear();
		this._canvasSizes.clear();
		this._channelPeak.clear();
		this._whiteKeyRects.clear();
		this._blackKeyRects.clear();
		this._keyLastRender.clear();
		this._pitchBlend.clear();
		this._cachedChannelRGB.clear();
		this._cachedInstrStyle.clear();
		this._instrActiveDecay.clear();
		this._lastChannelOpacity.clear();
		this._instrumentIndex.clear();
		this._inactiveSig.clear();
		this._renderedAudioChannelIndexes.length = 0;
		this._spectrumFrameChannels.clear();
		this._spectrumChannelCursor = 0;
		this._pitchBlendPool.length = 0;
		this._renderSignature = "";
		this._playPauseButton.removeEventListener("click", this._togglePlayPause);
		this._stopButton.removeEventListener("click", this._stop);
		this._loopButton.removeEventListener("click", this._toggleLoop);
		this._scrubTrack.removeEventListener("pointerdown", this._onScrubPointerDown);
		this._songEditor.muteEditor.setHoveredChannel(-1);
		this._songEditor.trackEditor.setHoveredChannel(-1);
		window.dispatchEvent(new Event("resize"));
		window.dispatchEvent(new Event("scroll"));
	};

	private _onDocChange!: () => void;

	// Recompute cached per-channel overlay colors. Called on render and on
	// themeChange. getComputedChannelColor forces 4 getComputedStyle calls, so
	// this must stay out of the per-frame animate loop.
	private _refreshSpectrumColors(): void {
		const song = this._doc.song;
		for (const channelIndex of this._channelSpectrumCanvases.keys()) {
			const hex = ColorConfig.getComputedChannelColor(song, channelIndex).primaryChannel;
			this._channelSpectrumColors.set(channelIndex, hex);
			this._cachedChannelRGB.set(channelIndex, hexToRgb(hex));
		}
	}

	private _repaintChannelSpectra(): void {
		for (const [channelIndex, canvas] of this._channelSpectrumCanvases) {
			const ctx = this._channelSpectrumCanvas2ds.get(channelIndex);
			const size = this._canvasSizes.get(channelIndex);
			const fg = this._spectrumSmooth.get(channelIndex);
			const bg = this._bgSpectrumSmooth.get(channelIndex);
			const color = this._channelSpectrumColors.get(channelIndex);
			if (ctx == null || size == null || fg == null || bg == null || color == null) continue;
			if (size.w <= 0 || size.h <= 0) continue;
			if (canvas.width !== size.w || canvas.height !== size.h) {
				canvas.width = size.w;
				canvas.height = size.h;
			}
			const w = canvas.width;
			const h = canvas.height;
			ctx.clearRect(0, 0, w, h);
			const gap = Math.max(1, window.devicePixelRatio || 1);
			const barOuter = w / BAR_COUNT;
			const barW = barOuter - gap;
			const radius = Math.min(barW * 0.5, h * 0.12);
			drawSpectrumBars(
				ctx,
				color,
				h,
				barOuter,
				barW,
				radius,
				gap,
				BG_BANDS,
				bg,
				FG_REF,
				0.24,
				this._smoothedMasterScale,
			);
			drawSpectrumBars(
				ctx,
				color,
				h,
				barOuter,
				barW,
				radius,
				gap,
				FG_BANDS,
				fg,
				FG_REF,
				0.48,
				this._smoothedMasterScale,
			);
		}
	}

	// Post-limiter per-channel peak: max |sample| of the channel's isolated
	// ring buffer (true amplitude, no differential clamp) over the ~170ms window,
	// scaled by the master gain the ring omits (masterGain^2 * volume * limiter).
	// Same metric as the master meter (song.outVolumeCap) and the limiter prompt, so
	// per-channel peak/avg/min/max dB are consistent with the master.
	private _computeChannelPeak(channelState: ChannelState, masterScale: number): number {
		const fftSize = FFT_SIZE;
		const ring = channelState.audioRing;
		const start = (channelState.audioRingPos - fftSize) & CHANNEL_RING_MASK;
		let peak = 0;
		for (let i = 0; i < fftSize; i++) {
			const s = ring[(start + i) & CHANNEL_RING_MASK];
			const a = s < 0 ? -s : s;
			if (a > peak) peak = a;
		}
		return Math.min(1, peak * masterScale);
	}

	// Build the piano-key rows for the current layout mode.
	// Mode 0 (double): two rows, octaves 0–3 and 4–7, each viewBox 28×1.
	// Mode 1 (single): one row, octaves 0–7, viewBox 56×1 — used when the
	// container is wide enough that two rows would make black keys too
	// wide. Re-callable: clears the SVGs and key caches first so layout
	// switches rebuild cleanly.
	private _buildPianoKeyRows(mode: number = 0): void {
		const WHITE_IDX = new Map<number, number>([
			[0, 0],
			[2, 1],
			[4, 2],
			[5, 3],
			[7, 4],
			[9, 5],
			[11, 6],
		]);
		const BLACK_X: Record<number, number> = { 1: 0.2, 3: 1.2, 6: 3.2, 8: 4.2, 10: 5.2 };
		const BLACK_KEY_W = 0.6;
		const KEY_H = 1.333;
		const BLACK_KEY_H = 0.8;
		const WHITE_R = 0.04;
		const BLACK_R = 0.03;
		const roundedBottomKey = (
			x: number,
			y: number,
			w: number,
			h: number,
			r: number,
		): string => {
			const rr = Math.min(r, w / 2, h / 2);
			const x1 = x + w;
			const y1 = y + h;
			return `M ${x} ${y} L ${x1} ${y} L ${x1} ${y1 - rr} Q ${x1} ${y1} ${x1 - rr} ${y1} L ${x + rr} ${y1} Q ${x} ${y1} ${x} ${y1 - rr} Z`;
		};

		for (const svgEl of [this._octaveRow0Svg, this._octaveRow1Svg]) {
			while (svgEl.firstChild) svgEl.removeChild(svgEl.firstChild);
		}
		this._whiteKeyRects.clear();
		this._blackKeyRects.clear();
		this._keyLastRender.clear();

		const buildRow = (
			svgEl: SVGSVGElement,
			startOctave: number,
			endOctave: number,
			viewBaseOctave: number,
		): void => {
			for (let oct = startOctave; oct <= endOctave; oct++) {
				const octX = (oct - viewBaseOctave) * 7;
				for (const [note, idx] of WHITE_IDX) {
					const pitch = (oct + 1) * 12 + note;
					const r = path({
						d: roundedBottomKey(octX + idx, 0, 1, KEY_H, WHITE_R),
						fill: "var(--pitch-background)",
						opacity: "1",
					});
					svgEl.appendChild(r);
					this._whiteKeyRects.set(pitch, r);
				}
				for (const noteStr of Object.keys(BLACK_X)) {
					const note = parseInt(noteStr, 10);
					const pitch = (oct + 1) * 12 + note;
					const r = path({
						d: roundedBottomKey(
							octX + BLACK_X[note],
							0,
							BLACK_KEY_W,
							BLACK_KEY_H,
							BLACK_R,
						),
						fill: "var(--base02-surface)",
						opacity: "1",
					});
					svgEl.appendChild(r);
					this._blackKeyRects.set(pitch, r);
				}
			}
		};

		if (mode === 1) {
			this._octaveRow0Svg.setAttribute("viewBox", "0 0 56 " + KEY_H);
			this._octaveRow1Svg.style.display = "none";
			buildRow(this._octaveRow0Svg, 0, 7, 0);
		} else {
			this._octaveRow0Svg.setAttribute("viewBox", "0 0 28 " + KEY_H);
			this._octaveRow1Svg.setAttribute("viewBox", "0 0 28 " + KEY_H);
			this._octaveRow1Svg.style.display = "";
			buildRow(this._octaveRow0Svg, 0, 3, 0);
			buildRow(this._octaveRow1Svg, 4, 7, 4);
		}
	}

	// Minimal timeline surface exposing only the fields
	// renderTimeline / renderPlayhead touch. The full player UI has many
	// more fields (buttons, sliders) that the background overlay does not
	// need.
	private _timelineSurface(): TimelineSurface {
		return {
			synth: this._doc.synth,
			timeline: this._playerTimelineSvg,
			playhead: this._playerPlayhead,
			timelineContainer: this._playerTimelineContainer,
			visualizationContainer: this._playerVizContainer,
		};
	}

	// Swap-and-pop removal used by renderPlayhead's note-flash cleanup.
	// Only invoked when the user has enabled notesFlashWhenPlayed; the
	// background overlay does not rely on flash but the player code path
	// still requires a valid callback.
	private static _removeAt(array: unknown[], index: number): void {
		const last = array.length - 1;
		array[index] = array[last];
		array.pop();
	}

	// Schedule the next animate frame on whichever window currently hosts the
	// container. ownerDocument.defaultView is the popout window when the container
	// has been adopted into it, otherwise the main window. Falling back to the
	// main window covers the close path where the container may be momentarily
	// detached. Tracking _rafWin lets cleanUp cancel on the same window.
	private _cancelFrame(): void {
		this._animationGeneration++;
		const id = this._animationId;
		const owner = this._rafWin;
		this._animationId = 0;
		if (id === 0) return;
		try {
			owner.cancelAnimationFrame(id);
		} catch {
			// A closed popout window releases its own frame queue.
		}
	}

	private _scheduleFrame(): void {
		if (!this._paneActive || this._disposed || this._animationId !== 0) return;
		const owner = (this.container.ownerDocument.defaultView as Window | null) ?? window;
		const generation = ++this._animationGeneration;
		let id = 0;
		id = owner.requestAnimationFrame(() => {
			if (
				generation !== this._animationGeneration ||
				owner !== this._rafWin ||
				id !== this._animationId
			)
				return;
			this._animationId = 0;
			this._animate();
		});
		this._rafWin = owner;
		this._animationId = id;
	}

	private _animate(): void {
		if (!this._paneActive || this._disposed) return;
		// Show spectrum only when popped out; when docked the editor's
		// main spectrum already fills the viewport.
		const isPopout = this.container.ownerDocument.defaultView !== window;
		this._cvSpectrum.canvas.style.display = isPopout ? "block" : "none";
		this._playerOverlay.style.display = isPopout ? "" : "none";

		// Piano layout is always single-row (octaves 0-7 in one row)
		// for vertical estate. Built once in constructor.

		// Player timeline background: render only the bars inside (or near)
		// the visible viewport, not the whole song. renderTimeline rebuilds
		// the SVG, so it runs only when the song changes, the viewport
		// resizes, or the visible bar window drifts past the overscan
		// margin. renderPlayhead runs every frame to follow the playhead.
		if (isPopout) {
			if (!this._wasPopout) {
				this._playerTimelineDirty = true;
				invalidateVizWidthCache();
			}
			// Measure viewport size only when dirty (resize / popout transition).
			// Reading clientWidth/Height every frame forces reflow against the
			// SVG after renderTimeline writes; caching avoids that on steady frames.
			let vw = this._playerLastW;
			let vh = this._playerLastH;
			if (this._playerTimelineDirty || vw <= 0 || vh <= 0) {
				vw = this._playerVizContainer.clientWidth;
				vh = this._playerVizContainer.clientHeight;
				if (vw !== this._playerLastW || vh !== this._playerLastH) invalidateVizWidthCache();
			}
			if (vw > 0 && vh > 0) {
				const barCount = this._doc.song.barCount;
				const tlW = getTimelineWidth();
				const barWidth = barCount > 0 ? tlW / barCount : 1;
				// Compute scroll from the playhead directly (same formula
				// renderPlayhead uses) instead of reading scrollLeft back.
				// The read-back forced a reflow after renderPlayhead's write and
				// coupled the window computation to the write frame.
				const pos = barCount > 0 ? this._doc.synth.playhead / barCount : 0;
				const scroll = tlW > vw ? pos * (tlW - vw) : 0;
				const visStart = barWidth > 0 ? Math.floor(scroll / barWidth) : 0;
				const visEnd = barWidth > 0 ? Math.ceil((scroll + vw) / barWidth) : barCount;
				// Overscan as a real buffer: only re-render when the visible
				// window is about to exit the rendered window. The previous
				// condition (desStart !== renderedStart) re-rendered on every
				// 1-bar shift, making the overscan useless and firing a full
				// SVG rebuild per bar of playback (the 100-300ms spikes).
				const renderedStart = this._playerRenderedStart;
				const renderedEnd = this._playerRenderedEnd;
				const exitedWindow =
					renderedStart < 0 || visStart < renderedStart || visEnd > renderedEnd;
				if ((this._playerTimelineDirty || exitedWindow) && tlW > 0) {
					const desStart = Math.max(
						0,
						visStart - ChannelVolumeVisualizerPrompt.PLAYER_OVERSCAN,
					);
					const desEnd = Math.min(
						barCount,
						visEnd + ChannelVolumeVisualizerPrompt.PLAYER_OVERSCAN,
					);
					const ui = this._timelineSurface();
					renderTimeline(
						ui,
						true,
						ChannelVolumeVisualizerPrompt._removeAt,
						desStart,
						desEnd,
						true,
					);
					this._playerTimelineDirty = false;
					this._playerLastW = vw;
					this._playerLastH = vh;
					this._playerRenderedStart = desStart;
					this._playerRenderedEnd = desEnd;
				}
				// Throttle the playhead follow to every 2nd frame (30fps).
				if (
					!this._playerTimelineDirty &&
					this._playerRenderedStart >= 0 &&
					this._playerFrameToggle
				) {
					renderPlayhead(
						this._timelineSurface(),
						ChannelVolumeVisualizerPrompt._removeAt,
					);
				}
			}
		}
		this._wasPopout = isPopout;

		// Show song title in the prompt titlebar when popped out.
		const h2 = this.container.querySelector<HTMLHeadingElement>(".prompt-titlebar h2");
		if (h2)
			h2.textContent = isPopout
				? this._doc.song.title || "Untitled"
				: "Channel Volume Visualizer";

		// Update play/pause button state
		this._updatePlayPauseButton();
		this._updateLoopButton();

		// Update scrub bar: progress fill width as percentage of track.
		{
			const barCount = this._doc.song.barCount;
			const frac =
				barCount > 0 ? Math.max(0, Math.min(1, this._doc.synth.playhead / barCount)) : 0;
			this._scrubFill.style.width = `${frac * 100}%`;
		}

		// Update bar position label with elapsed time (throttled).
		this._barLabelCounter--;
		if (this._barLabelCounter <= 0) {
			this._updateBarPosLabel();
		}

		// Update tempo label. Match the editor tempo stepper: show the modded
		// runtime tempo when tempo modulation is active.
		const tempoSetting = Config.modulators.dictionary.tempo.index;
		const tempoModActive = this._doc.synth.isModActive(tempoSetting);
		const displayTempo = tempoModActive
			? Math.max(0, Math.round(this._doc.synth.getModValue(tempoSetting)))
			: Math.max(0, Math.round(this._doc.song.tempo));
		this._tempoLabel.textContent = `BPM: ${displayTempo}`;
		this._tempoLabel.classList.toggle("modActive", tempoModActive);

		// Master volume from the post-limiter sample peak (song.outVolumeCap), the
		// same source as the limiter prompt's Out meter and the editor's main meter.
		// Peak (not RMS) so it reacts to kicks/transients and matches the actual
		// output sample level.
		const masterLevel = this._doc.song.outVolumeCap;

		// Track historic peak for dB stats
		this._historicTimer--;
		if (this._historicTimer <= 0) {
			this._historicVolumeCap -= 0.03;
		}
		if (masterLevel > this._historicVolumeCap) {
			this._historicVolumeCap = masterLevel;
			this._historicTimer = 50;
		}

		// Update master dB labels (dBFS peak: full-scale = 0 dB)
		const masterPeakDb =
			this._historicVolumeCap > 0 ? 20 * Math.log10(this._historicVolumeCap) : -Infinity;
		this._masterDbPeakLabel.textContent = Number.isFinite(masterPeakDb)
			? `Peak: ${masterPeakDb.toFixed(1)} dB`
			: "Peak: -inf dB";

		// Update average, min, max
		if (masterLevel > 0) {
			this._masterVolumeSum += masterLevel;
			this._masterSampleCount++;

			const currentDb = 20 * Math.log10(masterLevel);
			if (Number.isFinite(currentDb)) {
				if (currentDb < this._masterMinDb) this._masterMinDb = currentDb;
				if (currentDb > this._masterMaxDb) this._masterMaxDb = currentDb;
			}
		}
		if (this._masterSampleCount > 0) {
			const avg = this._masterVolumeSum / this._masterSampleCount;
			const avgDb = avg > 0 ? 20 * Math.log10(avg) : -Infinity;
			this._masterDbAvgLabel.textContent = Number.isFinite(avgDb)
				? `Avg: ${avgDb.toFixed(1)} dB`
				: "Avg: -inf dB";

			const minDb = Number.isFinite(this._masterMinDb)
				? this._masterMinDb.toFixed(1)
				: "-inf";
			const maxDb = Number.isFinite(this._masterMaxDb)
				? this._masterMaxDb.toFixed(1)
				: "-inf";
			this._masterDbMinMaxLabel.textContent = `${minDb}/${maxDb} dB`;
		}

		// Update per-channel volume bars
		const synth = this._doc.synth;
		// Smooth the post-limiter master gain the per-channel ring omits, so the
		// per-channel meters and spectrum reflect the output-bus level. Smoothed to
		// tame the limiter's fast per-sample dynamics.
		const targetScale = synth.getMasterScale();
		this._smoothedMasterScale += (targetScale - this._smoothedMasterScale) * 0.3;
		this._spectrumFrameChannels.clear();
		if (
			(this._doc.synth.playing || this._doc.synth.fadingOut) &&
			this._renderedAudioChannelIndexes.length > 0
		) {
			const channelCount = this._renderedAudioChannelIndexes.length;
			const count = Math.min(MAX_FFT_CHANNELS_PER_FRAME, channelCount);
			let added = 0;
			for (let i = 0; i < channelCount && added < count; i++) {
				const channelIndex =
					this._renderedAudioChannelIndexes[
						(this._spectrumChannelCursor + i) % channelCount
					];
				if ((this._channelPeak.get(channelIndex) ?? 0) <= 0.001) continue;
				this._spectrumFrameChannels.add(channelIndex);
				added++;
			}
			for (let i = 0; i < channelCount && added < count; i++) {
				const channelIndex =
					this._renderedAudioChannelIndexes[
						(this._spectrumChannelCursor + i) % channelCount
					];
				if (this._spectrumFrameChannels.has(channelIndex)) continue;
				this._spectrumFrameChannels.add(channelIndex);
				added++;
			}
			this._spectrumChannelCursor = (this._spectrumChannelCursor + count) % channelCount;
		}
		for (const [channelIndex, bar] of this._channelVolumeBars) {
			const channelState = synth.channels[channelIndex];
			if (!channelState) continue;

			const channelLevel = this._computeChannelPeak(channelState, this._smoothedMasterScale);
			this._channelPeak.set(channelIndex, channelLevel);

			let historic = this._channelHistoricCaps.get(channelIndex);
			if (!historic) {
				historic = { cap: 0, timer: 0 };
				this._channelHistoricCaps.set(channelIndex, historic);
			}

			historic.timer--;
			if (historic.timer <= 0) {
				historic.cap -= 0.03;
			}
			if (channelLevel > historic.cap) {
				historic.cap = channelLevel;
				historic.timer = 50;
			}

			// Fill and cap as percentages of the track (90% of container = 144 viewBox units).
			const fillPct = Math.round(Math.max(1 / 144, Math.min(1, channelLevel)) * 10000) / 100;
			const capPct = Math.round(Math.min(1, historic.cap) * 10000) / 100;
			const lastWidth = this._channelLastWidths.get(channelIndex) ?? -1;
			const lastCap = this._channelLastCaps.get(channelIndex) ?? -1;
			if (fillPct !== lastWidth) {
				this._channelLastWidths.set(channelIndex, fillPct);
				bar.style.width = `${fillPct}%`;
			}
			const capEl = this._channelVolumeCaps.get(channelIndex);
			if (capEl && capPct !== lastCap) {
				this._channelLastCaps.set(channelIndex, capPct);
				capEl.style.left = `${capPct}%`;
			}

			// Update average and range for channel (dBFS(A))
			if (channelLevel > 0) {
				const sum = (this._channelVolumeSums.get(channelIndex) ?? 0) + channelLevel;
				const count = (this._channelSampleCounts.get(channelIndex) ?? 0) + 1;
				this._channelVolumeSums.set(channelIndex, sum);
				this._channelSampleCounts.set(channelIndex, count);

				const currentDb = 20 * Math.log10(channelLevel);
				if (Number.isFinite(currentDb)) {
					const minDb = this._channelMinDb.get(channelIndex) ?? Infinity;
					const maxDb = this._channelMaxDb.get(channelIndex) ?? -Infinity;
					if (currentDb < minDb) this._channelMinDb.set(channelIndex, currentDb);
					if (currentDb > maxDb) this._channelMaxDb.set(channelIndex, currentDb);
				}
			}

			// Update channel dB label with peak, avg, and range
			const dbLabel = this._channelDbLabels.get(channelIndex);
			if (dbLabel) {
				const peakDb = historic.cap > 0 ? 20 * Math.log10(historic.cap) : -Infinity;
				const sampleCount = this._channelSampleCounts.get(channelIndex) ?? 0;
				const avg =
					sampleCount > 0
						? (this._channelVolumeSums.get(channelIndex) ?? 0) / sampleCount
						: -Infinity;
				const avgDb = avg > 0 ? 20 * Math.log10(avg) : -Infinity;
				const minDb = this._channelMinDb.get(channelIndex) ?? Infinity;
				const maxDb = this._channelMaxDb.get(channelIndex) ?? -Infinity;
				const avgText = Number.isFinite(avgDb) ? avgDb.toFixed(1) : "-inf";
				const minText = Number.isFinite(minDb) ? minDb.toFixed(1) : "-inf";
				const maxText = Number.isFinite(maxDb) ? maxDb.toFixed(1) : "-inf";
				dbLabel.textContent = Number.isFinite(peakDb)
					? `Pk:${peakDb.toFixed(1)}\nA:${avgText}\n${minText}/${maxText}`
					: `Pk:-inf\nA:${avgText}\n${minText}/${maxText}`;
			}

			if (!this._spectrumFrameChannels.has(channelIndex)) {
				continue;
			}

			// Draw pitch spectrum overlay: smooth bezier curve fill from active tone bands.
			// The 8192-point FFT runs on this phase (every 2nd frame, 30fps).
			const spectrumCtx = this._channelSpectrumCanvas2ds.get(channelIndex);
			if (spectrumCtx) {
				const cvs = this._channelSpectrumCanvases.get(channelIndex);
				// Backing-store size comes from the ResizeObserver cache, not a per-frame
				// clientWidth/clientHeight read (which would force a layout reflow).
				const size = this._canvasSizes.get(channelIndex);
				if (cvs && size && size.w > 0 && size.h > 0) {
					if (cvs.width !== size.w || cvs.height !== size.h) {
						cvs.width = size.w;
						cvs.height = size.h;
					}

					const w = cvs.width;
					const h = cvs.height;
					spectrumCtx.clearRect(0, 0, w, h);

					// Real audio FFT from per-channel ring buffer. Pipeline mirrors the
					// main FG spectrum (shared/spectrum.ts): Hann window, magnitude per
					// bin, quadratic-interpolated log bands, spectral-tilt gain, gaussian
					// blur, temporal smoothing, single fixed-ref soft-compression. The
					// per-channel ring holds the channel's own isolated diff at true
					// amplitude, so no extra gain is applied.
					const fftSize = FFT_SIZE;
					const fftBuf = this._fftScratch;
					const mags = this._magScratch;
					const ring = channelState.audioRing;
					const ringStart = (channelState.audioRingPos - fftSize) & CHANNEL_RING_MASK;
					for (let i = 0; i < fftSize; i++) {
						const idx = (ringStart + i) & CHANNEL_RING_MASK;
						const hann = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (fftSize - 1)));
						fftBuf[i] = ring[idx] * hann;
					}
					forwardRealFourierTransform(fftBuf);

					const halfN = fftSize >> 1;
					const sampleRate = this._doc.synth.samplesPerSecond || 48000;
					const binFreq = sampleRate / fftSize;
					for (let k = 0; k <= halfN; k++) {
						const re = fftBuf[k];
						const im = k === 0 || k === halfN ? 0 : fftBuf[fftSize - k];
						mags[k] = Math.sqrt(re * re + im * im) / fftSize;
					}

					// Interpolate FG bands from FFT bins (quadratic for sensitivity).
					const bandMags = this._bandMags;
					for (let b = 0; b < FG_BANDS; b++) {
						const kFloat = this._fgFreqs[b] / binFreq;
						const k = Math.floor(kFloat);
						const frac = kFloat - k;
						if (k < 1 || k >= halfN) {
							const kHi = Math.min(k + 1, halfN);
							bandMags[b] = mags[k] + (mags[kHi] - mags[k]) * frac;
						} else {
							const ym1 = mags[k - 1],
								y0 = mags[k],
								yp1 = mags[k + 1];
							const qa = (ym1 + yp1) * 0.5 - y0;
							const qb = (yp1 - ym1) * 0.5;
							const qc = y0;
							bandMags[b] = qa * frac * frac + qb * frac + qc;
						}
					}
					// Per-band gain: ramp 0.5x (low) to 2x (high) to compensate spectral tilt.
					const fgGainStep = 1.5 / (FG_BANDS - 1);
					for (let b = 0; b < FG_BANDS; b++) {
						bandMags[b] *= 0.5 + b * fgGainStep;
					}
					// Light gaussian spatial blur (sigma=3 bands) to suppress peak jitter.
					// Truncated precomputed kernel (BLUR_KERNEL, +-BLUR_RADIUS) makes this
					// O(FG_BANDS * kernelWidth) instead of O(FG_BANDS^2). Output written to a
					// separate array so the convolution reads original values, not in-place writes.
					const blurred = this._blurred;
					const kernel = BLUR_KERNEL;
					for (let b = 0; b < FG_BANDS; b++) {
						let sum = 0;
						let wSum = 0;
						const n0 = Math.max(0, b - BLUR_RADIUS);
						const n1 = Math.min(FG_BANDS - 1, b + BLUR_RADIUS);
						for (let n = n0; n <= n1; n++) {
							const wt = kernel[BLUR_RADIUS + (n - b)];
							sum += bandMags[n] * wt;
							wSum += wt;
						}
						blurred[b] = wSum > 0.001 ? sum / wSum : 0;
					}
					for (let b = 0; b < FG_BANDS; b++) bandMags[b] = blurred[b];

					// Temporal smoothing: instant attack, 0.55/0.45 decay (matches main FG).
					let smooth = this._spectrumSmooth.get(channelIndex);
					if (!smooth || smooth.length !== FG_BANDS) {
						smooth = new Float32Array(FG_BANDS);
						this._spectrumSmooth.set(channelIndex, smooth);
					}
					for (let b = 0; b < FG_BANDS; b++) {
						if (bandMags[b] > smooth[b]) {
							smooth[b] = bandMags[b];
						} else {
							smooth[b] = smooth[b] * 0.55 + bandMags[b] * 0.45;
						}
					}

					// Interpolate BG bands from same FFT bins.
					const bgBandMags = this._bgBandMags;
					for (let b = 0; b < BG_BANDS; b++) {
						const kFloat = this._bgFreqs[b] / binFreq;
						const k = Math.floor(kFloat);
						const frac = kFloat - k;
						if (k < 1 || k >= halfN) {
							const kHi = Math.min(k + 1, halfN);
							bgBandMags[b] = mags[k] + (mags[kHi] - mags[k]) * frac;
						} else {
							const ym1 = mags[k - 1],
								y0 = mags[k],
								yp1 = mags[k + 1];
							const qa = (ym1 + yp1) * 0.5 - y0;
							const qb = (yp1 - ym1) * 0.5;
							const qc = y0;
							bgBandMags[b] = qa * frac * frac + qb * frac + qc;
						}
					}
					// BG spectral tilt: 0.25x at 20Hz to 0.5x at 130Hz (matches FG's
					// 0.5x floor at the transition, preventing BG from looking amp'd).
					const bgGainStep = 0.25 / (BG_BANDS - 1);
					for (let b = 0; b < BG_BANDS; b++) {
						bgBandMags[b] *= 0.25 + b * bgGainStep;
					}
					// BG light gaussian blur (sigma=2 bands)
					// BG light gaussian blur (sigma=2 bands) with precomputed
					// truncated kernel — avoids O(N^2) Math.exp() per frame.
					{
						const bgBlurred = this._bgBlurred;
						const kernel = BG_BLUR_KERNEL;
						for (let b = 0; b < BG_BANDS; b++) {
							let sum = 0,
								wSum = 0;
							const n0 = Math.max(0, b - BG_BLUR_RADIUS);
							const n1 = Math.min(BG_BANDS - 1, b + BG_BLUR_RADIUS);
							for (let n = n0; n <= n1; n++) {
								const wt = kernel[BG_BLUR_RADIUS + (n - b)];
								sum += bgBandMags[n] * wt;
								wSum += wt;
							}
							bgBlurred[b] = wSum > 0.001 ? sum / wSum : 0;
						}
						for (let b = 0; b < BG_BANDS; b++) bgBandMags[b] = bgBlurred[b];
					}
					// BG temporal smoothing: instant attack, faster decay (matches main BG).
					let bgSmooth = this._bgSpectrumSmooth.get(channelIndex);
					if (!bgSmooth || bgSmooth.length !== BG_BANDS) {
						bgSmooth = new Float32Array(BG_BANDS);
						this._bgSpectrumSmooth.set(channelIndex, bgSmooth);
					}
					for (let b = 0; b < BG_BANDS; b++) {
						if (bgBandMags[b] > bgSmooth[b]) {
							bgSmooth[b] = bgBandMags[b];
						} else {
							bgSmooth[b] = bgSmooth[b] * 0.31 + bgBandMags[b] * 0.69;
						}
					}

					// Draw rounded-bottom-up bars: aggregate the FG bands into BAR_COUNT bars,
					// each a rounded-top rectangle filled from the card bottom. A continuous
					// wave is unreadable on the narrow 1:1 cards. Uses module-level
					// drawSpectrumBars to avoid per-channel closure allocation.
					const col = this._channelSpectrumColors.get(channelIndex);
					if (col) {
						const gap = Math.max(1, window.devicePixelRatio || 1);
						const barOuter = w / BAR_COUNT;
						const barW = barOuter - gap;
						const radius = Math.min(barW * 0.5, h * 0.12);
						const ms = this._smoothedMasterScale;

						// BG layer (low frequencies) drawn first
						drawSpectrumBars(
							spectrumCtx,
							col,
							h,
							barOuter,
							barW,
							radius,
							gap,
							BG_BANDS,
							bgSmooth,
							FG_REF,
							0.24,
							ms,
						);
						// FG layer (mid-high frequencies) drawn on top
						drawSpectrumBars(
							spectrumCtx,
							col,
							h,
							barOuter,
							barW,
							radius,
							gap,
							FG_BANDS,
							smooth,
							FG_REF,
							0.48,
							ms,
						);
					}
				}
			}

			// Update dim state: dim if P0. Gate writes to avoid forced
			// style recalc on every frame when the value is stable.
			const channelDiv = this._channelDivs.get(channelIndex);
			if (channelDiv) {
				const songChannel = this._doc.song.channels[channelIndex];
				if (songChannel) {
					const currentBarAnim = Math.floor(this._doc.synth.playhead);
					const hasPat = songChannel.bars[currentBarAnim] > 0;
					const newOpacity = hasPat ? "1" : "0.5";
					const lastOpacity = this._lastChannelOpacity.get(channelIndex);
					if (lastOpacity !== newOpacity) {
						this._lastChannelOpacity.set(channelIndex, newOpacity);
						channelDiv.style.opacity = newOpacity;
					}
				}
			}

			// Update instrument highlights. Uses cached RGB, pre-parsed
			// instrument indices, and pre-computed sig strings to eliminate
			// ALL per-frame allocations in this hot loop: no key.split(),
			// no template-literal strings, no String() coercion.
			const channel = this._doc.song.channels[channelIndex];
			if (channel) {
				const chanPeak = this._channelPeak.get(channelIndex) ?? 0;
				const v = chanPeak * 3.16;
				const peakScaled = (2 * v) / (v + 1.0);
				const volBrightness = 0.3 + Math.min(1, peakScaled) * 0.7;
				const rgb = this._cachedChannelRGB.get(channelIndex) ?? {
					r: 0x88,
					g: 0x88,
					b: 0x88,
				};
				const t = Math.min(1, Math.max(0, (volBrightness - 0.3) / 0.7));
				const br = Math.round(rgb.r + (255 - rgb.r) * t);
				const bg = Math.round(rgb.g + (255 - rgb.g) * t);
				const bb = Math.round(rgb.b + (255 - rgb.b) * t);
				const activeBg = `rgb(${br},${bg},${bb})`;
				const activeColor = t > 0.5 ? "black" : "var(--editor-background)";
				const activeOpacity = String(volBrightness);
				const spectrumColor =
					this._channelSpectrumColors.get(channelIndex) ?? "var(--primary-text)";
				const inactiveBg = "var(--ui-widget-background)";
				const inactiveOpacity = "0.5";
				// Pre-compute sig strings for this channel so the
				// per-instrument loop does zero string allocation.
				const activeSig = `a:${activeBg}|${activeColor}|${activeOpacity}`;
				const inactiveSig = `i:${inactiveBg}|${spectrumColor}|${inactiveOpacity}`;
				this._inactiveSig.set(channelIndex, inactiveSig);

				const entries = this._instrumentEntriesByChannel.get(channelIndex);
				if (!entries) continue;
				for (const entry of entries) {
					const key = entry.key;
					const instrSpan = entry.span;
					const instrState = channelState.instruments[entry.index];
					if (!instrState) continue;

					const isPlaying =
						(instrState.activeTones.count() > 0 ||
							instrState.liveInputTones.count() > 0) &&
						chanPeak > 0.001;
					if (isPlaying) {
						this._instrActiveDecay.set(key, 4);
					}

					const decay = this._instrActiveDecay.get(key) ?? 0;
					const showActive = isPlaying || decay > 0;
					if (!isPlaying && decay > 0) {
						this._instrActiveDecay.set(key, decay - 1);
					}

					if (showActive) {
						if (this._cachedInstrStyle.get(key) !== activeSig) {
							this._cachedInstrStyle.set(key, activeSig);
							instrSpan.style.background = activeBg;
							instrSpan.style.color = activeColor;
							instrSpan.style.opacity = activeOpacity;
						}
					} else {
						if (this._cachedInstrStyle.get(key) !== inactiveSig) {
							this._cachedInstrStyle.set(key, inactiveSig);
							instrSpan.style.background = inactiveBg;
							instrSpan.style.color = spectrumColor;
							instrSpan.style.opacity = inactiveOpacity;
						}
					}
				}
			}
		}

		// Update piano key octave display — alpha peak curve with
		// weighted-RGB channel color mixing when multiple channels
		// play the same pitch. Reuses a single Map cleared per frame
		// instead of allocating a new Map every rAF (eliminates GC
		// pressure from ~hundreds of kB/s of Map + entry objects).
		{
			const pitchBlend = this._pitchBlend;
			const pool = this._pitchBlendPool;
			// Return last frame's entries to pool before clearing, so the
			// collectPitches loop below reuses existing objects instead of
			// allocating new {r,g,b,w,maxPeak} every frame. The pool grows
			// to peak pitch count and stays — no GC pressure from entries.
			for (const [, entry] of pitchBlend) {
				pool.push(entry);
			}
			pitchBlend.clear();

			for (let ci = 0; ci < synth.channels.length; ci++) {
				const cs = synth.channels[ci];
				if (!cs) continue;
				const peak = this._channelPeak.get(ci) ?? 0;
				if (peak <= 0.001) continue;

				const cachedRgb = this._cachedChannelRGB.get(ci);
				if (!cachedRgb) continue;
				const cr = cachedRgb.r;
				const cg = cachedRgb.g;
				const cb = cachedRgb.b;

				const collectPitches = (pitches: number[], count: number): void => {
					for (let pi = 0; pi < count; pi++) {
						const p = pitches[pi];
						let b = pitchBlend.get(p);
						if (!b) {
							// Reuse from pool if available, else allocate once.
							b = this._pitchBlendPool.pop() ?? {
								r: 0,
								g: 0,
								b: 0,
								w: 0,
								maxPeak: 0,
							};
							b.r = 0;
							b.g = 0;
							b.b = 0;
							b.w = 0;
							b.maxPeak = 0;
							pitchBlend.set(p, b);
						}
						b.r += cr * peak;
						b.g += cg * peak;
						b.b += cb * peak;
						b.w += peak;
						if (peak > b.maxPeak) b.maxPeak = peak;
					}
				};

				for (const inst of cs.instruments) {
					for (let ti = 0; ti < inst.activeTones.count(); ti++) {
						const tone = inst.activeTones.get(ti);
						collectPitches(tone.pitches, tone.pitchCount);
					}
					for (let li = 0; li < inst.liveInputTones.count(); li++) {
						const tone = inst.liveInputTones.get(li);
						collectPitches(tone.pitches, tone.pitchCount);
					}
				}
			}

			const updateKeys = (rects: Map<number, SVGPathElement>, defaultFill: string): void => {
				for (const [pitch, r] of rects) {
					const b = pitchBlend.get(pitch);
					let fill: string;
					let opacity: string;
					if (b && b.w > 0) {
						const rr = Math.round(b.r / b.w);
						const gg = Math.round(b.g / b.w);
						const bb = Math.round(b.b / b.w);
						fill = `rgb(${rr},${gg},${bb})`;
						const v = b.maxPeak * 3.16;
						const peakScaled = (2 * v) / (v + 1.0);
						opacity = String(0.3 + Math.min(1, peakScaled) * 0.7);
					} else {
						fill = defaultFill;
						opacity = "1";
					}
					const sig = `${fill}|${opacity}`;
					if (this._keyLastRender.get(pitch) !== sig) {
						this._keyLastRender.set(pitch, sig);
						r.setAttribute("fill", fill);
						r.setAttribute("opacity", opacity);
					}
				}
			};

			updateKeys(this._whiteKeyRects, "var(--pitch-background)");
			updateKeys(this._blackKeyRects, "var(--base02-surface)");
		}
		this._spectrumFrameToggle = !this._spectrumFrameToggle;
		this._playerFrameToggle = !this._playerFrameToggle;
		this._scheduleFrame();
	}

	private _renderChannelList = (): void => {
		const song = this._doc.song;
		const synth = this._doc.synth;
		const channelCount = song.getChannelCount();

		// Compute structural signature: channel count + instrument count per
		// channel. If the signature matches the last render, skip the full DOM
		// rebuild — nothing structural changed. This prevents a full-grid flash
		// (DOM teardown + recreation) when notifyWatchers fires during playback
		// from unrelated window events (mousemove, etc.) or center-follow scroll.
		let sig = String(channelCount);
		for (let ci = 0; ci < channelCount; ci++) {
			sig += "," + song.channels[ci].instruments.length;
		}
		if (sig === this._renderSignature && this._channelDivs.size > 0) {
			return;
		}
		this._renderSignature = sig;
		while (this._contentContainer.firstChild) {
			this._contentContainer.removeChild(this._contentContainer.firstChild);
		}
		this._playerTimelineDirty = true;
		invalidateVizWidthCache();
		this._playerRenderedStart = -1;
		this._playerRenderedEnd = -1;
		this._channelVolumeBars.clear();
		this._channelVolumeCaps.clear();
		this._channelLastWidths.clear();
		this._channelLastCaps.clear();
		this._channelDbLabels.clear();
		this._channelDivs.clear();
		this._instrumentSpans.clear();
		this._instrumentEntriesByChannel.clear();
		this._channelSpectrumCanvases.clear();
		this._channelSpectrumCanvas2ds.clear();
		this._spectrumSmooth.clear();
		this._channelSpectrumColors.clear();
		this._canvasSizes.clear();
		this._channelPeak.clear();
		this._cachedChannelRGB.clear();
		this._cachedInstrStyle.clear();
		this._instrActiveDecay.clear();
		this._lastChannelOpacity.clear();
		this._instrumentIndex.clear();
		this._inactiveSig.clear();
		this._renderedAudioChannelIndexes.length = 0;
		this._spectrumFrameChannels.clear();
		this._spectrumChannelCursor = 0;
		this._pitchBlendPool.length = 0;
		this._pitchBlend.clear();

		// Invalidate duration cache so the bar position label reflects the
		// newly imported song's bar count and duration.
		this._cachedDuration = -1;
		this._cachedBarCount = -1;

		if (channelCount === 0) {
			this._contentContainer.appendChild(
				div(
					{
						style: "color: var(--secondary-text); text-align: center; padding: 20px;",
					},
					"No channels in this song.",
				),
			);
			return;
		}

		for (let i = 0; i < channelCount; i++) {
			const channel = song.channels[i];
			const channelState = synth.channels[i];
			if (!channel) continue;

			const isMuted = channel.muted;
			const isModChannel = i >= song.pitchChannelCount + song.noiseChannelCount;
			if (isModChannel) continue; // Skip mod channels
			this._renderedAudioChannelIndexes.push(i);

			const isDrumChannel = i >= song.pitchChannelCount;

			const channelName = channel.name || `${i + 1}`;
			const channelType = isDrumChannel ? "Drum" : "Pitch";
			const channelColors = ColorConfig.getChannelColor(song, i);

			// Check if channel has pattern or sound (only dim during playback)
			const currentBar = Math.floor(this._doc.synth.playhead);
			const patternIndex = channel.bars[currentBar];
			const hasPattern = patternIndex > 0;
			const isPlaying = this._doc.synth.playing;
			const isDimmed = isPlaying && !hasPattern;

			// Volume bar for this channel — pill-shaped div track + fill + cap
			const volFill = div({
				style: `width: 0%; height: 100%; background: ${channelColors.primaryChannel}; border-radius: 999px;`,
			});
			const volCap = div({
				style: `position: absolute; left: 0%; top: 0; width: 2px; height: 100%; background: ${channelColors.primaryNote}; border-radius: 1px;`,
			});

			this._channelVolumeBars.set(i, volFill);
			this._channelVolumeCaps.set(i, volCap);

			const dbLabel = span(
				{
					style: `color: ${channelColors.primaryChannel}; opacity: 0.8; font-size: 9px; font-weight: 600; font-family: monospace; text-align: center; display: block; white-space: pre-line;`,
				},
				"Pk:-inf\nA:-inf\n-inf/-inf",
			);
			this._channelDbLabels.set(i, dbLabel);

			const volBarContainer = div(
				{ style: "position: relative; width: 100%; height: 12px; touch-action: none;" },
				div(
					{
						style: "position: absolute; left: 5%; top: 30%; width: 90%; height: 40%; background: var(--ui-widget-background, #444); border-radius: 999px; overflow: hidden;",
					},
					volFill,
					volCap,
				),
			);

			const channelDiv = div({
				class: "cvvChannelTile",
				style: `display: flex; flex-direction: column; padding: 4px 8px; min-width: 0; overflow: hidden; position: relative; border: 2px solid ${
					isMuted ? "var(--mute-button-normal)" : channelColors.primaryChannel
				}; border-radius: var(--border-radius-medium); background: var(--editor-background); cursor: pointer; ${isMuted ? "opacity: 0.5;" : ""} ${isDimmed ? "opacity: 0.5;" : ""}`,
			});
			this._channelDivs.set(i, channelDiv);

			channelDiv.addEventListener("mouseenter", () => {
				this._songEditor.muteEditor.setHoveredChannel(i);
				this._songEditor.trackEditor.setHoveredChannel(i);
			});
			channelDiv.addEventListener("mouseleave", () => {
				this._songEditor.muteEditor.setHoveredChannel(-1);
				this._songEditor.trackEditor.setHoveredChannel(-1);
			});
			channelDiv.addEventListener("click", () => {
				this._doc.channel = i;
				this._doc.notifier.changed();
			});

			const headerDiv = div({
				style: "display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; min-width: 0; overflow: hidden;",
			});

			headerDiv.appendChild(
				span(
					{
						style: `font-weight: bold; color: ${channelColors.primaryChannel}; font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex-shrink: 1; min-width: 0;`,
					},
					channelName,
				),
			);

			headerDiv.appendChild(
				span(
					{
						style: `font-size: 9px; font-weight: 600; color: ${channelColors.primaryChannel}; opacity: 0.7;`,
					},
					channelType,
				),
			);

			// Show active pattern if playing
			if (patternIndex > 0) {
				headerDiv.appendChild(
					span(
						{
							style: `font-size: 9px; font-weight: 600; color: ${channelColors.primaryNote}; margin-left: 4px;`,
						},
						`P${patternIndex}`,
					),
				);
			}

			const contentWrap = div({
				style: "display: flex; flex-direction: column; flex: 1; min-height: 0; position: relative; z-index: 1;",
			});
			channelDiv.appendChild(contentWrap);
			contentWrap.appendChild(headerDiv);
			contentWrap.appendChild(volBarContainer);
			contentWrap.appendChild(dbLabel);

			// Pitch spectrum overlay canvas (z-index: 0 paints after parent bg, before contentWrap at z-index 1)
			const spectrumCanvas = document.createElement("canvas");
			spectrumCanvas.width = 128;
			spectrumCanvas.height = 16;
			spectrumCanvas.style.cssText =
				"position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 0; border-radius: inherit;";
			channelDiv.insertBefore(spectrumCanvas, contentWrap);
			this._channelSpectrumCanvases.set(i, spectrumCanvas);
			this._channelSpectrumCanvas2ds.set(i, spectrumCanvas.getContext("2d"));
			const hex = ColorConfig.getComputedChannelColor(song, i).primaryChannel;
			this._channelSpectrumColors.set(i, hex);
			this._cachedChannelRGB.set(i, hexToRgb(hex));

			// Show instruments
			if (channel.instruments.length > 0) {
				const compactInstrumentLabels = channel.instruments.length > 1;
				const instrDiv = div({
					class: "cvvInstrumentList",
					style: "display: flex; flex-wrap: nowrap; gap: 3px; margin-top: 3px; justify-content: center; min-width: 0; overflow: hidden;",
				});

				// Get instruments in current pattern for highlighting
				const pattern = hasPattern ? song.getPattern(i, currentBar) : null;
				const patternInstruments = pattern ? pattern.instruments : [];

				// Count duplicate type names to append disambiguation suffixes
				const typeCounts: Map<string, number> = new Map();
				for (let j = 0; j < channel.instruments.length; j++) {
					const instrument = channel.instruments[j];
					const typeName = instrument ? getInstrumentDisplayName(instrument) : "?";
					typeCounts.set(typeName, (typeCounts.get(typeName) || 0) + 1);
				}

				const currentCounts: Map<string, number> = new Map();
				for (let j = 0; j < channel.instruments.length; j++) {
					const inPattern = patternInstruments.includes(j);
					const instrState = channelState ? channelState.instruments[j] : null;
					const isPlaying = instrState
						? instrState.activeTones.count() > 0 ||
							instrState.liveInputTones.count() > 0
						: false;
					const instrument = channel.instruments[j];
					const typeName = instrument ? getInstrumentDisplayName(instrument) : "?";
					const total = typeCounts.get(typeName) || 1;
					const nth = (currentCounts.get(typeName) || 0) + 1;
					currentCounts.set(typeName, nth);
					const instrName = total > 1 ? `${typeName} ${nth}` : typeName;
					const instrSpan = span(
						{
							title: instrName,
							style: `flex: ${compactInstrumentLabels ? "1 1 0" : "0 1 auto"}; font-size: 9px; font-weight: 600; padding: 1px 3px; border-radius: var(--border-radius-medium); max-width: 100%; min-width: 0; overflow: hidden; text-align: center; text-overflow: ellipsis; white-space: nowrap; background: ${
								isPlaying
									? "white"
									: inPattern
										? channelColors.primaryChannel
										: "var(--ui-widget-background)"
							}; color: ${isPlaying ? "black" : inPattern ? "var(--editor-background)" : channelColors.primaryChannel}; opacity: ${
								inPattern || isPlaying ? "1" : "0.5"
							};`,
						},
						compactInstrumentLabels ? String(j + 1) : instrName,
					);
					const instrKey = `${i}-${j}`;
					this._instrumentSpans.set(instrKey, instrSpan);
					this._instrumentIndex.set(instrKey, j);
					let entries = this._instrumentEntriesByChannel.get(i);
					if (!entries) {
						entries = [];
						this._instrumentEntriesByChannel.set(i, entries);
					}
					entries.push({ key: instrKey, index: j, span: instrSpan });
					instrDiv.appendChild(instrSpan);
				}
				contentWrap.appendChild(instrDiv);
			}

			this._contentContainer.appendChild(channelDiv);
		}

		// Observe the grid container so per-channel canvas backing-store sizes are
		// refreshed on layout changes without any per-frame clientWidth reads.
		this._setupResizeObserver();
	};

	private _setupResizeObserver(): void {
		if (this._resizeObserver != null) {
			this._resizeObserver.disconnect();
			this._resizeObserver = null;
		}
		if (!this._paneActive || this._disposed) return;
		const dpr = window.devicePixelRatio || 1;
		const measure = (): void => {
			if (this._disposed || !this._paneActive) return;
			for (const [channelIndex, cvs] of this._channelSpectrumCanvases) {
				const parent = cvs.parentElement;
				if (parent) {
					this._canvasSizes.set(channelIndex, {
						w: Math.round(parent.clientWidth * dpr),
						h: Math.round(parent.clientHeight * dpr),
					});
				}
			}
		};
		const observer = new ResizeObserver((): void => {
			measure();
		});
		observer.observe(this._contentContainer);
		this._resizeObserver = observer;
		// ResizeObserver fires once asynchronously on observe; also measure now in
		// case layout is already settled.
		measure();
	}
}
