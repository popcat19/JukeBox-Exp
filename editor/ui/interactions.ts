// interactions.ts
//
// Purpose: PMD interaction-state behavior helpers
//
// This module:
// - Applies PMD hover-reveal outline pattern to existing elements
// - Applies PMD focus-reveal outline pattern for keyboard accessibility
// - Toggles PMD active-fill pattern on tab/list/chip-style elements
// - All helpers mutate the passed element; none replace it

import { injectGlobalStyles } from "../../shared/styles/inject";
import { s } from "./style";
import type { SurfaceRole } from "./surfaces";
import { interactiveSurface } from "./surfaces";

// CSS class names. Used both to inject rules via a single <style> element
// and as hook classes for call sites that want to override behaviour.
const HOVER_CLASS = "pmd-hover";
const HOVER_COLOR_CLASS = "pmd-hover-color";
const FOCUS_CLASS = "pmd-focus";
const ACTIVE_CLASS = "pmd-active";
const DISABLED_CLASS = "pmd-disabled";

// Lazily inject shared PMD interaction-state rules. The tagged style
// helper dedupes by id, so repeated interaction calls update the existing
// <style> element instead of appending duplicates.
function ensureStyleInjected(): void {
	if (typeof document === "undefined") return;
	const css = s(
		`.${HOVER_CLASS}:hover{outline-color:var(--secondary-text, currentColor);}`,
		`.${HOVER_COLOR_CLASS}{color:var(--hover-color-idle, var(--primary-text));}`,
		`.${HOVER_COLOR_CLASS}:hover{color:var(--hover-color-accent, var(--cta-fg));}`,
		`.${FOCUS_CLASS}:focus-visible{outline-color:var(--scrollbar-color, var(--subtext));}`,
		`.${ACTIVE_CLASS}{${interactiveSurface("primary")}}`,
		// Disabled is a surface replacement, not a fade. Fading the whole
		// control drops the text below 4.5:1 and leaves hover affordances
		// looking live, so use the PMD disabled triple instead: 4x backing,
		// 88x40% foreground, and a solid 2px inset boundary.
		`.${DISABLED_CLASS}{opacity:1;background:var(--editor-background, black);color:var(--base03-muted, #999);outline:2px solid var(--base03-muted, #999);outline-offset:-2px;cursor:not-allowed;}`,
	);
	injectGlobalStyles(document, "pmd-interactions", css);
}

// hoverReveal options. role defaults to "ghost" (transparent surface) since
// most hover-reveal consumers are icon-only buttons where the ring is the
// only feedback. Pass "primary" for CTA surfaces — the rule in the injected
// stylesheet uses outline-color: var(--secondary-text) for non-CTA and
// callers using "primary" should override via CSS class.
//
// mode: "outline" (default) applies the PMD outline-ring pattern. PMD
// §Hover and Focus Feedback specifies 80x as the hover surface, expressed
// as an outline ring with -2px offset. Use this for buttons on transparent
// or visibly-bordered surfaces.
//
// mode: "color" swaps the element's `color` property between idleColor
// and accentColor on hover. PMD does not formally endorse color-swap
// hover (the spec prefers outline), but established call sites
// (mute-editor._loopButton, channel-volume-visualizer-prompt._loopButton)
// already use this pattern because their inline `outline: none` would
// block an outline ring. Use "color" only as a preservation migration.
export interface HoverRevealOptions {
	role?: SurfaceRole;
	mode?: "outline" | "color";
	idleColor?: string;
	accentColor?: string;
}

