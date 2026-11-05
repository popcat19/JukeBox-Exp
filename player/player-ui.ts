// Player UI
//
// Purpose: Constructs all DOM elements and injects CSS styles for the song player
//
// This module:
// - Injects global CSS styles for player controls
// - Creates and assembles all DOM elements (buttons, sliders, timeline, volume bar)
// - Provides localStorage helpers with cross-origin iframe safety

import { HTML, SVG } from "imperative-html/dist/esm/elements-strict";
import { ColorConfig } from "../shared/color-config";
import { events } from "../shared/events";
import { isPlayerThemeSyncMessage } from "../shared/player-theme-sync";
import { spectrumCanvas } from "../shared/spectrum";
import { buildDesignTokensCSS } from "../shared/styles/design-tokens";
import { injectGlobalStyles } from "../shared/styles/inject";
import type { TimelineSurface } from "../shared/timeline-surface";
import { Synth } from "../synth";

const { a, button, div, h1, input, canvas } = HTML;
const { svg, circle, path } = SVG;

let playerInstanceCount: number = 0;

export const isMobile: boolean =
	/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|android|ipad|playbook|silk/i.test(
		navigator.userAgent,
	);

export function getLocalStorage(key: string): string | null {
	try {
		return localStorage.getItem(key);
	} catch {
		// localStorage may throw in private browsing or when storage is full;
		// callers treat null as "no saved value" so suppression is intentional.
		return null;
	}
}

export function setLocalStorage(key: string, value: string): void {
	try {
		localStorage.setItem(key, value);
	} catch {
		// localStorage may throw in private browsing or when quota is exceeded;
		// writing the value is best-effort, so suppression is intentional.
	}
}

export interface PlayerUI extends TimelineSurface {
	spectrum: spectrumCanvas;
	titleText: HTMLHeadingElement;
	editLink: HTMLAnchorElement;
	copyLink: HTMLAnchorElement;
	shareLink: HTMLAnchorElement;
	fullscreenLink: HTMLAnchorElement;
	playButton: HTMLButtonElement;
	loopIcon: SVGPathElement;
	loopButton: HTMLButtonElement;
	volumeSlider: HTMLInputElement;
	zoomIcon: SVGSVGElement;
	zoomButton: HTMLButtonElement;
	outVolumeBar: SVGRectElement;
	outVolumeCap: SVGRectElement;
	sampleLoadingBar: HTMLDivElement;
	sampleLoadingBarContainer: HTMLDivElement;
	root: HTMLDivElement;
}

