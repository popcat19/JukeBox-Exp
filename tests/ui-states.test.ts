// ui-states.test.ts
//
// Purpose: Contract tests for the PMD state/surface/interaction token layer
//
// This module:
// - Verifies state.ts exports have expected shapes and PMD spec-mapped values
// - Verifies surfaces.ts returns PMD spec-aligned idle CSS for each role
// - Verifies interactions.ts imports cleanly and exposes the expected helpers
// - Source-greps clear-button and dropdown-button to confirm PMD outline
//   pattern replaces opacity transition after refactor

import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
	StateOutline,
	StateForeground,
	StateBackground,
	stateTransition,
	hoverRing,
	hoverRule,
	focusRule,
	inputFocusRule,
	interactiveFeedback,
} from "../editor/ui/states";
import {
	primarySurface,
	secondarySurface,
	ghostSurface,
	interactiveSurface,
	type SurfaceRole,
} from "../editor/ui/surfaces";
import * as Interactions from "../editor/ui/interactions";

function sourceLines(path: string): string[] {
	return readFileSync(resolve(__dirname, "..", path), "utf-8").split("\n");
}

describe("states token exports", () => {
	test("StateOutline exposes three CSS-var-mapped ring colours", () => {
		expect(StateOutline.hover).toBe("var(--secondary-text, currentColor)");
		expect(StateOutline.focus).toBe("var(--scrollbar-color, var(--subtext))");
		expect(StateOutline.inputFocus).toBe("var(--primary-text)");
	});

	test("StateForeground idle uses primary-text; disabled uses disabled-note-primary", () => {
		expect(StateForeground.idle).toBe("var(--primary-text)");
		expect(StateForeground.disabled).toBe("var(--disabled-note-primary)");
	});

	test("StateBackground idle and disabled both reference widget/base02 vars", () => {
		expect(StateBackground.idle).toBe("var(--ui-widget-background)");
		expect(StateBackground.disabled).toBe("var(--base02-surface)");
	});

	test("stateTransition returns the cubic-bezier(0.4, 0, 0.2, 1) easing rule", () => {
		const rule = stateTransition();
		expect(rule).toContain("transition:");
		expect(rule).toContain("cubic-bezier(0.4, 0, 0.2, 1)");
	});

	test("hoverRing returns 2px transparent outline with -2px offset", () => {
		const ring = hoverRing();
		expect(ring).toContain("outline:");
		expect(ring).toContain("2px");
		expect(ring).toContain("solid transparent");
		expect(ring).toContain("outline-offset: -2px");
	});

	test("hoverRule and focusRule return outline-color rules only (no layout shift)", () => {
		expect(hoverRule()).toBe(`outline-color: ${StateOutline.hover};`);
		expect(focusRule()).toBe(`outline-color: ${StateOutline.focus};`);
		expect(inputFocusRule()).toBe(`outline-color: ${StateOutline.inputFocus};`);
	});

	test("interactiveFeedback composes transition + hover ring", () => {
		const composed = interactiveFeedback();
		expect(composed).toContain("transition:");
		expect(composed).toContain("outline:");
		expect(composed).toContain("solid transparent");
	});
});

describe("surfaces role composer", () => {
	test("primarySurface uses cta-bg background and cta-fg color", () => {
		const css = primarySurface();
		expect(css).toContain("background: var(--cta-bg");
		expect(css).toContain("color: var(--cta-fg");
		expect(css).toContain("outline: 2px solid transparent");
	});

	test("secondarySurface uses ui-widget-background and primary-text", () => {
		const css = secondarySurface();
		expect(css).toContain("background: var(--ui-widget-background)");
		expect(css).toContain("color: var(--primary-text)");
		expect(css).toContain("transition:");
	});

	test("ghostSurface is transparent with primary-text foreground", () => {
		const css = ghostSurface();
		expect(css).toContain("background: transparent");
		expect(css).toContain("color: var(--primary-text)");
		expect(css).toContain("outline: 2px solid transparent");
	});

	test("interactiveSurface dispatches to the matching role composer", () => {
		const roles: SurfaceRole[] = ["primary", "secondary", "ghost"];
		for (const role of roles) {
			const css = interactiveSurface(role);
			expect(css.length).toBeGreaterThan(0);
			expect(css).toContain("outline: 2px solid transparent");
		}
	});

	test("interactiveSurface produces distinct strings per role", () => {
		// Regression guard: if all three roles collapse to the same CSS,
		// the composer is silently broken.
		const a = interactiveSurface("primary");
		const b = interactiveSurface("secondary");
		const c = interactiveSurface("ghost");
		expect(a).not.toBe(b);
		expect(b).not.toBe(c);
		expect(a).not.toBe(c);
	});
});

