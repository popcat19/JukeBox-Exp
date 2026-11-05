// audio-backend.test.ts
//
// Purpose: Verifies AudioBackend play-intent deactivation guard, underrun recovery, and gesture listener re-registration.

import { beforeEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { AudioBackend, type AudioBackendHost } from "../synth/audio-backend";
import { AudioRingBuffer } from "../synth/audio-ring-buffer";

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

const BUFFER = 64;

interface FakeHost extends AudioBackendHost {
	playing: boolean;
	fading: boolean;
	liveEnd: number;
	calls: boolean[];
}

function makeHost(): FakeHost {
	const host: FakeHost = {
		playing: false,
		fading: false,
		liveEnd: 0,
		calls: [],
		synthesize(_l, _r, _n, playSong) {
			host.calls.push(playSong);
		},
		isPlayingSong: () => host.playing,
		isFadingOut: () => host.fading,
		liveInputEndTime: () => host.liveEnd,
		spectrumEnabled: false,
		onSpectrumUpdate: undefined,
		onSpectrumReset: undefined,
		anticipatePoorPerformance: false,
		preferLowerLatency: false,
	};
	return host;
}

interface Internals {
	_ringBuffer: AudioRingBuffer | null;
	_currentBufferSize: number;
	_useSab: boolean;
	audioCtx: unknown;
	_fillAllFreeSlotsInternal(host: AudioBackendHost, skip: boolean, reason: string): void;
	_ensureGestureListener(): void;
	_gestureListenerAdded: boolean;
}

function makeBackend(): { backend: AudioBackend; internals: Internals; ring: AudioRingBuffer } {
	const backend = new AudioBackend();
	const internals = backend as unknown as Internals;
	const ring = new AudioRingBuffer(8, BUFFER);
	internals._ringBuffer = ring;
	internals._currentBufferSize = BUFFER;
	internals._useSab = true;
	return { backend, internals, ring };
}

describe("play intent deactivation guard", () => {
	test("idle host with no intent deactivates", () => {
		const { internals } = makeBackend();
		const host = makeHost();
		internals._fillAllFreeSlotsInternal(host, false, "raf");
		expect(internals._currentBufferSize).toBe(0);
		expect(host.calls).toEqual([]);
	});

	test("pending play intent blocks deactivation before isPlayingSong is true", () => {
		const { backend, internals } = makeBackend();
		const host = makeHost();
		backend.beginPlayIntent();
		expect(backend.shouldDeactivate(host)).toBe(false);
		internals._fillAllFreeSlotsInternal(host, false, "need-data");
		expect(internals._currentBufferSize).toBe(BUFFER);
	});

	test("grace window after settle blocks deactivation, then expires", () => {
		const { backend } = makeBackend();
		const host = makeHost();
		backend.beginPlayIntent();
		backend.settlePlayIntent();
		expect(backend.hasPlayIntent).toBe(false);
		expect(backend.shouldDeactivate(host)).toBe(false);
		const realNow = performance.now.bind(performance);
		performance.now = () => realNow() + AudioBackend.PLAY_GRACE_MS + 1;
		try {
			expect(backend.shouldDeactivate(host)).toBe(true);
		} finally {
			performance.now = realNow;
		}
	});

	test("cancelPlayIntent drops intent and grace at once", () => {
		const { backend } = makeBackend();
		const host = makeHost();
		backend.beginPlayIntent();
		backend.cancelPlayIntent();
		expect(backend.shouldDeactivate(host)).toBe(true);
	});

	test("playing, fading and live input each keep the backend alive", () => {
		const { backend } = makeBackend();
		const host = makeHost();
		host.playing = true;
		expect(backend.shouldDeactivate(host)).toBe(false);
		host.playing = false;
		host.fading = true;
		expect(backend.shouldDeactivate(host)).toBe(false);
		host.fading = false;
		host.liveEnd = performance.now() + 10000;
		expect(backend.shouldDeactivate(host)).toBe(false);
	});
});

describe("underrun recovery", () => {
	test("refills every free slot synchronously without resetting heads and counts", () => {
		const { backend, ring } = makeBackend();
		const host = makeHost();
		host.playing = true;
		ring.publishWriteHead(2);
		ring.publishReadHead(1);
		backend.recoverFromUnderrun(host);
		expect(backend.underrunRecoveries).toBe(1);
		expect(ring.loadReadHead()).toBe(1);
		expect(ring.loadWriteHead()).toBe(1 + 7);
		expect(host.calls.length).toBe(6);
		expect(host.calls.every((p) => p)).toBe(true);
	});

	test("idle backend counts the underrun but renders nothing", () => {
		const { backend, ring } = makeBackend();
		const host = makeHost();
		const initialWrite = ring.loadWriteHead();
		backend.recoverFromUnderrun(host);
		expect(backend.underrunRecoveries).toBe(1);
		expect(ring.loadWriteHead()).toBe(initialWrite);
		expect(host.calls).toEqual([]);
	});

	test("pending play intent allows recovery before isPlayingSong", () => {
		const { backend, ring } = makeBackend();
		const host = makeHost();
		const initialWrite = ring.loadWriteHead();
		backend.beginPlayIntent();
		backend.recoverFromUnderrun(host);
		expect(ring.loadWriteHead()).toBe(initialWrite + 7);
	});

	test("queue mode counts but does not touch a ring", () => {
		const { backend, internals } = makeBackend();
		internals._useSab = false;
		const host = makeHost();
		host.playing = true;
		backend.recoverFromUnderrun(host);
		expect(backend.underrunRecoveries).toBe(1);
		expect(host.calls).toEqual([]);
	});
});

describe("gesture listener", () => {
	let added: string[];
	let removed: string[];
	let realAdd: typeof window.addEventListener;
	let realRemove: typeof window.removeEventListener;

	beforeEach(() => {
		added = [];
		removed = [];
		realAdd = window.addEventListener.bind(window);
		realRemove = window.removeEventListener.bind(window);
		window.addEventListener = ((t: string) => {
			added.push(t);
		}) as typeof window.addEventListener;
		window.removeEventListener = ((t: string) => {
			removed.push(t);
		}) as typeof window.removeEventListener;
	});

	test("re-registers after a gesture fired and the context suspended again", () => {
		const { internals } = makeBackend();
		let resumes = 0;
		const ctx = {
			state: "suspended",
			resume: () => {
				resumes++;
				return Promise.resolve();
			},
		};
		internals.audioCtx = ctx;
		try {
			internals._ensureGestureListener();
			internals._ensureGestureListener();
			expect(added).toEqual(["click", "keydown"]);
			expect(internals._gestureListenerAdded).toBe(true);
			internals._ensureGestureListener();
			expect(added.length).toBe(2);
		} finally {
			window.addEventListener = realAdd;
			window.removeEventListener = realRemove;
		}
		expect(resumes).toBe(0);
	});

	test("firing the listener clears the flag so a later suspend registers again", () => {
		const { internals } = makeBackend();
		const handlers: Array<() => void> = [];
		window.addEventListener = ((_t: string, h: () => void) => {
			handlers.push(h);
		}) as typeof window.addEventListener;
		const ctx = { state: "suspended", resume: () => Promise.resolve() };
		internals.audioCtx = ctx;
		try {
			internals._ensureGestureListener();
			handlers[0]();
			expect(internals._gestureListenerAdded).toBe(false);
			expect(removed).toEqual(["click", "keydown"]);
			internals._ensureGestureListener();
			expect(handlers.length).toBe(4);
		} finally {
			window.addEventListener = realAdd;
			window.removeEventListener = realRemove;
		}
	});
});
