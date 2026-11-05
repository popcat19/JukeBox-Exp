// limiter-prompt.test.ts
//
// Purpose: Verifies LimiterPrompt PMD controls, transactions, ownership, and layout contracts.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { Window } from "happy-dom";
import type { PromptEditorRefs } from "../editor/core/prompt-manager";
import { closePromptFromContextMenu } from "../editor/core/prompt-manager";
import { createPromptPaneOwner } from "../editor/navigator/prompt-pane-owner";
import {
	limiterValueCodecs,
	LimiterPrompt,
} from "../editor/prompts/limiter-prompt";
import {
	buildPromptLimiterCSS,
	getLimiterLayoutContract,
} from "../editor/rendering/styles/prompt-limiter";
import { SongDocument } from "../editor/song-document";
import type { Slider } from "../editor/ui";

let registeredHappyDom = false;

beforeAll(() => {
	if (!GlobalRegistrator.isRegistered) {
		GlobalRegistrator.register();
		registeredHappyDom = true;
	}
});

afterAll(() => {
	if (registeredHappyDom) GlobalRegistrator.unregister();
});

interface FrameLedger {
	readonly pending: Map<number, FrameRequestCallback>;
	readonly cancelled: Map<number, FrameRequestCallback>;
	restore(): void;
}

function installFrames(owner: globalThis.Window = window): FrameLedger {
	let nextId = 1;
	const pending = new Map<number, FrameRequestCallback>();
	const cancelled = new Map<number, FrameRequestCallback>();
	const request = owner.requestAnimationFrame;
	const cancel = owner.cancelAnimationFrame;
	owner.requestAnimationFrame = ((callback: FrameRequestCallback): number => {
		const id = nextId++;
		pending.set(id, callback);
		return id;
	}) as typeof owner.requestAnimationFrame;
	owner.cancelAnimationFrame = ((id: number): void => {
		const callback = pending.get(id);
		if (callback !== undefined) cancelled.set(id, callback);
		pending.delete(id);
	}) as typeof owner.cancelAnimationFrame;
	return {
		pending,
		cancelled,
		restore: () => {
			owner.requestAnimationFrame = request;
			owner.cancelAnimationFrame = cancel;
		},
	};
}

function editorRefs(togglePlay: () => void = () => {}): PromptEditorRefs {
	return {
		togglePlay,
		muteEditor: { setHoveredChannel: () => {} },
		trackEditor: { setHoveredChannel: () => {} },
		drumsetSpectrumEditors: [],
		patternEditor: {} as PromptEditorRefs["patternEditor"],
		trackArea: document.createElement("div"),
		handleImportFile: () => {},
	};
}

function setPosition(control: Slider, position: number): void {
	control.input.value = String(position);
	control.input.dispatchEvent(new Event("input", { bubbles: true }));
}

function withPrompt(run: (prompt: LimiterPrompt, doc: SongDocument, frames: FrameLedger) => void): void {
	const doc = new SongDocument();
	const frames = installFrames();
	const prompt = new LimiterPrompt(doc, editorRefs());
	document.body.append(prompt.container);
	try {
		run(prompt, doc, frames);
	} finally {
		prompt.cleanUp();
		prompt.container.remove();
		frames.restore();
	}
}

function outputValue(prompt: LimiterPrompt, fieldClass: string): string {
	const value = prompt.container.querySelector<HTMLOutputElement>(`.${fieldClass} output`);
	if (value === null) throw new Error(`missing output for ${fieldClass}`);
	return value.value;
}

function key(key: string, keyCode: number): KeyboardEvent {
	return new KeyboardEvent("keydown", { key, keyCode, bubbles: true, cancelable: true });
}