describe("interactions module contract", () => {
	test("exports hoverReveal, focusReveal, setActive, and setDisabled", () => {
		expect(typeof Interactions.hoverReveal).toBe("function");
		expect(typeof Interactions.focusReveal).toBe("function");
		expect(typeof Interactions.setActive).toBe("function");
		expect(typeof Interactions.setDisabled).toBe("function");
	});

	test("interaction helpers accept an HTMLElement and an options bag", () => {
		// Function arity is the cheapest contract we can test without a DOM.
		expect(Interactions.hoverReveal.length).toBeLessThanOrEqual(2);
		expect(Interactions.focusReveal.length).toBeLessThanOrEqual(2);
		expect(Interactions.setActive.length).toBeLessThanOrEqual(3);
		expect(Interactions.setDisabled.length).toBeLessThanOrEqual(3);
	});

	test("interactions source injects PMD outline rules via shared tagged style helper", () => {
		const lines = sourceLines("editor/ui/interactions.ts");
		const joined = lines.join("\n");
		// Tagged injection helper dedupes the shared style element.
		expect(joined).toContain("injectGlobalStyles");
		expect(joined).toContain('"pmd-interactions"');
		// Class hooks must exist
		expect(joined).toContain('"pmd-hover"');
		expect(joined).toContain('"pmd-focus"');
		expect(joined).toContain('"pmd-active"');
		expect(joined).toContain('"pmd-disabled"');
		// Hover, focus, and disabled rules must be injected via CSS
		expect(joined).toContain(":hover{outline-color:");
		expect(joined).toContain(":focus-visible{outline-color:");
	});

	test("interactions source injects the PMD disabled triple, not an opacity fade", () => {
		const lines = sourceLines("editor/ui/interactions.ts");
		const joined = lines.join("\n");
		// PMD effects.md §Disabled controls: 4x backing, base03 foreground,
		// solid 2px inset base03 boundary, and opacity 1. Fading the whole
		// control is explicitly forbidden.
		expect(joined).toContain("${DISABLED_CLASS}{opacity:1;");
		expect(joined).toContain("background:var(--editor-background");
		expect(joined).toContain("color:var(--base03-muted");
		expect(joined).toContain("outline:2px solid var(--base03-muted");
		expect(joined).not.toContain("opacity:0.24;");
	});

	test("DisableableElement union covers the form-control elements callers pass", () => {
		// We can't introspect the union type at runtime, but we can assert
		// the source declares the named union and references each member.
		const lines = sourceLines("editor/ui/interactions.ts");
		const joined = lines.join("\n");
		expect(joined).toContain("DisableableElement");
		expect(joined).toContain("HTMLInputElement");
		expect(joined).toContain("HTMLSelectElement");
		expect(joined).toContain("HTMLButtonElement");
		expect(joined).toContain("HTMLOptionElement");
		expect(joined).toContain("HTMLTextAreaElement");
		expect(joined).toContain("HTMLFieldSetElement");
	});
});

describe("refactor proof: mute-editor loop button enter handler is single-branch and leave reuses _updateLoopButton", () => {
	test("mute-editor.ts has exactly one _onLoopMouseEnter (no separate _onLoopMouseLeave)", () => {
		const lines = sourceLines("editor/components/mute-editor.ts");
		const joined = lines.join("\n");
		// Pre-phase-2 had _onLoopMouseEnter AND _onLoopMouseLeave. The refactor
		// collapses the leave handler to a re-call of _updateLoopButton.
		expect(joined).toContain("_onLoopMouseEnter");
		expect(joined).not.toContain("_onLoopMouseLeave");
		// mouseleave listener reuses the existing active/inactive handler.
		expect(joined).toContain('_loopButton.addEventListener("mouseleave", this._updateLoopButton)');
	});

	test("mute-editor.ts _onLoopMouseEnter has a single if branch over loopRepeatCount", () => {
		const lines = sourceLines("editor/components/mute-editor.ts");
		const joined = lines.join("\n");
		// Pre-phase-2 duplicated the if/else across enter and leave. Post-refactor
		// only the enter path keeps a conditional; leave reuses _updateLoopButton.
		const enterBlock = joined.split("_onLoopMouseEnter =")[1]?.split("};")[0] ?? "";
		expect(enterBlock).toContain("loopRepeatCount");
		expect(enterBlock).toContain("--cta-fg");
		expect(enterBlock).toContain("--primary-text");
		// Only one ternary branch in the enter path, not two duplicated ones.
		expect(enterBlock.split("var(--cta-fg)").length).toBe(2);
	});
});

