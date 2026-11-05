// stress-pane-lifecycle.test.ts
//
// Purpose: Verifies Navigator stress panes release deferred browser work on disposal.

import { frameScheduler } from "../editor/core/frame-scheduler";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { Window } from "happy-dom";
import { ColorConfig } from "../shared/color-config";
import type { PromptEditorRefs } from "../editor/core/prompt-manager";
import { AddSamplesPrompt } from "../editor/prompts/add-samples-prompt";
import { ChannelVolumeVisualizerPrompt } from "../editor/prompts/channel-volume-visualizer-prompt";
import { InstrumentBrowserPrompt } from "../editor/prompts/instrument-browser-prompt";
import { LimiterPrompt } from "../editor/prompts/limiter-prompt";
import { SongDocument } from "../editor/song-document";

let registeredHappyDom = false;
let originalMutationObserver: typeof MutationObserver;
let originalResizeObserver: typeof ResizeObserver;

beforeAll(() => {
	if (!GlobalRegistrator.isRegistered) {
		GlobalRegistrator.register();
		registeredHappyDom = true;
	}
	originalMutationObserver = globalThis.MutationObserver;
	originalResizeObserver = globalThis.ResizeObserver;
	frameScheduler.configure(
		() => 0,
		() => {},
	);
});

afterAll(() => {
	frameScheduler.configure();
	globalThis.MutationObserver = originalMutationObserver;
	globalThis.ResizeObserver = originalResizeObserver;
	if (registeredHappyDom) GlobalRegistrator.unregister();
});

interface FrameLedger {
	readonly pending: Map<number, FrameRequestCallback>;
	take(): FrameRequestCallback;
	restore(): void;
}

function installFrames(owner: globalThis.Window): FrameLedger {
	let nextId = 1;
	const pending = new Map<number, FrameRequestCallback>();
	const request = owner.requestAnimationFrame;
	const cancel = owner.cancelAnimationFrame;
	owner.requestAnimationFrame = ((callback: FrameRequestCallback): number => {
		const id = nextId++;
		pending.set(id, callback);
		return id;
	}) as typeof owner.requestAnimationFrame;
	owner.cancelAnimationFrame = ((id: number): void => {
		pending.delete(id);
	}) as typeof owner.cancelAnimationFrame;
	return {
		pending,
		take: () => {
			const callback = Array.from(pending.values())[0];
			if (callback === undefined) throw new Error("expected pending frame");
			return callback;
		},
		restore: () => {
			owner.requestAnimationFrame = request;
			owner.cancelAnimationFrame = cancel;
		},
	};
}

interface TimerLedger {
	readonly pending: Map<number, () => void>;
	flush(): void;
	restore(): void;
}

function installTimers(): TimerLedger {
	let nextId = 1;
	const pending = new Map<number, () => void>();
	const originalSetTimeout = globalThis.setTimeout;
	const originalClearTimeout = globalThis.clearTimeout;
	globalThis.setTimeout = ((callback: TimerHandler): number => {
		const id = nextId++;
		if (typeof callback === "function") pending.set(id, callback as () => void);
		return id;
	}) as typeof setTimeout;
	globalThis.clearTimeout = ((id: number): void => {
		pending.delete(id);
	}) as typeof clearTimeout;
	return {
		pending,
		flush: () => {
			const callbacks = Array.from(pending.values());
			pending.clear();
			for (const callback of callbacks) callback();
		},
		restore: () => {
			globalThis.setTimeout = originalSetTimeout;
			globalThis.clearTimeout = originalClearTimeout;
		},
	};
}

interface ObserverLedger {
	readonly active: Set<FakeObserver>;
	readonly mutations: FakeObserver[];
	restore(): void;
}

class FakeObserver {
	public active = true;
	private readonly deliver: () => void;
	constructor(callback: () => void) {
		this.deliver = callback;
	}
	readonly callback = (): void => {
		if (this.active) this.deliver();
	};
	observe(): void {}
	disconnect(): void { this.active = false; }
	takeRecords(): MutationRecord[] { return []; }
	unobserve(): void {}
}

