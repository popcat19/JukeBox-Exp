// Prompt Shell
//
// Purpose: CSS for the generic prompt container, dock, shell, titlebar,
// form rows, shaded state, and popout state
//
// Extracted from style.ts. Variant-specific prompt classes
// (compactSearch, cleanChannel, export, etc.) remain in style.ts.
//
// Prompt DOM state contract (issue #27):
//
// Lifecycle classes, asserted by tests/dom-hooks.test.ts — do not rename:
//   .entering  — inert state hook pinned to `animation: none`.
//   .exiting   — inert state hook pinned to `animation: none`, plus
//                pointer-events: none. Removal is synchronous in
//                prompt-manager.ts (close), so this state is never
//                observed for more than one task.
//   .focused   — steady focus outline. Owned by prompt-manager.ts
//                (_updatePromptFocus).
//   .refocus   — inert state hook pinned to `animation: none`. The
//                raise gesture is gone; reopening a prompt now conveys
//                position by stacking order alone.
//   .docked    — pinned to L/R editor edge. Owned by prompt-dock.ts.
//
// PMD forbids transitions and animations, so none of these classes carry
// motion. They survive as selectors so the hooks stay stable.
//
// View-state class (NOT a lifecycle state; not in the dom-hooks set):
//   .shaded    — titlebar-only collapsed view, toggled by BasePrompt.
//
// Attribute:
//   data-popout="true" — set by prompt-popout.ts when the prompt is
//                detached into an OS window. Hides shade/popout buttons
//                and suppresses hover/focus outlines.
//
// Shell markup contract:
//   .promptContainer > .prompt (variant classes per factory)
//   Standard prompts: .prompt > .prompt-titlebar > [shadeButton] h2
//   [cancelButton], then factory content (form rows, hints, button
//   rows). BasePrompt.buildTitlebar and buildPromptTitlebar create
//   the shared titlebar for class-based and component-owned prompts.
// Factories hand-build the .prompt div and use the shared titlebar builder.
//
// Reduced motion: prompt lifecycle states carry no motion at all, so there
// is nothing to collapse (see animations.ts).
//
// Inline-style exceptions (audit §6): measured position (left/top),
// dock pinning, divider geometry, and editor padding stay inline in
// prompt-manager.ts / prompt-dock.ts. The backdrop/background
// toggle in _updatePromptFocus (showPromptBackdrop pref) remains
// inline — it is runtime-coupled with prompt-popout.ts documentElement
// custom-property overrides and awaits popout boundary work.

import { ColorConfig } from "../../../shared/color-config";
import { Typography } from "../../ui/style-constants";
import { buildAnimationsCSS } from "./animations";