describe("refactor proof: channel-volume-visualizer loop button enter handler is single-branch and leave reuses _updateLoopButton", () => {
	test("channel-volume-visualizer-prompt.ts has exactly one _onLoopMouseEnter (no separate _onLoopMouseLeave)", () => {
		const lines = sourceLines(
			"editor/prompts/channel-volume-visualizer-prompt.ts",
		);
		const joined = lines.join("\n");
		expect(joined).toContain("_onLoopMouseEnter");
		expect(joined).not.toContain("_onLoopMouseLeave");
		expect(joined).toContain('_loopButton.addEventListener("mouseleave", this._updateLoopButton)');
	});

	test("channel-volume-visualizer-prompt.ts _onLoopMouseEnter has a single if branch over loopRepeatCount", () => {
		const lines = sourceLines(
			"editor/prompts/channel-volume-visualizer-prompt.ts",
		);
		const joined = lines.join("\n");
		const enterBlock = joined.split("_onLoopMouseEnter =")[1]?.split("};")[0] ?? "";
		expect(enterBlock).toContain("loopRepeatCount");
		expect(enterBlock).toContain("--cta-fg");
		expect(enterBlock).toContain("--primary-text");
		expect(enterBlock.split("var(--cta-fg)").length).toBe(2);
	});
});

describe("interactions module still exposes color hover mode for future use", () => {
	test("hoverRevealHoverColor class hook and CSS rule remain available", () => {
		const lines = sourceLines("editor/ui/interactions.ts");
		const joined = lines.join("\n");
		expect(joined).toContain('"pmd-hover-color"');
		expect(joined).toContain(":hover{color:var(--hover-color-accent");
	});

	test("hoverReveal options type allows mode: outline | color", () => {
		const lines = sourceLines("editor/ui/interactions.ts");
		const joined = lines.join("\n");
		// Type definition accepts the new mode union.
		expect(joined).toMatch(/mode\?:\s*"outline"\s*\|\s*"color"/);
		// Function body dispatches on mode === "color".
		expect(joined).toContain('mode === "color"');
	});
});