function installObservers(): ObserverLedger {
	const active = new Set<FakeObserver>();
	const mutations: FakeObserver[] = [];
	class FakeMutationObserver extends FakeObserver {
		constructor(callback: MutationCallback) {
			super(() => { callback([], this as unknown as MutationObserver); });
			active.add(this);
			mutations.push(this);
		}
		override disconnect(): void { super.disconnect(); active.delete(this); }
	}
	class FakeResizeObserver extends FakeObserver {
		constructor(callback: ResizeObserverCallback) {
			super(() => { callback([], this as unknown as ResizeObserver); });
			active.add(this);
		}
		override disconnect(): void { super.disconnect(); active.delete(this); }
	}
	globalThis.MutationObserver = FakeMutationObserver as unknown as typeof MutationObserver;
	globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
	return {
		active,
		mutations,
		restore: () => {
			globalThis.MutationObserver = originalMutationObserver;
			globalThis.ResizeObserver = originalResizeObserver;
		},
	};
}

function editorRefs(): PromptEditorRefs {
	return {
		togglePlay: () => {},
		muteEditor: { setHoveredChannel: () => {} },
		trackEditor: { setHoveredChannel: () => {} },
		drumsetSpectrumEditors: [],
		patternEditor: {} as PromptEditorRefs["patternEditor"],
		trackArea: document.createElement("div"),
		handleImportFile: () => {},
	};
}

function transfer(element: HTMLElement, destination: globalThis.Window): void {
	destination.document.body.append(destination.document.adoptNode(element));
}