export function buildPromptShellCSS(): string {
	return `\
.beepboxEditor .promptContainer {
	position: absolute;
	top: 0;
	left: 0;
	width: 100%;
	height: 100%;
	display: block;
	z-index: 100;
	pointer-events: none;
}

.beepboxEditor .promptContainer.navigatorVisible {
	display: flex !important;
}

.beepboxEditor .promptContainer > * {
	pointer-events: auto;
}

/* Prompt docking: a docked prompt is pinned to the L/R side of the
 * editor (still inside .beepboxEditor so component styles apply) and
 * the editor grid content is inset via padding to make room. A
 * resizable divider sits at the padding boundary. */
.beepboxEditor .prompt-dock-divider {
	position: fixed;
	z-index: 101;
	width: 6px;
	cursor: col-resize;
	background: var(--ui-widget-background, #444);
	pointer-events: auto;
}
.beepboxEditor .prompt-dock-divider:hover {
	background: var(--ui-widget-focus, #666);
}
.beepboxEditor .prompt.docked {
	position: fixed;
	margin: 0;
	box-sizing: border-box;
	border-radius: 0;
	overflow: auto;
	min-width: 0;
	max-width: 50vw;
	backdrop-filter: none;
	-webkit-backdrop-filter: none;
	background: transparent !important;
	outline: none !important;
}
.beepboxEditor .prompt.docked .shadeButton {
	display: none;
}
.beepboxEditor .prompt.docked .prompt-titlebar {
	position: sticky;
	top: 0;
	z-index: 2;
}
.beepboxEditor .prompt.docked.fill-y .paneContainer {
	height: auto !important;
	flex: 1 1 auto;
	min-height: 0;
}
.beepboxEditor .prompt.docked.fill-y .tabContent {
	flex: 1 1 auto;
	min-height: 0;
	display: flex;
	flex-direction: column;
}

.beepboxEditor .prompt {
	margin: auto;
	text-align: center;
	background: var(--prompt-bg-color, transparent);
	backdrop-filter: var(--prompt-backdrop-filter, blur(24px));
	-webkit-backdrop-filter: var(--prompt-backdrop-filter, blur(24px));
	border-radius: var(--border-radius-large);
	color: ${ColorConfig.primaryText};
	padding: var(--padding-12);
	display: flex;
	flex-direction: column;
	gap: var(--gap-md);
	position: absolute;
	z-index: 1;
	pointer-events: auto;
	outline: none;
}

${buildAnimationsCSS()}

.beepboxEditor .prompt.shaded {
	padding: var(--padding-6) 14px;
	min-width: 0;
	max-width: max-content;
	overflow: hidden;
	display: flex;
	align-items: center;
	border-radius: var(--border-radius-large);
}

.beepboxEditor .prompt.shaded > *:not(.prompt-titlebar) {
	display: none !important;
}

.beepboxEditor .prompt:hover {
	/* PMD: hover uses an 80x inner outline (2px, outline-offset: -2px).
	 * 80x is the body tier — visible without competing with the 88x
	 * titlebar heading inside the prompt. */
	outline: 2px solid var(--hout, ${ColorConfig.primaryText});
	outline-offset: -2px;
}

.beepboxEditor .prompt.focused,
.beepboxEditor .prompt:focus-visible {
	/* PMD: keyboard focus uses the same 80x tier as hover so the visual
	 * language is identical regardless of input modality. */
	outline: 2px solid var(--hout, ${ColorConfig.primaryText});
	outline-offset: -2px;
}

.beepboxEditor .prompt > .cancelButton {
	margin-top: auto;
}

.beepboxEditor .prompt-form-row {
	display: flex;
	flex-direction: row;
	align-items: center;
	gap: var(--gap-md);
	min-height: 2em;
}

.beepboxEditor .prompt-form-row-between {
	display: flex;
	flex-direction: row;
	align-items: center;
	justify-content: space-between;
	gap: var(--gap-md);
	min-height: 2em;
}

.beepboxEditor .prompt-form-row-end {
	display: flex;
	flex-direction: row;
	align-items: flex-start;
	justify-content: flex-end;
	gap: var(--gap-md);
	min-height: 2em;
}

.beepboxEditor .prompt-button-row {
	display: flex;
	flex-direction: row;
	justify-content: flex-end;
	gap: var(--gap-md);
}

.beepboxEditor .prompt-label {
	text-align: right;
	flex-shrink: 1;
	min-width: 0;
	overflow-wrap: break-word;
}

.beepboxEditor .prompt-hint {
	font-size: smaller;
	color: var(--subtext);
}

.beepboxEditor .prompt-tip-content {
	display: flex;
	flex-direction: column;
	gap: var(--gap-md);
	text-align: left;
}

.beepboxEditor .prompt-tip-content > * {
	margin: 0;
}

.beepboxEditor .prompt h2 {
	font-size: ${Typography.sizeLg};
	margin: 0 16px;
	font-weight: ${Typography.weightSemibold};
	color: ${ColorConfig.promptTitlebarText};
}

.beepboxEditor .prompt p {
	text-align: left;
	margin: 0;
}

.beepboxEditor .prompt p + p {
	margin-top: 1.0em;
}

.beepboxEditor .prompt label {
	cursor: pointer;
}

.beepboxEditor .prompt.recordingSetupPrompt p {
	margin-top: 0.75em;
	margin-bottom: 0;
}

.beepboxEditor .prompt.recordingSetupPrompt > label:not(:first-child):not(.cancelButton) {
	margin: 2px 0;
}

.beepboxEditor .prompt[data-popout="true"]:hover,
.beepboxEditor .prompt[data-popout="true"].focused,
.beepboxEditor .prompt[data-popout="true"]:focus-visible {
	outline: none;
}

.beepboxEditor .prompt[data-popout="true"] .shadeButton,
.beepboxEditor .prompt[data-popout="true"] .popoutButton {
	display: none;
}

.beepboxEditor .prompt-titlebar {
	display: flex;
	flex-shrink: 0;
	align-items: center;
	gap: var(--gap-md);
	width: 100%;
	height: 28px;
	min-height: 28px;
	overflow: hidden;
}

.beepboxEditor .prompt.noSelection:not(.shaded) .prompt-titlebar {
	height: auto;
	min-height: 28px;
	align-items: stretch;
}

.beepboxEditor .prompt-titlebar > h2 {
	flex: 1;
	display: flex;
	align-items: center;
	justify-content: center;
	text-align: center !important;
	margin: 0 !important;
	min-height: 28px;
	line-height: 1.2;
	font-size: ${Typography.sizeLg};
	font-weight: ${Typography.weightSemibold};
	color: ${ColorConfig.promptTitlebarText};
	padding: 0 !important;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.beepboxEditor .prompt.noSelection:not(.shaded) .prompt-titlebar > h2 {
	white-space: normal;
	overflow: visible;
	text-overflow: unset;
	overflow-wrap: break-word;
	min-width: 0;
	max-width: 100%;
}

.beepboxEditor .prompt-titlebar > button,
.beepboxEditor .prompt-titlebar > button.cancelButton {
	flex: var(--flex-fit);
	height: 28px;
	width: 28px;
	min-width: 28px;
	padding: 0;
	border-radius: var(--border-radius-large);
}
.beepboxEditor .prompt-titlebar > button::before,
.beepboxEditor .prompt-titlebar > button.cancelButton::before {
	width: 100%;
	height: 100%;
	left: 0;
	top: 0;
}

.beepboxEditor .prompt.shaded .prompt-titlebar {
	margin-bottom: 0;
	padding: 0;
}

.beepboxEditor .prompt.shaded .prompt-titlebar h2 {
	margin: 0 !important;
	font-size: ${Typography.sizeLg} !important;
	color: ${ColorConfig.promptTitlebarText};
	cursor: pointer;
	white-space: nowrap;
	line-height: 1.2;
}

`;
}