describe("LimiterPrompt", () => {
	test("encodes and decodes every integer slider position exactly", () => {
		const cases = [
			[limiterValueCodecs.decay, 17, 17],
			[limiterValueCodecs.rise, 21, 7250],
			[limiterValueCodecs.boostThreshold, 13, 0.65],
			[limiterValueCodecs.cutoffThreshold, 35, 1.75],
			[limiterValueCodecs.boostRatio, 16, 1.1],
			[limiterValueCodecs.cutoffRatio, 20, 11],
			[limiterValueCodecs.masterGain, 117, 2.34],
		] as const;
		for (const [codec, position, value] of cases) {
			expect(codec.decode(position)).toBe(value);
			expect(codec.encode(value)).toBe(position);
		}
	});

	test("maps PMD slider positions to exact model values without preview history", () => {
		withPrompt((prompt, doc) => {
			setPosition(prompt.limitRatioSlider, 20);
			setPosition(prompt.compressionRatioSlider, 16);
			setPosition(prompt.limitThresholdSlider, 35);
			setPosition(prompt.compressionThresholdSlider, 13);
			setPosition(prompt.limitRiseSlider, 21);
			setPosition(prompt.limitDecaySlider, 17);
			setPosition(prompt.masterGainSlider, 117);
			expect(doc.song.limitRatio).toBe(11);
			expect(doc.song.compressionRatio).toBe(1.1);
			expect(doc.song.limitThreshold).toBe(1.75);
			expect(doc.song.compressionThreshold).toBe(0.65);
			expect(doc.song.limitRise).toBe(7250);
			expect(doc.song.limitDecay).toBe(17);
			expect(doc.song.masterGain).toBe(2.34);
			expect(doc._waitingToUpdateState).toBeFalse();
		});
	});

	test("couples thresholds toward the changed control", () => {
		withPrompt((prompt, doc) => {
			setPosition(prompt.compressionThresholdSlider, 22);
			expect(prompt.limitThresholdSlider.input.value).toBe("22");
			expect(doc.song.limitThreshold).toBe(1.1);
			setPosition(prompt.limitThresholdSlider, 8);
			expect(prompt.compressionThresholdSlider.input.value).toBe("8");
			expect(doc.song.compressionThreshold).toBe(0.4);
		});
	});

	test("uses intentional two-decimal ratio display precision", () => {
		withPrompt((prompt) => {
			setPosition(prompt.compressionRatioSlider, 16);
			setPosition(prompt.limitRatioSlider, 5);
			expect(outputValue(prompt, "limiterBoostRatio")).toBe("1.1:1");
			expect(outputValue(prompt, "limiterCutoffRatio")).toBe("0.5:1");
			setPosition(prompt.compressionRatioSlider, 20);
			expect(outputValue(prompt, "limiterBoostRatio")).toBe("1.17:1");
		});
	});

	test("does not rewrite an actively dragged control on unrelated notifications", () => {
		withPrompt((prompt, doc) => {
			prompt.masterGainSlider.container.dispatchEvent(new Event("pointerdown", { bubbles: true }));
			prompt.masterGainSlider.input.value = "200";
			doc.song.title = "unrelated";
			doc.notifier.changed();
			doc.notifier.notifyWatchers();
			expect(prompt.masterGainSlider.input.value).toBe("200");
			prompt.masterGainSlider.container.dispatchEvent(new Event("pointerup", { bubbles: true }));
			doc.notifier.changed();
			doc.notifier.notifyWatchers();
			expect(prompt.masterGainSlider.input.value).toBe("50");
		});
	});

	test("Escape closes through authority and rollback stays idempotent", () => {
		const doc = new SongDocument();
		const frames = installFrames();
		doc.song.masterGain = 1.7;
		const prompt = new LimiterPrompt(doc, editorRefs());
		let closes = 0;
		prompt.closeCallback = (candidate) => {
			closes++;
			candidate.discard();
		};
		try {
			setPosition(prompt.masterGainSlider, 200);
			const escape = key("Escape", 27);
			prompt.whenKeyPressed(escape);
			expect(escape.defaultPrevented).toBeTrue();
			expect(closes).toBe(1);
			expect(doc.song.masterGain).toBe(1.7);
			prompt.discard();
			expect(doc.song.masterGain).toBe(1.7);
		} finally {
			prompt.cleanUp();
			frames.restore();
		}
	});

	test("context menu authority and direct discard both rollback previews", () => {
		withPrompt((prompt, doc) => {
			const opening = doc.song.limitDecay;
			setPosition(prompt.limitDecaySlider, 20);
			prompt.closeCallback = (candidate) => { candidate.discard(); };
			closePromptFromContextMenu(new MouseEvent("contextmenu"), prompt, (candidate) => {
				candidate.discard();
			});
			expect(doc.song.limitDecay).toBe(opening);
			prompt.discard();
			expect(doc.song.limitDecay).toBe(opening);
		});
	});

	test("Navigator key ownership toggles Space once", () => {
		const doc = new SongDocument();
		const frames = installFrames();
		let toggles = 0;
		const prompt = new LimiterPrompt(doc, editorRefs(() => toggles++));
		const hostElement = document.createElement("div");
		const host = {
			attach: (root: { element: HTMLElement }) => { hostElement.append(root.element); },
			detach: (root: { element: HTMLElement }) => { root.element.remove(); },
		};
		const owner = createPromptPaneOwner(
			{ paneId: "limiterSettings" },
			prompt,
			() => Promise.resolve(true),
			() => Promise.resolve(),
		);
		try {
			owner.lifecycle.mount(host);
			prompt.container.dispatchEvent(key(" ", 32));
			expect(toggles).toBe(1);
		} finally {
			owner.lifecycle.unmount();
			owner.lifecycle.dispose();
			frames.restore();
		}
	});

	test("records one real browser-history replacement on repeated Commit", () => {
		const doc = new SongDocument();
		const frames = installFrames();
		const prompt = new LimiterPrompt(doc, editorRefs());
		const originalReplace = window.history.replaceState.bind(window.history);
		let replacements = 0;
		window.history.replaceState = ((...args: Parameters<History["replaceState"]>) => {
			replacements++;
			originalReplace(...args);
		}) as History["replaceState"];
		try {
			setPosition(prompt.masterGainSlider, 100);
			const commit = prompt.container.querySelector<HTMLButtonElement>(".okayButton");
			if (commit === null) throw new Error("missing commit button");
			commit.click();
			commit.click();
			const historyFrameId = Math.max(...Array.from(frames.pending.keys()));
			const historyFrame = frames.pending.get(historyFrameId);
			if (historyFrame === undefined) throw new Error("missing history frame");
			frames.pending.delete(historyFrameId);
			historyFrame(0);
			expect(replacements).toBe(1);
			expect(doc.song.masterGain).toBe(2);
			expect(doc._waitingToUpdateState).toBeFalse();
		} finally {
			window.history.replaceState = originalReplace;
			prompt.cleanUp();
			frames.restore();
		}
	});

	test("moves animation ownership and rejects a stale owner-window frame", () => {
		const doc = new SongDocument();
		const mainFrames = installFrames();
		const detached = new Window();
		const detachedOwner = detached as unknown as globalThis.Window;
		const detachedFrames = installFrames(detachedOwner);
		const prompt = new LimiterPrompt(doc, editorRefs());
		try {
			prompt.suspendPane();
			expect(mainFrames.pending.size).toBe(0);
			const detachedBody = detached.document.body as unknown as HTMLBodyElement;
			detachedBody.append(prompt.container);
			prompt.resumePane();
			expect(prompt.container.ownerDocument.defaultView).toBe(
				detachedOwner as Window & typeof globalThis,
			);
			expect(detachedFrames.pending.size).toBe(1);
			const stalePrompt = prompt as unknown as { _volumeUpdate(generation: number): void };
			stalePrompt._volumeUpdate(0);
			expect(mainFrames.pending.size).toBe(0);
			expect(detachedFrames.pending.size).toBe(1);
		} finally {
			prompt.cleanUp();
			mainFrames.restore();
			detachedFrames.restore();
		}
	});

	test("creates concurrent prompts with unique SVG ids", () => {
		const frames = installFrames();
		const first = new LimiterPrompt(new SongDocument(), editorRefs());
		const second = new LimiterPrompt(new SongDocument(), editorRefs());
		try {
			const firstIds = new Set(Array.from(first.container.querySelectorAll("svg [id]")).map((node) => node.id));
			const secondIds = new Set(Array.from(second.container.querySelectorAll("svg [id]")).map((node) => node.id));
			expect(firstIds.size).toBe(3);
			expect(secondIds.size).toBe(3);
			expect(Array.from(firstIds).filter((id) => secondIds.has(id))).toEqual([]);
		} finally {
			first.cleanUp();
			second.cleanUp();
			frames.restore();
		}
	});

	test("builds seven keyboard sliders with one status live region", () => {
		withPrompt((prompt) => {
			const sliders = Array.from(prompt.container.querySelectorAll<HTMLElement>('[role="slider"]'));
			expect(sliders.length).toBe(7);
			expect(prompt.container.querySelectorAll('.limiterSlider[data-dev-component="Slider"]').length).toBe(7);
			expect(prompt.container.querySelectorAll('input[type="range"]').length).toBe(7);
			expect(prompt.container.querySelectorAll('output[aria-live]').length).toBe(0);
			expect(prompt.container.querySelectorAll('[role="status"][aria-live="polite"]').length).toBe(1);
			for (const slider of sliders) {
				const labelId = slider.getAttribute("aria-labelledby");
				expect(labelId === null ? null : prompt.container.querySelector(`#${labelId}`)?.tagName).toBe("LABEL");
				expect(slider.getAttribute("aria-valuenow") === null).toBeFalse();
				expect(slider.tabIndex).toBe(0);
			}
			const commit = prompt.container.querySelector<HTMLButtonElement>(".okayButton");
			const reset = prompt.container.querySelector<HTMLButtonElement>(".limiterReset");
			if (commit === null || reset === null) throw new Error("missing limiter actions");
			expect([prompt._playButton.style.width, commit.style.width, reset.style.width]).toEqual([
				"fit-content",
				"fit-content",
				"fit-content",
			]);
			expect([prompt._playButton.dataset.pmdRole, commit.dataset.pmdRole, reset.dataset.pmdRole]).toEqual([
				"secondary",
				"primary",
				"secondary",
			]);
		});
	});

	test("uses deterministic 320px and 592x551 layout contracts", () => {
		const fixture = document.createElement("div");
		document.body.append(fixture);
		try {
			// happy-dom has no layout engine: browser pixel overflow remains an integration risk.
			expect(fixture.getBoundingClientRect().width).toBe(0);
			const css = buildPromptLimiterCSS();
			expect(css).toMatch(/\.limiterPreview \{[^}]*display: flex[^}]*flex-direction: column[^}]*align-items: stretch/s);
			expect(css).toMatch(/\.limiterGraph \{[^}]*align-self: center[^}]*width: min\(100%, 480px\)/s);
			expect(css).toContain("height: clamp(96px, 18vw, 112px)");
			expect(css).toContain("margin-bottom: clamp(68px, 13vw, 80px)");
			expect(css).not.toContain("min-height: 44px");
			expect(css).not.toContain("flex: 0 0 120px");
			const mobile = getLimiterLayoutContract(320, 551);
			expect(mobile).toEqual({
				promptWidth: 304,
				maxPromptHeight: 535,
				curveColumns: 1,
				timingColumns: 1,
			});
			const desktop = getLimiterLayoutContract(592, 551);
			expect(desktop).toEqual({
				promptWidth: 568,
				maxPromptHeight: 535,
				curveColumns: 2,
				timingColumns: 3,
			});
		} finally {
			fixture.remove();
		}
	});
});