export function buildPlayerCSS(): string {
	return `
	:root {
		${buildDesignTokensCSS("'B612', sans-serif", "monospace")}
	}

	.pm-player {
		color: var(--primary-text, white);
		background: var(--editor-background, black);
	}
	.pm-player h1 {
		font-weight: bold;
		font-size: 14px;
		line-height: 22px;
		text-align: initial;
		margin: 0;
	}
	.pm-player a {
		font-weight: bold;
		font-size: 12px;
		line-height: 22px;
		white-space: nowrap;
		color: var(--link-accent, #98f);
	}
	.pm-player button {
		margin: 0;
		padding: 0;
		position: relative;
		border: none;
		border-radius: 5px;
		background: var(--ui-widget-background, #444);
		color: var(--primary-text, white);
		cursor: pointer;
		font-size: 14px;
		font-family: inherit;
	}
	.pm-player button:hover, .pm-player button:focus {
		background: var(--ui-widget-focus, #777);
	}
	.pm-player .playButton, .pm-player .pauseButton {
		padding-left: 24px;
		padding-right: 6px;
	}
	.pm-player .playButton::before {
		content: "";
		position: absolute;
		left: 6px;
		top: 50%;
		margin-top: -6px;
		width: 12px;
		height: 12px;
		pointer-events: none;
		background: var(--primary-text, white);
		-webkit-mask-image: url("data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2224%22 height=%2224%22 viewBox=%220 0 24 24%22 fill=%22currentColor%22 > <path stroke=%22none%22 d=%22M0 0h24v24H0z%22 fill=%22none%22 /> <path d=%22M6 4v16a1 1 0 0 0 1.524 .852l13 -8a1 1 0 0 0 0 -1.704l-13 -8a1 1 0 0 0 -1.524 .852z%22 /> </svg>");
		-webkit-mask-repeat: no-repeat;
		-webkit-mask-position: center;
		-webkit-mask-size: 12px 12px;
		mask-image: url("data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2224%22 height=%2224%22 viewBox=%220 0 24 24%22 fill=%22currentColor%22 > <path stroke=%22none%22 d=%22M0 0h24v24H0z%22 fill=%22none%22 /> <path d=%22M6 4v16a1 1 0 0 0 1.524 .852l13 -8a1 1 0 0 0 0 -1.704l-13 -8a1 1 0 0 0 -1.524 .852z%22 /> </svg>");
		mask-repeat: no-repeat;
		mask-position: center;
		mask-size: 12px 12px;
	}
	.pm-player .pauseButton::before {
		content: "";
		position: absolute;
		left: 6px;
		top: 50%;
		margin-top: -6px;
		width: 12px;
		height: 12px;
		pointer-events: none;
		background: var(--primary-text, white);
		-webkit-mask-image: url("data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2224%22 height=%2224%22 viewBox=%220 0 24 24%22 fill=%22currentColor%22 > <path stroke=%22none%22 d=%22M0 0h24v24H0z%22 fill=%22none%22 /> <path d=%22M9 4h-2a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h2a2 2 0 0 0 2 -2v-12a2 2 0 0 0 -2 -2z%22 /> <path d=%22M17 4h-2a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h2a2 2 0 0 0 2 -2v-12a2 2 0 0 0 -2 -2z%22 /> </svg>");
		-webkit-mask-repeat: no-repeat;
		-webkit-mask-position: center;
		-webkit-mask-size: 12px 12px;
		mask-image: url("data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2224%22 height=%2224%22 viewBox=%220 0 24 24%22 fill=%22currentColor%22 > <path stroke=%22none%22 d=%22M0 0h24v24H0z%22 fill=%22none%22 /> <path d=%22M9 4h-2a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h2a2 2 0 0 0 2 -2v-12a2 2 0 0 0 -2 -2z%22 /> <path d=%22M17 4h-2a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h2a2 2 0 0 0 2 -2v-12a2 2 0 0 0 -2 -2z%22 /> </svg>");
		mask-repeat: no-repeat;
		mask-position: center;
		mask-size: 12px 12px;
	}

	.pm-player input[type=range] {
		-webkit-appearance: none;
		appearance: none;
		height: 16px;
		margin: 0;
		cursor: pointer;
		background-color: var(--editor-background, black);
		touch-action: pan-y;
	}
	.pm-player input[type=range]:focus {
		outline: none;
	}
	.pm-player input[type=range]::-webkit-slider-runnable-track {
		width: 100%;
		height: 4px;
		cursor: pointer;
		background: var(--ui-widget-background, #444);
	}
	.pm-player input[type=range]::-webkit-slider-thumb {
		height: 16px;
		width: 4px;
		border-radius: 2px;
		background: var(--primary-text, white);
		cursor: pointer;
		-webkit-appearance: none;
		margin-top: -6px;
	}
	.pm-player input[type=range]:focus::-webkit-slider-runnable-track, .pm-player input[type=range]:hover::-webkit-slider-runnable-track {
		background: var(--ui-widget-focus, #777);
	}
	.pm-player input[type=range]::-moz-range-track {
		width: 100%;
		height: 4px;
		cursor: pointer;
		background: var(--ui-widget-background, #444);
	}
	.pm-player input[type=range]:focus::-moz-range-track, .pm-player input[type=range]:hover::-moz-range-track  {
		background: var(--ui-widget-focus, #777);
	}
	.pm-player input[type=range]::-moz-range-thumb {
		height: 16px;
		width: 4px;
		border-radius: 2px;
		border: none;
		background: var(--primary-text, white);
		cursor: pointer;
	}
	.pm-player input[type=range]::-ms-track {
		width: 100%;
		height: 4px;
		cursor: pointer;
		background: var(--ui-widget-background, #444);
		border-color: transparent;
	}
	.pm-player input[type=range]:focus::-ms-track, .pm-player input[type=range]:hover::-ms-track {
		background: var(--ui-widget-focus, #777);
	}
	.pm-player input[type=range]::-ms-thumb {
		height: 16px;
		width: 4px;
		border-radius: 2px;
		background: var(--primary-text, white);
		cursor: pointer;
	}

	/* --- scoped player UI classes --- */

	.pm-player .pm-player-spectrum {
		border: 2px solid var(--ui-widget-background, #444);
		overflow: hidden;
	}
	.pm-player .pm-player-title {
		flex-grow: 1;
		margin: 0 1px;
		margin-left: 10px;
		overflow: hidden;
	}
	.pm-player .pm-player-link {
		margin: 0 4px;
	}
	.pm-player .pm-player-play-btn {
		width: 100%;
		height: 100%;
		max-height: 50px;
	}
	.pm-player .pm-player-btn-container {
		flex-shrink: 0;
		display: flex;
		padding: 2px;
		width: 80px;
		height: 100%;
		box-sizing: border-box;
		align-items: center;
	}
	.pm-player .pm-player-icon-btn {
		background: none;
		flex: 0 0 12px;
		margin: 0 3px;
		width: 12px;
		height: 12px;
		display: flex;
	}
	.pm-player .pm-player-icon-btn:hover, .pm-player .pm-player-icon-btn:focus {
		background: none;
	}
	.pm-player .pm-player-vol-icon {
		flex: 0 0 12px;
		margin: 0 1px;
		width: 12px;
		height: 12px;
	}
	.pm-player .pm-player-vol-slider {
		width: 12vw;
		max-width: 100px;
	}
	.pm-player input.pm-player-vol-slider {
		margin: 0 1px;
	}
	.pm-player .pm-player-timeline {
		min-width: 0;
		min-height: 0;
		touch-action: pan-y pinch-zoom;
	}
	.pm-player .pm-player-playhead {
		position: absolute;
		left: 0;
		top: 0;
		width: 2px;
		height: 100%;
		background: var(--playhead, white);
		pointer-events: none;
	}
	.pm-player .pm-player-timeline-container {
		display: flex;
		flex-grow: 1;
		flex-shrink: 1;
		position: relative;
	}
	.pm-player .pm-player-viz-container {
		display: flex;
		flex-grow: 1;
		flex-shrink: 1;
		height: 0;
		position: relative;
		align-items: center;
		overflow: hidden;
	}
	.pm-player .pm-player-volbar-svg {
		touch-action: none;
		overflow: hidden;
		margin: auto;
	}
	.pm-player .pm-player-sample-bar {
		height: 100%;
		background-color: var(--indicator-primary, #74f);
	}
	.pm-player .pm-player-sample-bar-container {
		overflow: hidden;
		margin: auto;
		width: 90%;
		height: 50%;
	}
	.pm-player .pm-player-vol-bar-wrapper {
		display: flex;
		flex-direction: column;
		touch-action: none;
		overflow: hidden;
		margin: auto;
	}
	.pm-player .pm-player-control-bar {
		flex-shrink: 0;
		height: 20vh;
		min-height: 22px;
		max-height: 70px;
		display: flex;
		align-items: center;
	}
	.pm-player .pm-player-sample-status-row {
		overflow: hidden;
		margin: auto;
		width: 160px;
		height: 10px;
	}
`;
}

