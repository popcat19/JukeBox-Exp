// dom-hooks.test.ts
//
// Purpose: Guard that published editor and prompt DOM hooks stay declared in source
//
// This module:
// - Statically asserts editor mount, prompt shell, lifecycle, popout, and interaction hooks
// - Fails when a published hook literal is removed or renamed

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

function read(path: string): string {
	return readFileSync(path, "utf8");
}

function stripLineComments(source: string): string {
	return source
		.split("\n")
		.filter((line) => !line.trimStart().startsWith("//"))
		.join("\n");
}

function stripBlockComments(source: string): string {
	return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

function assertLiteral(path: string, literal: string): void {
	const source = stripBlockComments(stripLineComments(read(path)));
	expect(source.includes(literal)).toBeTrue();
}

describe("editor and prompt DOM hooks", () => {
	test("editor mount and shell hooks stay declared", () => {
		assertLiteral("editor/song-editor.ts", '"beepboxEditor"');
		assertLiteral("editor/main.ts", '"beepboxEditorContainer"');
		assertLiteral("editor/song-editor.ts", '"promptContainer"');
	});

	test("editor grid and component layout hooks stay declared", () => {
		assertLiteral("editor/song-editor.ts", '"pattern-area"');
		assertLiteral("editor/song-editor.ts", '"song-settings-area"');
		assertLiteral("editor/song-editor.ts", '"instrument-settings-area"');
		assertLiteral("editor/song-editor.ts", '"trackAndMuteContainer"');
		assertLiteral("editor/components/bar-scroll-bar.ts", '"barScrollBar"');
		assertLiteral("editor/components/track-editor.ts", '"noSelection"');
	});

	test("prompt structural and focus hooks stay declared", () => {
		assertLiteral("editor/components/spectrum-editor.ts", '"prompt graphEditorPrompt noSelection"');
		assertLiteral("editor/core/prompt-manager.ts", 'classList.add("focused")');
		assertLiteral("editor/core/prompt-dock.ts", 'classList.add("docked")');
	});

	test("prompt lifecycle classes remain non-animated hooks", () => {
		// PMD forbids transitions and animations. The .entering, .exiting, and
		// .refocus hooks survive in CSS only to pin them to `animation: none`,
		// so a future edit cannot quietly reintroduce motion here.
		assertLiteral("editor/rendering/styles/animations.ts", ".prompt.entering");
		assertLiteral("editor/rendering/styles/animations.ts", ".prompt.exiting");
		assertLiteral("editor/rendering/styles/animations.ts", ".prompt.refocus");
	});

	test("prompt popout, PMD role, and scrollbar hooks stay declared", () => {
		assertLiteral("editor/core/prompt-popout.ts", 'dataset.popout = "true"');
		assertLiteral("editor/core/prompt-popout.ts", 'removeAttribute("data-popout")');
		assertLiteral("editor/ui/interactions.ts", "dataset.pmdRole");
		assertLiteral("editor/rendering/style.ts", 'classList.add("obtrusive-scrollbars")');
	});
});

describe("player DOM hooks", () => {
	test("player root and key element class hooks stay declared", () => {
		assertLiteral("player/player-ui.ts", '"pm-player"');
		assertLiteral("player/player-ui.ts", '"pm-player-spectrum"');
		assertLiteral("player/player-ui.ts", '"pm-player-play-btn"');
		assertLiteral("player/player-ui.ts", '"pm-player-timeline"');
		assertLiteral("player/player-ui.ts", '"pm-player-playhead"');
		assertLiteral("player/player-ui.ts", '"pm-player-control-bar"');
		assertLiteral("player/player-ui.ts", '"pm-player-viz-container"');
	});

	test("player root appends to document body without a container element", () => {
		assertLiteral("player/player-ui.ts", 'document.body.appendChild');
	});
});
