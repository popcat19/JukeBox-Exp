// Base Widgets
//
// Purpose: CSS for editor base widget controls — layout-option, select,
// button (generic + specific icon types), playback bar controls, and
// cancel/shade/popout/okay/export button pseudo-elements.
//
// Extracted from style.ts. Uses ColorConfig, Typography.

import { ColorConfig } from "../../../shared/color-config";
import { Typography } from "../../ui/style-constants";

export function buildBaseWidgetsCSS(): string {
	return `\
.beepboxEditor .layout-option {
	display: flex;
	flex-direction: column;
	cursor: pointer;
	color: ${ColorConfig.secondaryText};
	width: 25%;
}

.beepboxEditor .layout-option input {
	display: none;
}

.beepboxEditor .layout-option input:checked ~ * {
	color: ${ColorConfig.primaryText};
}
.beepboxEditor select.invalidSetting {
	border: solid 1px red;
}
.beepboxEditor .selectContainer {
	position: relative;
}
.beepboxEditor .selectRow > .selectContainer.select-container-narrow {
	width: 61.5%;
}
/* PMD: removed the up/down triangle from .selectContainer. The
 * dropdown's interactivity is already signalled by the focus
 * ring on .focused / :hover (80x body tier), the cursor
 * change, and the menu bar's existing single down-arrow on
 * .selectContainer.menu — adding a glyph on the body of the
 * select duplicates that affordance. */
.beepboxEditor .selectContainer.menu::after {
	content: "";
	flex-shrink: 0;
	position: absolute;
	right: 0;
	top: 50%;
	transform: translateY(-50%);
	pointer-events: none;
	width: var(--button-size);
	height: var(--button-size);
	background: currentColor;
	-webkit-mask-image: var(--internal-menu-down-symbol);
	-webkit-mask-size: 12px;
	-webkit-mask-repeat: no-repeat;
	-webkit-mask-position: center;
	mask-image: var(--internal-menu-down-symbol);
	mask-size: 12px;
	mask-repeat: no-repeat;
	mask-position: center;
}
.beepboxEditor select {
	margin: 0;
	padding: 0 var(--padding-6);
	display: block;
	height: var(--button-size);
	border: none;
	border-radius: var(--border-radius-medium);
	background: ${ColorConfig.uiWidgetBackground};
	color: inherit;
	font-size: inherit;
	cursor: pointer;
	font-family: inherit;
	font-weight: inherit;
	box-sizing: border-box;

	-webkit-appearance:none;
	-moz-appearance: none;
	appearance: none;
}
.beepboxEditor select option:disabled {
	color: ${ColorConfig.linkAccent};
	font-weight: ${Typography.weightSemibold};
}
.beepboxEditor select option.mod-invalid-option {
	color: red;
}

/* PMD: disabled is a surface replacement, not a fade. The previous
 * opacity-only rule dimmed the whole control, which dropped text below
 * 4.5:1 and left hover affordances reading as operable. Inputs take a 4x
 * backing with base03 foreground and a solid 2px inset boundary; buttons
 * take the same backing and boundary. */
.beepboxEditor [disabled] {
	opacity: 1;
	cursor: not-allowed;
}

.beepboxEditor input[disabled],
.beepboxEditor select[disabled],
.beepboxEditor textarea[disabled] {
	background: var(--editor-background, black);
	color: var(--base03-muted, #999);
	outline: 2px solid var(--base03-muted, #999);
	outline-offset: -2px;
}

.beepboxEditor button[disabled] {
	background: var(--editor-background, black);
	color: var(--base03-muted, #999);
	outline: 2px solid var(--base03-muted, #999);
	outline-offset: -2px;
	border: 0;
}

/* A previously active control replaces its active fill with base03 and
 * takes floor-coloured text, so it cannot be mistaken for an enabled
 * selection. */
.beepboxEditor button[disabled].active,
.beepboxEditor button[disabled][aria-pressed="true"] {
	background: var(--base03-muted, #999);
	color: var(--editor-background, black);
	outline: none;
}

/* Suppress operable-looking hover on disabled controls. */
.beepboxEditor button[disabled]:hover,
.beepboxEditor input[disabled]:hover,
.beepboxEditor select[disabled]:hover {
	outline-color: var(--base03-muted, #999);
}

/* ── Preset button (replaces select2 dropdown) ── */
.beepboxEditor .presetButton {
	margin: 0;
	padding: 0 var(--padding-6);
	display: block;
	height: var(--button-size);
	border: 2px solid transparent;
	border-radius: var(--border-radius-medium);
	background: ${ColorConfig.uiWidgetBackground};
	color: inherit;
	font-size: inherit;
	cursor: pointer;
	font-family: inherit;
	font-weight: inherit;
	box-sizing: border-box;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	text-align: left;
	width: 100%;
}
.beepboxEditor .presetButton:hover {
	border-color: var(--hout, var(--primary-text));
	box-shadow: none;
}
.beepboxEditor .presetButton:active {
	border-color: var(--indicator-primary, #4444ff);
	box-shadow: none;
}

.beepboxEditor .menu select {
	padding: 0 var(--button-size);
}
.beepboxEditor select:hover {
	box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--indicator-primary, #4444ff), transparent 50%);
	outline: none;
}

.beepboxEditor select:active {
	box-shadow: inset 0 0 0 2px var(--indicator-primary, #4444ff);
}

.beepboxEditor select:focus {
	outline: none;
}
.beepboxEditor .menu select {
	text-align: center;
	text-align-last: center;
}
.beepboxEditor .settings-area select {
       width: 100%;
}

/* This may render better in Firefox. Untested on other platforms.
@-moz-document url-prefix() {
	.beepboxEditor select { padding: 0 2px; }
}
*/
.beepboxEditor button {
	margin: 0;
	position: relative;
	height: var(--button-size);
	border: none;
	border-radius: var(--border-radius-medium);
	background: ${ColorConfig.uiWidgetBackground};
	color: inherit;
	font-size: inherit;
	font-family: inherit;
	font-weight: inherit;
	cursor: pointer;
}
.beepboxEditor button:hover {
	/* PMD: hover uses 80x (body tier). Visible but not competing
	 * with 88x headings. The hover shadow is suppressed only when
	 * the button is focused AND not currently hovered, so a
	 * post-click idle state returns to resting but mousing over a
	 * focused button still shows the hover indicator. */
	box-shadow: inset 0 0 0 2px var(--primary-text);
}

.beepboxEditor button:active {
	/* PMD: click uses 88x (heading tier) for transient emphasis
	 * while the button is held. Goes away on release. */
	box-shadow: inset 0 0 0 2px var(--prompt-titlebar-text, var(--primary-text));
}

.beepboxEditor button:focus:not(:hover) {
	/* Buttons don't keep a focus ring after click — but only when
	 * the mouse has actually left. If the cursor is still over the
	 * button, :hover above should win. Inputs are the exception. */
	outline: none;
	box-shadow: none;
}

.beepboxEditor button.cancelButton {
	width: var(--button-size);
}

.beepboxEditor button.shadeButton {
	width: var(--button-size);
}

.beepboxEditor button.shadeButton::before {
	content: "";
	position: absolute;
	width: var(--button-size);
	height: var(--button-size);
	left: 0;
	top: 0;
	pointer-events: none;
	background: currentColor;
	mask-image: var(--internal-minimize-symbol);
	mask-size: 16px;
	mask-repeat: no-repeat;
	mask-position: center;
	-webkit-mask-image: var(--internal-minimize-symbol);
	-webkit-mask-size: 16px;
	-webkit-mask-repeat: no-repeat;
	-webkit-mask-position: center;
}

.beepboxEditor button.popoutButton {
	width: var(--button-size);
}

.beepboxEditor button.popoutButton::before {
	content: "";
	position: absolute;
	width: var(--button-size);
	height: var(--button-size);
	left: 0;
	top: 0;
	pointer-events: none;
	background: currentColor;
	mask-image: var(--internal-popout-symbol);
	mask-size: 16px;
	mask-repeat: no-repeat;
	mask-position: center;
	-webkit-mask-image: var(--internal-popout-symbol);
	-webkit-mask-size: 16px;
	-webkit-mask-repeat: no-repeat;
	-webkit-mask-position: center;
}

/* PMD: popped-out prompts (data-popout="true", set by PromptPopout) live in a
 * separate OS window. There is no editor content behind them to raise above,
 * so the hover/focus outline is visual noise; and the shade + popout titlebar
 * buttons have no useful action in a window that already has its own OS
 * chrome. Hide all three for a clean window-filling panel. */
/* Loop button in mute editor: centered at bottom, matching loop bar height */
.beepboxEditor .cvv-loop-btn {
	border-radius: 50% !important;
	height: 20px;
	width: 20px;
	margin: 4px 0;
	align-self: center;
	position: sticky;
	bottom: 0;
}

.beepboxEditor .playback-bar-controls {
	display: grid;
	grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr);
	grid-template-rows: min-content;
	grid-column-gap: 4px;
}

.beepboxEditor .playback-volume-slider {
	flex-grow: 1;
}

.beepboxEditor .playback-volume-container {
	display: flex;
	flex-grow: 1;
}

.beepboxEditor button.playButton::before {
	content: "";
	flex-shrink: 0;
	position: absolute;
	left: 0;
	top: 50%;
	transform: translateY(-50%);
	pointer-events: none;
	width: var(--button-size);
	height: var(--button-size);
	background: currentColor;
	-webkit-mask-image: var(--internal-play-symbol);
	-webkit-mask-size: 16px;
	-webkit-mask-repeat: no-repeat;
	-webkit-mask-position: center;
	mask-image: var(--internal-play-symbol);
	mask-size: 16px;
	mask-repeat: no-repeat;
	mask-position: center;
}
.beepboxEditor button.pauseButton::before {
	content: "";
	flex-shrink: 0;
	position: absolute;
	left: 0;
	top: 50%;
	transform: translateY(-50%);
	pointer-events: none;
	width: var(--button-size);
	height: var(--button-size);
	background: currentColor;
	-webkit-mask-image: var(--internal-pause-symbol);
	-webkit-mask-size: 16px;
	-webkit-mask-repeat: no-repeat;
	-webkit-mask-position: center;
	mask-image: var(--internal-pause-symbol);
	mask-size: 16px;
	mask-repeat: no-repeat;
	mask-position: center;
}
.beepboxEditor button.recordButton::before {
	content: "";
	flex-shrink: 0;
	position: absolute;
	left: 0;
	top: 50%;
	transform: translateY(-50%);
	pointer-events: none;
	width: var(--button-size);
	height: var(--button-size);
	background: currentColor;
	-webkit-mask-image: var(--internal-record-symbol);
	-webkit-mask-size: 16px;
	-webkit-mask-repeat: no-repeat;
	-webkit-mask-position: center;
	mask-image: var(--internal-record-symbol);
	mask-size: 16px;
	mask-repeat: no-repeat;
	mask-position: center;
}
.beepboxEditor button.stopButton::before {
	content: "";
	flex-shrink: 0;
	position: absolute;
	left: 0;
	top: 50%;
	transform: translateY(-50%);
	pointer-events: none;
	width: var(--button-size);
	height: var(--button-size);
	background: currentColor;
	-webkit-mask-image: var(--internal-stop-symbol);
	-webkit-mask-size: 16px;
	-webkit-mask-repeat: no-repeat;
	-webkit-mask-position: center;
	mask-image: var(--internal-stop-symbol);
	mask-size: 16px;
	mask-repeat: no-repeat;
	mask-position: center;
}

.beepboxEditor button.prevBarButton::before {
	content: "";
	flex-shrink: 0;
	position: absolute;
	left: 50%;
	top: 50%;
	transform: translate(-50%, -50%);
	pointer-events: none;
	width: var(--button-size);
	height: var(--button-size);
	background: currentColor;
	-webkit-mask-image: var(--internal-prev-bar-symbol);
	-webkit-mask-size: 16px;
	-webkit-mask-repeat: no-repeat;
	-webkit-mask-position: center;
	mask-image: var(--internal-prev-bar-symbol);
	mask-size: 16px;
	mask-repeat: no-repeat;
	mask-position: center;
}

.beepboxEditor button.nextBarButton::before {
	content: "";
	flex-shrink: 0;
	position: absolute;
	left: 50%;
	top: 50%;
	transform: translate(-50%, -50%);
	pointer-events: none;
	width: var(--button-size);
	height: var(--button-size);
	background: currentColor;
	-webkit-mask-image: var(--internal-next-bar-symbol);
	-webkit-mask-size: 16px;
	-webkit-mask-repeat: no-repeat;
	-webkit-mask-position: center;
	mask-image: var(--internal-next-bar-symbol);
	mask-size: 16px;
	mask-repeat: no-repeat;
	mask-position: center;
}

.beepboxEditor button.playButton, .beepboxEditor button.pauseButton, .beepboxEditor button.recordButton, .beepboxEditor button.stopButton {
	padding-left: var(--button-size);
}
.beepboxEditor button.okayButton, .beepboxEditor button.exportButton,
.beepboxEditor button.copyButton, .beepboxEditor button.pasteButton, .beepboxEditor button.exportInstrumentButton, .beepboxEditor button.importInstrumentButton {
	display: flex;
	flex-direction: row;
	align-items: center;
	gap: 4px;
	padding-left: 4px;
}
.beepboxEditor button.playButton, .beepboxEditor button.pauseButton, .beepboxEditor button.recordButton {
	grid-column-start: 1;
	grid-column-end: 3;
}
.beepboxEditor button.stopButton {
	grid-column-start: 1;
	grid-column-end: 5;
}
.beepboxEditor button.prevBarButton {
	grid-column-start: 3;
	grid-column-end: 4;
}
.beepboxEditor button.nextBarButton {
	grid-column-start: 4;
	grid-column-end: 5;
}

.beepboxEditor button.playButton.shrunk, .beepboxEditor button.pauseButton.shrunk, .beepboxEditor button.recordButton.shrunk, .beepboxEditor button.stopButton.shrunk {
	padding: 0;
}
.beepboxEditor button.playButton.shrunk::before, .beepboxEditor button.pauseButton.shrunk::before, .beepboxEditor button.recordButton.shrunk::before, .beepboxEditor button.stopButton.shrunk::before {
	left: 50%;
	top: 50%;
	transform: translate(-50%, -50%);
}
.beepboxEditor button.playButton.shrunk span, .beepboxEditor button.pauseButton.shrunk span, .beepboxEditor button.recordButton.shrunk span, .beepboxEditor button.stopButton.shrunk span {
	display: none;
}
.beepboxEditor button.playButton.shrunk, .beepboxEditor button.pauseButton.shrunk {
	grid-column-start: 1;
	grid-column-end: 2;
}
.beepboxEditor button.recordButton.shrunk {
	grid-column-start: 2;
	grid-column-end: 3;
}
.beepboxEditor button.stopButton.shrunk {
	grid-column-start: 2;
	grid-column-end: 3;
}

.beepboxEditor button.cancelButton::before {
	content: "";
	position: absolute;
	width: var(--button-size);
	height: var(--button-size);
	left: 0;
	top: 0;
	pointer-events: none;
	background: currentColor;
	mask-image: var(--internal-close-symbol);
	mask-size: 16px;
	mask-repeat: no-repeat;
	mask-position: center;
	-webkit-mask-image: var(--internal-close-symbol);
	-webkit-mask-size: 16px;
	-webkit-mask-repeat: no-repeat;
	-webkit-mask-position: center;
}

.beepboxEditor button.okayButton::before {
	content: "";
	position: absolute;
	width: var(--button-size);
	height: var(--button-size);
	left: 0;
	top: 0;
	pointer-events: none;
	background: currentColor;
	-webkit-mask-image: var(--internal-checkmark-symbol);
	-webkit-mask-size: 16px;
	-webkit-mask-repeat: no-repeat;
	-webkit-mask-position: center;
	mask-image: var(--internal-checkmark-symbol);
	mask-size: 16px;
	mask-repeat: no-repeat;
	mask-position: center;
}

.beepboxEditor button.exportButton::before {
	content: "";
	position: absolute;
	width: var(--button-size);
	height: var(--button-size);
	left: 0;
	top: 0;
	pointer-events: none;
	background: currentColor;
	mask-image: var(--internal-export-symbol);
	mask-size: 16px;
	mask-repeat: no-repeat;
	mask-position: center;
	-webkit-mask-image: var(--internal-export-symbol);
	-webkit-mask-size: 16px;
	-webkit-mask-repeat: no-repeat;
	-webkit-mask-position: center;
}
.beepboxEditor button.okayButton::before,
.beepboxEditor button.exportButton::before {
	position: static;
	flex: 0 0 16px;
	width: 16px;
	height: 16px;
}

/* Tabler dropdown button — circle with chevron */
.beepboxEditor button.dropdown-button-tabler {
	position: relative;
	width: 16px;
	height: 22px;
	border-radius: 11px;
	padding: 0;
	min-width: 0;
}
.beepboxEditor button.dropdown-button-tabler::before {
	content: "";
	position: absolute;
	left: 50%;
	top: 50%;
	transform: translate(-50%, -50%);
	width: 12px;
	height: 10px;
	pointer-events: none;
	background: currentColor;
	-webkit-mask-image: url("data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2224%22 height=%2224%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22currentColor%22 stroke-width=%224%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22 > <path stroke=%22none%22 d=%22M0 0h24v24H0z%22 fill=%22none%22 /> <path d=%22M6 9l6 6l6 -6%22 /> </svg>");
	-webkit-mask-repeat: no-repeat;
	-webkit-mask-position: center;
	-webkit-mask-size: 12px;
	mask-image: url("data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2224%22 height=%2224%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22currentColor%22 stroke-width=%224%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22 > <path stroke=%22none%22 d=%22M0 0h24v24H0z%22 fill=%22none%22 /> <path d=%22M6 9l6 6l6 -6%22 /> </svg>");
	mask-repeat: no-repeat;
	mask-position: center;
	mask-size: 12px;
}
.beepboxEditor button.dropdown-button-tabler.dropdown-open::before {
	transform: translate(-50%, -50%) rotate(180deg);
}
`;
}