describe("Navigator stress pane lifecycle", () => {
	test("repeated Limiter cleanup owns one frame and rejects stale callbacks", () => {
		const owner = document.defaultView as unknown as globalThis.Window;
		const docs = [new SongDocument(), new SongDocument(), new SongDocument()];
		const frames = installFrames(owner);
		const timers = installTimers();
		let prompt: LimiterPrompt | null = null;
		let finalFrames = -1;
		let finalTimers = -1;
		try {
			for (let iteration = 0; iteration < docs.length; iteration++) {
				const doc = docs[iteration];
				if (doc === undefined) throw new Error("Limiter document missing");
				prompt = new LimiterPrompt(doc, editorRefs());
				expect(frames.pending.size).toBe(1);
				expect(timers.pending.size).toBe(1);
				timers.flush();
				expect(timers.pending.size).toBe(0);
				expect(frames.pending.size).toBe(1);
				document.body.append(prompt.container);
				expect(frames.pending.size).toBe(1);

				if (iteration === 0) {
					const live = frames.take();
					const liveId = Array.from(frames.pending.keys())[0];
					if (liveId === undefined) throw new Error("live frame id missing");
					frames.pending.delete(liveId);
					doc.song.inVolumeCap = 0.5;
					live(0);
					expect(frames.pending.size).toBe(1);
					const inputBar = prompt.container.querySelector<SVGRectElement>("rect[y='105%'][fill^='url']");
					expect(inputBar?.getAttribute("width")).toBe("50");
				}

				const stale = frames.take();
				prompt.cleanUp();
				expect(frames.pending.size).toBe(0);
				stale(0);
				expect(frames.pending.size).toBe(0);
				expect(timers.pending.size).toBe(0);
				prompt.container.remove();
				prompt = null;
			}
		} finally {
			try {
				prompt?.cleanUp();
				prompt?.container.remove();
			} finally {
				finalFrames = frames.pending.size;
				finalTimers = timers.pending.size;
				timers.restore();
				frames.restore();
			}
		}
		expect(finalFrames).toBe(0);
		expect(finalTimers).toBe(0);
	});

	test("Add Samples transfers one owned scroll frame between windows", () => {
		const source = document.defaultView as unknown as globalThis.Window;
		const destination = new Window() as unknown as globalThis.Window;
		const doc = new SongDocument();
		const sourceFrames = installFrames(source);
		const destinationFrames = installFrames(destination);
		const timers = installTimers();
		let prompt: AddSamplesPrompt | null = null;
		let finalSourceFrames = -1;
		let finalDestinationFrames = -1;
		let finalTimers = -1;
		try {
			prompt = new AddSamplesPrompt(doc);
			document.body.append(prompt.container);
			expect(timers.pending.size).toBeGreaterThan(0);
			const add = Array.from(prompt.container.querySelectorAll("button")).find(
				(button) => button.textContent === "Add sample",
			);
			if (add === undefined) throw new Error("Add sample button missing");
			add.click();
			expect(sourceFrames.pending.size).toBe(1);
			const stale = sourceFrames.take();
			prompt.suspendPane();
			expect(sourceFrames.pending.size).toBe(0);
			const focusBeforeTimer = document.activeElement;
			timers.flush();
			expect(document.activeElement).toBe(focusBeforeTimer);
			transfer(prompt.container, destination);
			prompt.resumePane();
			expect(destinationFrames.pending.size).toBe(1);
			stale(0);
			expect(sourceFrames.pending.size).toBe(0);
			expect(destinationFrames.pending.size).toBe(1);
		} finally {
			try {
				prompt?.cleanUp();
				prompt?.container.remove();
			} finally {
				finalSourceFrames = sourceFrames.pending.size;
				finalDestinationFrames = destinationFrames.pending.size;
				finalTimers = timers.pending.size;
				timers.restore();
				sourceFrames.restore();
				destinationFrames.restore();
			}
		}
		expect(finalSourceFrames).toBe(0);
		expect(finalDestinationFrames).toBe(0);
		expect(finalTimers).toBe(0);
	});

	test("Instrument Browser transfers one info frame and rejects stale callback", () => {
		const source = document.defaultView as unknown as globalThis.Window;
		const destination = new Window() as unknown as globalThis.Window;
		const doc = new SongDocument();
		doc.record = (() => {}) as typeof doc.record;
		const sourceFrames = installFrames(source);
		const destinationFrames = installFrames(destination);
		const timers = installTimers();
		let prompt: InstrumentBrowserPrompt | null = null;
		let finalSourceFrames = -1;
		let finalDestinationFrames = -1;
		let finalTimers = -1;
		try {
			prompt = new InstrumentBrowserPrompt(doc);
			document.body.append(prompt.container);
			expect(timers.pending.size).toBeGreaterThan(0);
			const internal = prompt as unknown as {
				_clickTarget: string | null;
				_clickTimer: ReturnType<typeof setTimeout> | null;
				_commitTooltip: HTMLDivElement;
				_commitTooltipTimer: ReturnType<typeof setTimeout> | null;
				_presetItems: HTMLDivElement[];
				_selectedPresetIndex: number;
				_handleItemClick(target: "cat" | "preset", index: number): void;
			};
			const nextPreset =
				(internal._selectedPresetIndex + 1) % Math.max(1, internal._presetItems.length);
			internal._handleItemClick("preset", nextPreset);
			internal._handleItemClick("preset", nextPreset);
			internal._handleItemClick("preset", internal._selectedPresetIndex);
			expect(internal._commitTooltip.style.display).toBe("block");
			expect(internal._clickTimer).not.toBeNull();
			expect(internal._commitTooltipTimer).not.toBeNull();
			const staleTimers = Array.from(timers.pending.values());
			const presetPane = prompt.container.querySelector<HTMLElement>(".presetListPane");
			if (presetPane === null) throw new Error("preset pane missing");
			presetPane.dispatchEvent(new MouseEvent("mouseenter"));
			expect(sourceFrames.pending.size).toBe(1);
			const stale = sourceFrames.take();
			prompt.suspendPane();
			expect(sourceFrames.pending.size).toBe(0);
			expect(internal._clickTimer).toBeNull();
			expect(internal._clickTarget).toBeNull();
			expect(internal._commitTooltipTimer).toBeNull();
			expect(internal._commitTooltip.style.display).toBe("none");
			const focusBeforeTimer = document.activeElement;
			timers.flush();
			for (const callback of staleTimers) callback();
			expect(document.activeElement).toBe(focusBeforeTimer);
			expect(internal._clickTarget).toBeNull();
			expect(internal._commitTooltip.style.display).toBe("none");
			transfer(prompt.container, destination);
			prompt.resumePane();
			expect(destinationFrames.pending.size).toBe(1);
			const before = prompt.container.querySelector(".infoPanelPane")?.textContent;
			stale(0);
			expect(prompt.container.querySelector(".infoPanelPane")?.textContent).toBe(before);
			expect(destinationFrames.pending.size).toBe(1);
		} finally {
			try {
				prompt?.cleanUp();
				prompt?.container.remove();
			} finally {
				finalSourceFrames = sourceFrames.pending.size;
				finalDestinationFrames = destinationFrames.pending.size;
				finalTimers = timers.pending.size;
				timers.restore();
				sourceFrames.restore();
				destinationFrames.restore();
			}
		}
		expect(finalSourceFrames).toBe(0);
		expect(finalDestinationFrames).toBe(0);
		expect(finalTimers).toBe(0);
	});

	test("CVV transfer generation rejects old frame and releases drag and observers", () => {
		const source = document.defaultView as unknown as globalThis.Window;
		const destination = new Window() as unknown as globalThis.Window;
		const doc = new SongDocument();
		const sourceFrames = installFrames(source);
		const destinationFrames = installFrames(destination);
		const timers = installTimers();
		const observers = installObservers();
		const pointerListeners = new Set<EventListenerOrEventListenerObject>();
		const originalAdd = source.addEventListener.bind(source);
		const originalRemove = source.removeEventListener.bind(source);
		source.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
			if (type === "pointermove" || type === "pointerup") pointerListeners.add(listener);
			originalAdd(type, listener, options);
		}) as typeof source.addEventListener;
		source.removeEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) => {
			if (type === "pointermove" || type === "pointerup") pointerListeners.delete(listener);
			originalRemove(type, listener, options);
		}) as typeof source.removeEventListener;
		const getChannelColor = ColorConfig.getChannelColor;
		const getComputedChannelColor = ColorConfig.getComputedChannelColor;
		ColorConfig.getChannelColor = ((_song, channel) => ({ index: channel, name: String(channel), primaryChannel: "#fff", secondaryChannel: "#888", primaryNote: "#fff", secondaryNote: "#888" })) as typeof ColorConfig.getChannelColor;
		ColorConfig.getComputedChannelColor = ColorConfig.getChannelColor;
		let prompt: ChannelVolumeVisualizerPrompt | null = null;
		let finalPointers = -1;
		let finalObservers = -1;
		let finalSourceFrames = -1;
		let finalDestinationFrames = -1;
		let finalTimers = -1;
		try {
			prompt = new ChannelVolumeVisualizerPrompt(doc, editorRefs());
			document.body.append(prompt.container);
			expect(timers.pending.size).toBeGreaterThan(0);
			expect(sourceFrames.pending.size).toBe(1);
			const stale = sourceFrames.take();
			const channelsPane = prompt.container.querySelector<HTMLElement>(".cvvChannelsPane");
			expect(channelsPane?.style.overflowY).toBe("auto");
			const scrub = prompt.container.querySelector<HTMLElement>("[style*='touch-action: none']");
			if (scrub === null) throw new Error("scrub missing");
			scrub.dispatchEvent(new PointerEvent("pointerdown", { clientX: 1, bubbles: true }));
			expect(pointerListeners.size).toBe(2);
			prompt.suspendPane();
			expect(sourceFrames.pending.size).toBe(0);
			expect(pointerListeners.size).toBe(0);
			const focusBeforeTimer = document.activeElement;
			timers.flush();
			expect(document.activeElement).toBe(focusBeforeTimer);
			transfer(prompt.container, destination);
			prompt.resumePane();
			expect(destinationFrames.pending.size).toBe(1);
			const popoutObserver = observers.mutations[0];
			if (popoutObserver === undefined) throw new Error("popout observer missing");
			popoutObserver.callback();
			expect(destinationFrames.pending.size).toBe(1);
			stale(0);
			expect(destinationFrames.pending.size).toBe(1);
		} finally {
			try {
				prompt?.cleanUp();
				prompt?.container.remove();
			} finally {
				finalPointers = pointerListeners.size;
				finalObservers = observers.active.size;
				finalSourceFrames = sourceFrames.pending.size;
				finalDestinationFrames = destinationFrames.pending.size;
				finalTimers = timers.pending.size;
				source.addEventListener = originalAdd;
				source.removeEventListener = originalRemove;
				ColorConfig.getChannelColor = getChannelColor;
				ColorConfig.getComputedChannelColor = getComputedChannelColor;
				observers.restore();
				timers.restore();
				sourceFrames.restore();
				destinationFrames.restore();
			}
		}
		expect(finalPointers).toBe(0);
		expect(finalObservers).toBe(0);
		expect(finalSourceFrames).toBe(0);
		expect(finalDestinationFrames).toBe(0);
		expect(finalTimers).toBe(0);
	});
});