describe("refactor proof: clear-button uses hoverReveal", () => {
	test("clear-button.ts does not inline the mouseenter/mouseleave opacity pattern", () => {
		const lines = sourceLines("editor/ui/buttons/clear-button.ts");
		const joined = lines.join("\n");
		// After refactor, the duplicated pattern is gone.
		expect(joined).not.toContain("mouseenter");
		expect(joined).not.toContain("mouseleave");
		expect(joined).not.toContain('opacity = "1"');
	});

	test("clear-button.ts imports hoverReveal from ui/interactions", () => {
		const lines = sourceLines("editor/ui/buttons/clear-button.ts");
		const joined = lines.join("\n");
		expect(joined).toMatch(/from\s+["']\.\.\/interactions["']/);
		expect(joined).toContain("hoverReveal(");
	});
});

describe("refactor proof: dropdown-button uses hoverReveal", () => {
	test("dropdown-button.ts does not inline the mouseenter/mouseleave opacity pattern", () => {
		const lines = sourceLines("editor/ui/buttons/dropdown-button.ts");
		const joined = lines.join("\n");
		expect(joined).not.toContain("mouseenter");
		expect(joined).not.toContain("mouseleave");
		expect(joined).not.toContain('opacity = "1"');
	});

	test("dropdown-button.ts imports hoverReveal from ui/interactions", () => {
		const lines = sourceLines("editor/ui/buttons/dropdown-button.ts");
		const joined = lines.join("\n");
		expect(joined).toMatch(/from\s+["']\.\.\/interactions["']/);
		expect(joined).toContain("hoverReveal(");
	});
});

describe("refactor proof: mute-editor route option-disabled through setDisabled", () => {
	test("mute-editor.ts has no remaining .options[N].disabled = boolean assignments", () => {
		const lines = sourceLines("editor/components/mute-editor.ts");
		const joined = lines.join("\n");
		// Per phase 4 plan: 10 native .disabled = bool calls in
		// _channelDropDownGetOpenedPosition must all be replaced with
		// setDisabled(this._channelDropDown.options[N], bool).
		expect(joined).not.toMatch(/\.options\[\d+\]\.disabled\s*=\s*(true|false)/);
	});

	test("mute-editor.ts imports setDisabled from the ui barrel", () => {
		const lines = sourceLines("editor/components/mute-editor.ts");
		const joined = lines.join("\n");
		expect(joined).toContain("setDisabled");
		expect(joined).toMatch(/import\s*\{[^}]*setDisabled[^}]*\}\s*from\s*["']\.\.\/ui["']/);
	});

	test("mute-editor.ts has 10 setDisabled calls along option[N] indexes 1, 2, 5, 6, 9", () => {
		const lines = sourceLines("editor/components/mute-editor.ts");
		const joined = lines.join("\n");
		// Each index 1/2/5/6/9 should be touched twice (true and false branches).
		// 5 indexes × 2 = 10 calls.
		const callCount = (joined.match(/setDisabled\(this\._channelDropDown\.options\[\d+\]/g) || []).length;
		expect(callCount).toBe(10);
	});
});

describe("refactor proof: export-prompt route intro/outro disabled through setDisabled", () => {
	test("export-prompt.ts has no remaining _enableIntro/_enableOutro.disabled = boolean assignments", () => {
		const lines = sourceLines("editor/prompts/export-prompt.ts");
		const joined = lines.join("\n");
		expect(joined).not.toMatch(/this\._enable(Intro|Outro)\.disabled\s*=\s*(true|false)/);
	});

	test("export-prompt.ts routes intro/outro disabled through setDisabled", () => {
		const lines = sourceLines("editor/prompts/export-prompt.ts");
		const joined = lines.join("\n");
		const introCalls = (joined.match(/setDisabled\(this\._enableIntro,/g) || []).length;
		const outroCalls = (joined.match(/setDisabled\(this\._enableOutro,/g) || []).length;
		expect(introCalls).toBe(1);
		expect(outroCalls).toBe(1);
	});
});

describe("refactor proof: render-post-sync route addEnvelopeButton disabled through setDisabled", () => {
	test("render-post-sync.ts routes addEnvelopeButton disabled through setDisabled", () => {
		const lines = sourceLines("editor/renderers/render-post-sync.ts");
		const joined = lines.join("\n");
		expect(joined).toContain("setDisabled(refs.addEnvelopeButton");
		expect(joined).not.toMatch(/refs\.addEnvelopeButton\.disabled\s*=/);
	});
});

describe("refactor proof: song-editor route autoPlay/layout option-disabled through setDisabled", () => {
	test("song-editor.ts routes mobile-hide autoPlay option through setDisabled", () => {
		const lines = sourceLines("editor/song-editor.ts");
		const joined = lines.join("\n");
		expect(joined).toContain("setDisabled(autoPlayOption, true)");
		expect(joined).not.toMatch(/autoPlayOption\.disabled\s*=/);
	});

	test("song-editor.ts routes narrow-screen layout option through setDisabled", () => {
		const lines = sourceLines("editor/song-editor.ts");
		const joined = lines.join("\n");
		expect(joined).toContain("setDisabled(layoutOption, true)");
		expect(joined).not.toMatch(/layoutOption\.disabled\s*=/);
	});
});

describe("refactor proof: instrument-import-prompt route importStrategySelect disabled through setDisabled", () => {
	test("instrument-import-prompt.ts routes importStrategySelect disabled through setDisabled", () => {
		const lines = sourceLines("editor/prompts/instrument-import-prompt.ts");
		const joined = lines.join("\n");
		expect(joined).toContain(
			"setDisabled(this._importStrategySelect, true)",
		);
		expect(joined).not.toMatch(/this\._importStrategySelect\.disabled\s*=/);
	});
});

describe("refactor proof: instrument-browser-prompt clearBtn uses hoverReveal", () => {
	test("clearBtn no longer inlines background swap on mouseenter/mouseleave", () => {
		const lines = sourceLines("editor/prompts/instrument-browser-prompt.ts");
		const joined = lines.join("\n");
		// The clearBtn context: lines around the clearBtn creation must not
		// contain addEventListener("mouseenter", ...) or addEventListener("mouseleave", ...)
		// targeting clearBtn. Pre-phase-5 had inline style.background swaps.
		expect(joined).not.toMatch(/clearBtn\.addEventListener\("mouseenter"/);
		expect(joined).not.toMatch(/clearBtn\.addEventListener\("mouseleave"/);
	});

	test("clearBtn adopts hoverReveal with role:secondary", () => {
		const lines = sourceLines("editor/prompts/instrument-browser-prompt.ts");
		const joined = lines.join("\n");
		expect(joined).toContain('hoverReveal(clearBtn, { role: "secondary" })');
	});

	test("clearBtn inline style includes interactiveFeedback prelude", () => {
		const lines = sourceLines("editor/prompts/instrument-browser-prompt.ts");
		const joined = lines.join("\n");
		// The transparent outline + transition prelude must be present so the
		// hover ring can transition into view. Without it the outline would
		// snap on/off without animation.
		expect(joined).toContain("interactiveFeedback()");
	});
});