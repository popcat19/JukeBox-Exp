// Prompt Export
//
// Purpose: CSS for the dedicated Export Song prompt anatomy and presentation.

import { Gap } from "../../ui/style-constants";

export function buildPromptExportCSS(): string {
	return `
.beepboxEditor .prompt.exportPrompt {
	box-sizing: border-box;
	width: 340px;
	max-width: 340px;
}
.beepboxEditor .navigator-import-export-surface.exportPrompt .exportPromptContent,
.beepboxEditor .prompt.exportPrompt .exportPromptContent {
	display: flex;
	flex-direction: column;
	gap: 12px;
	width: 100%;
	max-width: 100%;
	min-width: 0;
}
.beepboxEditor .navigator-import-export-surface.exportPrompt .exportPromptBody,
.beepboxEditor .prompt.exportPrompt .exportPromptBody {
	display: flex;
	flex-direction: column;
	gap: 12px;
	min-width: 0;
}
.beepboxEditor .navigator-import-export-surface.exportPrompt .exportSection,
.beepboxEditor .prompt.exportPrompt .exportSection {
	display: flex;
	flex-direction: column;
	gap: ${Gap.md};
	min-width: 0;
}
.beepboxEditor .navigator-import-export-surface.exportPrompt .exportSectionLabel,
.beepboxEditor .prompt.exportPrompt .exportSectionLabel { margin: 0; }
.beepboxEditor .navigator-import-export-surface.exportPrompt .exportField,
.beepboxEditor .prompt.exportPrompt .exportField {
	display: flex;
	flex-direction: column;
	align-items: stretch;
	gap: 4px;
	min-width: 0;
}
.beepboxEditor .navigator-import-export-surface.exportPrompt .exportFieldLabel,
.beepboxEditor .prompt.exportPrompt .exportFieldLabel,
.beepboxEditor .navigator-import-export-surface.exportPrompt .exportControlLabel,
.beepboxEditor .prompt.exportPrompt .exportControlLabel {
	font-size: 12px;
	color: var(--primary-text);
}
.beepboxEditor .navigator-import-export-surface.exportPrompt .exportFieldLabel,
.beepboxEditor .prompt.exportPrompt .exportFieldLabel { min-width: 0; }
.beepboxEditor .navigator-import-export-surface.exportPrompt .exportLengthField,
.beepboxEditor .prompt.exportPrompt .exportLengthField {
	flex-direction: row;
	align-items: baseline;
}
.beepboxEditor .navigator-import-export-surface.exportPrompt .exportLengthField .exportValue,
.beepboxEditor .prompt.exportPrompt .exportLengthField .exportValue { width: auto; }
.beepboxEditor .navigator-import-export-surface.exportPrompt .exportField > input[type="text"],
.beepboxEditor .prompt.exportPrompt .exportField > input[type="text"],
.beepboxEditor .navigator-import-export-surface.exportPrompt .exportField > select,
.beepboxEditor .prompt.exportPrompt .exportField > select {
	box-sizing: border-box;
	width: 100%;
	max-width: 100%;
	min-width: 0;
}
.beepboxEditor .navigator-import-export-surface.exportPrompt .exportField > .selectContainer,
.beepboxEditor .navigator-import-export-surface.exportPrompt .exportField > .selectContainer > select {
	box-sizing: border-box;
	width: 100%;
	max-width: 100%;
	min-width: 0;
}
.beepboxEditor .navigator-import-export-surface.exportPrompt .exportLoopBounds,
.beepboxEditor .prompt.exportPrompt .exportLoopBounds,
.beepboxEditor .navigator-import-export-surface.exportPrompt .exportPlaybackControls,
.beepboxEditor .prompt.exportPrompt .exportPlaybackControls,
.beepboxEditor .navigator-import-export-surface.exportPrompt .exportOptionControls,
.beepboxEditor .prompt.exportPrompt .exportOptionControls {
	display: grid;
	align-items: center;
	gap: ${Gap.md};
	min-width: 0;
}
.beepboxEditor .navigator-import-export-surface.exportPrompt .exportLoopBounds,
.beepboxEditor .prompt.exportPrompt .exportLoopBounds { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.beepboxEditor .navigator-import-export-surface.exportPrompt .exportLoopBoundaryControl,
.beepboxEditor .prompt.exportPrompt .exportLoopBoundaryControl {
	display: flex;
	flex-direction: column;
	gap: 4px;
	min-width: 0;
}
.beepboxEditor .navigator-import-export-surface.exportPrompt .exportLoopBoundaryControl input,
.beepboxEditor .prompt.exportPrompt .exportLoopBoundaryControl input {
	box-sizing: border-box;
	width: 100%;
	min-width: 0;
}
.beepboxEditor .navigator-import-export-surface.exportPrompt .exportLoopDependency,
.beepboxEditor .prompt.exportPrompt .exportLoopDependency {
	color: var(--secondary-text);
	font-size: 10px;
	line-height: 1.3;
}
.beepboxEditor .navigator-import-export-surface.exportPrompt .exportPlaybackControls,
.beepboxEditor .prompt.exportPrompt .exportPlaybackControls { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.beepboxEditor .navigator-import-export-surface.exportPrompt .exportOptionControls,
.beepboxEditor .prompt.exportPrompt .exportOptionControls { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.beepboxEditor .navigator-import-export-surface.exportPrompt .exportCheckControl,
.beepboxEditor .prompt.exportPrompt .exportCheckControl,
.beepboxEditor .navigator-import-export-surface.exportPrompt .exportLoopControl,
.beepboxEditor .prompt.exportPrompt .exportLoopControl {
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 4px;
	min-width: 0;
}
.beepboxEditor .navigator-import-export-surface.exportPrompt .exportLoopControl input[type="number"],
.beepboxEditor .prompt.exportPrompt .exportLoopControl input[type="number"] {
	box-sizing: border-box;
	width: 3em;
	min-width: 0;
	text-align: center;
}
.beepboxEditor .navigator-import-export-surface.exportPrompt .exportValue,
.beepboxEditor .prompt.exportPrompt .exportValue {
	display: block;
	width: 100%;
	min-width: 0;
	padding: 0;
	background: transparent;
	color: var(--primary-text);
	font-size: 12px;
}
.beepboxEditor .navigator-import-export-surface.exportPrompt .exportOggWarning,
.beepboxEditor .prompt.exportPrompt .exportOggWarning { font-size: 10px; color: var(--secondary-text); padding: 4px 0; overflow-wrap: anywhere; }
.beepboxEditor .navigator-import-export-surface.exportPrompt .exportNote,
.beepboxEditor .prompt.exportPrompt .exportNote { font-size: 10px; color: var(--secondary-text); text-align: left; margin: 4px 0; overflow-wrap: anywhere; }
.beepboxEditor .navigator-import-export-surface.exportPrompt .exportProgressContainer,
.beepboxEditor .prompt.exportPrompt .exportProgressContainer { width: 100%; max-width: 100%; height: 12px; display: block; position: relative; z-index: 1; background: var(--ui-widget-background); margin: 4px 0; border-radius: var(--border-radius-medium); overflow: hidden; }
.beepboxEditor .navigator-import-export-surface.exportPrompt .exportProgressBar,
.beepboxEditor .prompt.exportPrompt .exportProgressBar { width: 0%; height: 100%; position: absolute; z-index: 2; background: var(--loop-accent); }
.beepboxEditor .navigator-import-export-surface.exportPrompt .exportProgressLabel,
.beepboxEditor .prompt.exportPrompt .exportProgressLabel { position: relative; top: -1px; z-index: 3; mix-blend-mode: difference; color: #fff; font-weight: 600; font-size: 10px; text-align: center; line-height: 12px; }
.beepboxEditor .navigator-import-export-surface.exportPrompt .exportPromptFooter,
.beepboxEditor .prompt.exportPrompt .exportPromptFooter {
	display: flex;
	justify-content: flex-end;
	min-width: 0;
}
.beepboxEditor .navigator-import-export-surface.exportPrompt .exportPromptFooter > .prompt-button-row,
.beepboxEditor .prompt.exportPrompt .exportPromptFooter > .prompt-button-row { width: 100%; }
.beepboxEditor .navigator-import-export-surface.exportPrompt .exportPromptFooter .exportButton,
.beepboxEditor .prompt.exportPrompt .exportPromptFooter .exportButton {
	justify-content: center;
	width: 100%;
}
.beepboxEditor .navigator-import-export-surface.exportPrompt .exportPromptFooter .exportButton::before,
.beepboxEditor .prompt.exportPrompt .exportPromptFooter .exportButton::before { display: none; }
.beepboxEditor .navigator-pane-host > .navigator-native-pane.exportPrompt {
	align-items: flex-start;
	border: 0;
	outline: none;
	box-shadow: none;
	text-align: left;
}
.beepboxEditor .navigator-pane-host > .navigator-native-pane.exportPrompt .exportPromptContent {
	align-self: stretch;
	flex: 0 1 auto;
	width: 100%;
	max-width: none;
}
.beepboxEditor .navigator-pane-host > .navigator-native-pane.exportPrompt .prompt-button-row { outline: none; }
.beepboxEditor .navigator-pane-host > .navigator-native-pane.exportPrompt button:focus-visible {
	outline: 2px solid var(--hout, var(--primary-text));
	outline-offset: 1px;
}
.beepboxEditor .navigator-detached-content > .navigator-native-pane.exportPrompt .exportPromptContent {
	width: min(520px, 100%);
	max-width: 520px;
}

.beepboxEditor .navigator-import-export-surface.exportPrompt .exportPromptContent,
.beepboxEditor .navigator-import-export-surface.exportPrompt .exportPromptBody { gap: 6px; }
.beepboxEditor .navigator-import-export-surface.exportPrompt .exportSection { gap: 4px; }
.beepboxEditor .navigator-import-export-surface.exportPrompt .exportPromptBody {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	align-items: start;
}
.beepboxEditor .navigator-import-export-surface.exportPrompt .exportOptionsSection,
.beepboxEditor .navigator-import-export-surface.exportPrompt .exportOggWarning,
.beepboxEditor .navigator-import-export-surface.exportPrompt .exportNote,
.beepboxEditor .navigator-import-export-surface.exportPrompt .exportProgressContainer { grid-column: 1 / -1; }
.beepboxEditor .navigator-import-export-surface.exportPrompt .exportPromptFooter > .prompt-button-row,
.beepboxEditor .navigator-import-export-surface.instrumentExportPrompt > .prompt-button-row { margin: 0; }
.beepboxEditor .navigator-import-export-surface.instrumentExportPrompt > .prompt-button-row,
.beepboxEditor .navigator-import-export-surface.instrumentExportPrompt .exportButton { width: 100%; }
.beepboxEditor .navigator-import-export-surface.instrumentExportPrompt .exportButton { justify-content: center; }
@media (max-width: 639px) {
	.beepboxEditor .prompt.exportPrompt { width: min(340px, calc(100vw - 16px)); max-width: 340px; }
}
`;
}