export function injectPlayerStyles(): void {
	injectGlobalStyles(document, "player-main", buildPlayerCSS());
}

export function applyPlayerThemeSyncMessage(value: unknown): boolean {
	if (!isPlayerThemeSyncMessage(value)) return false;
	if (value.theme === ColorConfig.PMD_THEME) {
		ColorConfig.setPMDState(
			value.pmdControlHue,
			value.pmdEffectiveHue,
			false,
			ColorConfig.PMD_THEME,
		);
	} else {
		ColorConfig.setTheme(value.theme);
	}
	return true;
}

export function bindParentThemeSync(ownerWindow: Window = window): () => void {
	if (ownerWindow.parent === ownerWindow) return () => undefined;
	const onMessage = (event: MessageEvent): void => {
		if (event.source !== ownerWindow.parent || event.origin !== ownerWindow.location.origin)
			return;
		applyPlayerThemeSyncMessage(event.data);
	};
	ownerWindow.addEventListener("message", onMessage);
	return () => {
		ownerWindow.removeEventListener("message", onMessage);
	};
}

export function buildPlayerUI(): PlayerUI {
	const colorTheme: string | null = getLocalStorage("colorTheme");
	ColorConfig.setTheme(colorTheme === null ? ColorConfig.defaultTheme : colorTheme);

	const synth: Synth = new Synth();
	synth.onSpectrumUpdate = (l, r) => {
		events.raise("spectrumUpdate", l, r);
	};
	const spectrum: spectrumCanvas = new spectrumCanvas(
		canvas({
			width: isMobile ? 144 : 288,
			height: isMobile ? 32 : 64,
			class: "pm-player-spectrum",
		}),
		isMobile ? 1 : 2,
	);
	const showSpectrum: boolean = getLocalStorage("showSpectrum") !== "false";
	if (!showSpectrum) {
		spectrum.canvas.style.display = "none";
		synth.spectrumEnabled = false;
	}
	const titleText: HTMLHeadingElement = h1({ class: "pm-player-title" }, "");
	const editLink: HTMLAnchorElement = a({ target: "_top", class: "pm-player-link" }, "Edit");
	const copyLink: HTMLAnchorElement = a({ href: "#", class: "pm-player-link" }, "Copy URL");
	const shareLink: HTMLAnchorElement = a({ href: "#", class: "pm-player-link" }, "Share");
	const fullscreenLink: HTMLAnchorElement = a(
		{ target: "_top", class: "pm-player-link" },
		"Fullscreen",
	);

	const playButton: HTMLButtonElement = button({
		class: "pm-player-play-btn",
	});
	const playButtonContainer: HTMLDivElement = div(
		{ class: "pm-player-btn-container" },
		playButton,
	);
	const loopIcon: SVGPathElement = path({
		d: "M4 12v-3a3 3 0 0 1 3 -3h13m-3 -3l3 3l-3 3 M20 12v3a3 3 0 0 1 -3 3h-13m3 3l-3 -3l3 -3",
		stroke: "currentColor",
		"stroke-width": "2",
		"stroke-linecap": "round",
		"stroke-linejoin": "round",
		fill: "none",
	});
	const loopButton: HTMLButtonElement = button(
		{
			title: "loop",
			class: "pm-player-icon-btn",
		},
		svg({ width: 12, height: 12, viewBox: "0 0 24 24" }, loopIcon),
	);

	const volumeIcon: SVGSVGElement = svg(
		{
			class: "pm-player-vol-icon",
			viewBox: "0 0 24 24",
		},
		path({
			d: "M15 8a5 5 0 0 1 0 8 M17.7 5a9 9 0 0 1 0 14 M6 15h-2a1 1 0 0 1 -1 -1v-4a1 1 0 0 1 1 -1h2l3.5 -4.5a.8 .8 0 0 1 1.5 .5v14a.8 .8 0 0 1 -1.5 .5l-3.5 -4.5",
			stroke: "currentColor",
			"stroke-width": "2",
			"stroke-linecap": "round",
			"stroke-linejoin": "round",
			fill: "none",
		}),
	);
	const volumeSlider: HTMLInputElement = input({
		title: "volume",
		type: "range",
		value: 75,
		min: 0,
		max: 75,
		step: 1,
		class: "pm-player-vol-slider",
	});

	const zoomIcon: SVGSVGElement = svg(
		{ width: 12, height: 12, viewBox: "0 0 24 24" },
		circle({
			cx: "10",
			cy: "10",
			r: "7",
			"stroke-width": "2",
			stroke: "currentColor",
			fill: "none",
		}),
		path({
			stroke: "currentColor",
			"stroke-width": "2",
			"stroke-linecap": "round",
			d: "M 15 15 L 21 21 M 7 10 L 13 10 M 10 7 L 10 13",
			fill: "none",
		}),
	);
	const zoomButton: HTMLButtonElement = button(
		{
			title: "zoom",
			class: "pm-player-icon-btn",
		},
		zoomIcon,
	);

	const timeline: SVGSVGElement = svg({
		class: "pm-player-timeline",
	});
	const playhead: HTMLDivElement = div({
		class: "pm-player-playhead",
	});
	const timelineContainer: HTMLDivElement = div(
		{ class: "pm-player-timeline-container" },
		timeline,
		playhead,
	);
	const visualizationContainer: HTMLDivElement = div(
		{ class: "pm-player-viz-container" },
		timelineContainer,
	);

	const outVolumeBarBg: SVGRectElement = SVG.rect({
		"pointer-events": "none",
		width: "90%",
		height: "50%",
		x: "5%",
		y: "25%",
		fill: "var(--ui-widget-background, #444)",
	});
	const volumeGradId: string = `volumeGrad2-${playerInstanceCount++}`;
	const outVolumeBar: SVGRectElement = SVG.rect({
		"pointer-events": "none",
		height: "50%",
		width: "0%",
		x: "5%",
		y: "25%",
		fill: `url('#${volumeGradId}')`,
	});
	const outVolumeCap: SVGRectElement = SVG.rect({
		"pointer-events": "none",
		width: "2px",
		height: "50%",
		x: "5%",
		y: "25%",
		fill: "var(--ui-widget-focus, #777)",
	});
	const stop1: SVGStopElement = SVG.stop({ "stop-color": "lime", offset: "60%" });
	const stop2: SVGStopElement = SVG.stop({ "stop-color": "orange", offset: "90%" });
	const stop3: SVGStopElement = SVG.stop({ "stop-color": "red", offset: "100%" });
	const gradient: SVGGradientElement = SVG.linearGradient(
		{ id: volumeGradId, gradientUnits: "userSpaceOnUse" },
		stop1,
		stop2,
		stop3,
	);
	const defs: SVGDefsElement = SVG.defs({}, gradient);
	const volumeBarContainer: SVGSVGElement = SVG.svg(
		{
			class: "pm-player-volbar-svg",
			width: "160px",
			height: "10px",
			preserveAspectRatio: "none",
		},
		defs,
		outVolumeBarBg,
		outVolumeBar,
		outVolumeCap,
	);
	const sampleLoadingBar: HTMLDivElement = div({
		style: "width: 0%;",
		class: "pm-player-sample-bar",
	});
	const sampleLoadingBarContainer: HTMLDivElement = div(
		{
			class: "pm-player-sample-bar-container",
			style: "background-color: var(--empty-sample-bar, var(--indicator-secondary, #444));",
			preserveAspectRatio: "none",
		},
		sampleLoadingBar,
	);
	const sampleLoadingStatusContainer: HTMLDivElement = div(
		{},
		div(
			{
				class: "pm-player-sample-status-row",
			},
			sampleLoadingBarContainer,
		),
	);
	const volumeBarContainerDiv: HTMLDivElement = div(
		{
			class: "pm-player-vol-bar-wrapper",
		},
		volumeBarContainer,
		sampleLoadingStatusContainer,
	);
	const controlBar: HTMLDivElement = div(
		{ class: "pm-player-control-bar" },
		playButtonContainer,
		loopButton,
		volumeIcon,
		volumeSlider,
		zoomButton,
		volumeBarContainerDiv,
		spectrum.canvas, // make it auto remove itself later
		titleText,
		editLink,
		copyLink,
		shareLink,
		fullscreenLink,
	);
	const root: HTMLDivElement = div({ class: "pm-player" }, visualizationContainer, controlBar);
	document.body.appendChild(root);

	return {
		root,
		synth,
		spectrum,
		titleText,
		editLink,
		copyLink,
		shareLink,
		fullscreenLink,
		playButton,
		loopIcon,
		loopButton,
		volumeSlider,
		zoomIcon,
		zoomButton,
		timeline,
		playhead,
		timelineContainer,
		visualizationContainer,
		outVolumeBar,
		outVolumeCap,
		sampleLoadingBar,
		sampleLoadingBarContainer,
	};
}