// Apply PMD hover-reveal to an element. Adds the hover class which triggers
// the 80x outline ring injected by ensureStyleInjected (mode: "outline")
// or the color swap rule (mode: "color"). Idempotent: calling twice adds
// the class once (DOMTokenList toggle semantics).
//
// Replaces the opacity-transition pattern that clear-button.ts and
// dropdown-button.ts were hand-rolling. The PMD-correct feedback is an
// outline ring (2px, -2px offset) per effects.txt §Hover and Focus Feedback,
// not an opacity shift.
export function hoverReveal(el: HTMLElement, options?: HoverRevealOptions): void {
	ensureStyleInjected();
	const mode = options?.mode ?? "outline";
	el.classList.add(mode === "color" ? HOVER_COLOR_CLASS : HOVER_CLASS);
	if (options?.role !== undefined) {
		el.dataset.pmdRole = options.role;
	}
	if (mode === "color") {
		// Set CSS custom props only; the injected stylesheet reads them and
		// drives the swap. Setting inline `el.style.color` would beat the
		// `:hover` class rule and break the swap.
		const idle = options?.idleColor ?? "var(--primary-text)";
		const accent = options?.accentColor ?? "var(--cta-fg)";
		el.style.setProperty("--hover-color-idle", idle);
		el.style.setProperty("--hover-color-accent", accent);
		// Clear any existing inline color so the .pmd-hover-color rule wins.
		// Callers that toggle `el.style.color` themselves (e.g.
		// mute-editor._updateLoopButton based on loopRepeatCount) should
		// use setActive() instead, or remove the inline color before
		// calling hoverReveal.
		el.style.removeProperty("color");
	}
}

// focusReveal options. role is unused for now but reserved for symmetry
// with hoverReveal; future primary-surface focus overrides can hook here.
export interface FocusRevealOptions {
	role?: SurfaceRole;
}

// Apply PMD focus-reveal to an element. Adds the focus class which triggers
// the 80x48% outline ring on :focus-visible per effects.txt. Idempotent.
export function focusReveal(el: HTMLElement, options?: FocusRevealOptions): void {
	ensureStyleInjected();
	el.classList.add(FOCUS_CLASS);
	if (options?.role !== undefined) {
		el.dataset.pmdRole = options.role;
	}
}

// setActive options. textColor override is required when the parent surface
// beneath the active fill is not the standard var(--cta-bg)/--cta-fg pair.
// Per PMD effects.txt §Active Fill Text, active text uses the surface
// beneath the fill; if the parent sits on an alpha-composited layer
// (80x8%, 80x48%), skip it and use the next opaque surface below.
export interface SetActiveOptions {
	textColor?: string;
}

// Toggle the PMD active-fill pattern. When active=true, the element gets
// the primary surface (88x fill + surface-under text). When false, the
// class is removed and the element returns to its base style.
//
// Used by tab buttons, list items, tag chips, and similar elements that
// switch between inactive and selected states.
export function setActive(el: HTMLElement, active: boolean, options?: SetActiveOptions): void {
	ensureStyleInjected();
	el.classList.toggle(ACTIVE_CLASS, active);
	if (options?.textColor !== undefined) {
		el.style.color = active ? options.textColor : "";
	}
}

// HTML form-control elements that natively support the `disabled` IDL
// attribute. setDisabled relies on this union so TypeScript validates
// that callers do not pass elements without native disable support.
export type DisableableElement =
	| HTMLInputElement
	| HTMLSelectElement
	| HTMLButtonElement
	| HTMLTextAreaElement
	| HTMLOptionElement
	| HTMLFieldSetElement;

// setDisabled options. role is unused for now but reserved for symmetry
// with hoverReveal/focusReveal; future per-surface disabled styling can
// hook here (e.g. the disabled opacity stays at 88×24% regardless of role).
export interface SetDisabledOptions {
	role?: SurfaceRole;
}

// Apply PMD disabled state to a form control. Sets the native `disabled`
// IDL attribute (which carries assistive-tech semantics) and toggles the
// pmd-disabled class hook (which the injected stylesheet styles at 88×24%
// opacity per opacity.txt:9).
//
// The native form-control pattern (`el.disabled = true`) ALSO triggers
// the same 88×24% visual via the `.beepboxEditor [disabled]` rule in
// base-widgets.ts, so callers that bypass setDisabled still get the
// PMD-correct styling. setDisabled exists for symmetry with the other
// interaction-state helpers and for the programmatic-disable case where
// the native attribute is not appropriate (e.g. enabling/disabling a
// wrapper div as a click-target, or a non-form-control element).
export function setDisabled(
	el: DisableableElement,
	disabled: boolean,
	options?: SetDisabledOptions,
): void {
	ensureStyleInjected();
	el.disabled = disabled;
	el.classList.toggle(DISABLED_CLASS, disabled);
	if (options?.role !== undefined) {
		el.dataset.pmdRole = options.role;
	}
}
