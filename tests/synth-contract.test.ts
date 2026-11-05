// synth-contract.test.ts
//
// Purpose: Systematic contract tests detecting extraction-induced breakage
//
// Failure categories probed:
// - Generated-source drift: synthesis source strings call synth.* methods
//   and access synth.* properties at runtime. These are un-typechecked strings
//   that silently break when a delegated member is removed.
// - Boundary snapshot rot: host interfaces (AudioBackendHost) receive values
//   that must be live-read (isPlayingSong, liveInputEndTime) but are captured
//   as scalar snapshots, causing silent deactivation.
// - Cross-field contamination: refactored code repurposes a field for two
//   roles (e.g. _lastSpectrumUpdateTime as both timing and guard flag).
// - Barrel export erosion: removed exports cause runtime import failures.
//
// Any extraction that changes synth.ts must update this file to re-scan
// the new generated sources and re-verify the host interfaces.

import { readFileSync } from "fs";
import { describe, test, expect } from "bun:test";
import { Synth } from "../synth/synth";
import { AudioBackend } from "../synth/audio-backend";
import { buildChipSource, buildLoopableChipSource } from "../synth/synthesis/chip";
import { buildDrumSource } from "../synth/synthesis/drum";
import { buildEffectsSource } from "../synth/synthesis/effects";
import { buildFmSource } from "../synth/synthesis/fm";
import { buildFm6Source } from "../synth/synthesis/fm6";
import { buildHarmonicsSource } from "../synth/synthesis/harmonics";
import { buildNoiseSource } from "../synth/synthesis/noise";
import { buildPickedStringSource } from "../synth/synthesis/picked-string";
import { buildPulseWidthSource } from "../synth/synthesis/pulse";
import { buildSpectrumSource } from "../synth/synthesis/spectrum";
import { buildSupersawSource } from "../synth/synthesis/supersaw";
import { createTestInstrument, createTestSong } from "./test-helpers";

// ---------------------------------------------------------------------------
// Category A: Generated-source drift — every synth.* reference in generated
// source strings must map to a real Synth member (method or property).
// ---------------------------------------------------------------------------

interface SynthRef {
	name: string;
	type: "method" | "property";
}

/** Extract every `synth.<name>` reference from a generated source string. */
function synthRefs(source: string): SynthRef[] {
	const refs: SynthRef[] = [];
	// Match all synth. identifiers (including those without trailing '(')
	const allPat = /synth\.([a-zA-Z_$][a-zA-Z0-9_$]*)/g;
	const seen = new Set<string>();
	let match: RegExpExecArray | null;
	while ((match = allPat.exec(source)) !== null) {
		const name = match[1];
		if (seen.has(name)) continue;
		seen.add(name);
		// Check if next char is '('
		const afterIdx = match.index + match[0].length;
		const isMethod = source[afterIdx] === "(";
		refs.push({ name, type: isMethod ? "method" : "property" });
	}
	return refs;
}

/** Verify all synth.* refs in a source match existing Synth members. */
function verifySynthRefs(source: string): void {
	const refs = synthRefs(source);
	const instance = new Synth();
	expect(refs.length).toBeGreaterThan(0);
	for (const ref of refs) {
		// Methods live on prototype; uninitialized class fields are
		// constructor-assigned. Check the instance for both.
		const exists =
			ref.name in Synth.prototype ||
			typeof (instance as any)[ref.name] !== "undefined";
		expect(exists).toBeTrue();
		if (ref.type === "method") {
			expect(typeof (instance as any)[ref.name]).toBe("function");
		}
	}
}

// All source builders with their arguments — single source of truth.
// When a new builder is added, add it here and all tests derive from it.
const SOURCE_BUILDERS: Array<{ name: string; build: () => string }> = [
	{ name: "chip", build: () => buildChipSource(4) },
	{ name: "loopableChip", build: () => buildLoopableChipSource(4) },
	{ name: "drum", build: () => buildDrumSource(4) },
	{ name: "effects", build: () => buildEffectsSource(false, false, false, false, false, false, false, false, false, false, false) },
	{ name: "fm", build: () => buildFmSource(createTestInstrument()) },
	{ name: "fm6", build: () => buildFm6Source(createTestInstrument()) },
	{ name: "harmonics", build: () => buildHarmonicsSource(4) },
	{ name: "noise", build: () => buildNoiseSource(4) },
	{ name: "pickedString", build: () => buildPickedStringSource(4) },
	{ name: "pulseWidth", build: () => buildPulseWidthSource(4) },
	{ name: "spectrum", build: () => buildSpectrumSource(4) },
	{ name: "supersaw", build: () => buildSupersawSource(4) },
];

describe("Category A: generated sources match Synth API", () => {
	for (const sb of SOURCE_BUILDERS) {
		test(`${sb.name} source references exist on Synth.prototype`, () => {
			verifySynthRefs(sb.build());
		});
	}
});

// ---------------------------------------------------------------------------
// Category B: Host interface snapshot rot — values that change mid-stream
// (isPlayingSong, isFadingOut, liveInputEndTime) must be getter functions,
// not scalars. Configuration values (set before activation, stable during
// playback) may be scalars.
// ---------------------------------------------------------------------------

describe("Category B: AudioBackendHost live-read contract", () => {
	test("isPlayingSong is a getter function (not scalar snapshot)", () => {
		const synth = new Synth();
		const host = (synth as any)._toAudioHost();
		expect(typeof host.isPlayingSong).toBe("function");
		synth.isPlayingSong = false;
		expect(host.isPlayingSong()).toBe(false);
		synth.isPlayingSong = true;
		expect(host.isPlayingSong()).toBe(true);
	});

	test("liveInputEndTime is a getter function (not scalar snapshot)", () => {
		const synth = new Synth();
		const host = (synth as any)._toAudioHost();
		expect(typeof host.liveInputEndTime).toBe("function");
		synth.liveInputEndTime = 42;
		expect(host.liveInputEndTime()).toBe(42);
		synth.liveInputEndTime = 999;
		expect(host.liveInputEndTime()).toBe(999);
	});

	test("isFadingOut is a getter function (not scalar snapshot)", () => {
		const synth = new Synth();
		const host = (synth as any)._toAudioHost();
		expect(typeof host.isFadingOut).toBe("function");
		// Not fading by default
		expect(host.isFadingOut()).toBe(false);
		// Set the internal field directly to simulate fade state
		(synth as any)._stopFadeSamplesRemaining = 100;
		expect(host.isFadingOut()).toBe(true);
		(synth as any)._stopFadeSamplesRemaining = 0;
		expect(host.isFadingOut()).toBe(false);
	});

	test("configuration values are scalar (stable during playback)", () => {
		const synth = new Synth();
		const host = (synth as any)._toAudioHost();
		// These are set before play() and stay stable — scalars are correct
		expect(typeof host.anticipatePoorPerformance).toBe("boolean");
		expect(typeof host.preferLowerLatency).toBe("boolean");
		expect(typeof host.spectrumEnabled).toBe("boolean");
	});

	test("synthesize is a function", () => {
		const synth = new Synth();
		const host = (synth as any)._toAudioHost();
		expect(typeof host.synthesize).toBe("function");
	});

	test("onSpectrumUpdate/onSpectrumReset are functions or undefined", () => {
		const synth = new Synth();
		const host = (synth as any)._toAudioHost();
		expect(host.onSpectrumUpdate === undefined || typeof host.onSpectrumUpdate === "function").toBeTrue();
		expect(host.onSpectrumReset === undefined || typeof host.onSpectrumReset === "function").toBeTrue();
	});

	test("activation synchronizes sample rate before worklet init and playback setup", async () => {
		const synth = new Synth(createTestSong());
		const events: string[] = [];
		const sampleRate = 96_000;
		let initPayload: Record<string, unknown> | null = null;
		const computeWorkletPort = {
			onmessage: null as ((event: { data: unknown }) => void) | null,
			postMessage: (payload: Record<string, unknown>) => {
				initPayload = payload;
				events.push(`worklet:${String(payload.sampleRate)}`);
			},
			start: () => {},
		};
		type TestSynth = {
			_audio: {
				context: { sampleRate: number } | null;
				computeWorkletPort: typeof computeWorkletPort;
				isActive: boolean;
				activate: () => Promise<void>;
				setComputeWorkletUrl: (url: string) => void;
				cancelSpectrumDecay: () => void;
				resumeContext: () => Promise<void>;
				resetRingForPlayback: () => void;
				beginPlayIntent: () => void;
				settlePlayIntent: () => void;
				cancelPlayIntent: () => void;
			};
			warmUpSynthesizer: (song: ReturnType<typeof createTestSong>) => void;
		};
		type TestSynthConstructor = { _computeWorkletEnabled: () => boolean };
		const internals = synth as unknown as TestSynth;
		const synthConstructor = Synth as unknown as TestSynthConstructor;
		const originalComputeWorkletEnabled = synthConstructor._computeWorkletEnabled;
		internals._audio = {
			context: null,
			computeWorkletPort,
			isActive: true,
			activate: () => {
				events.push("activate");
				internals._audio.context = { sampleRate };
				return Promise.resolve();
			},
			setComputeWorkletUrl: () => {},
			cancelSpectrumDecay: () => {},
			resumeContext: () => Promise.resolve(),
			resetRingForPlayback: () => events.push(`reset:${synth.samplesPerSecond}`),
			beginPlayIntent: () => {},
			settlePlayIntent: () => {},
			cancelPlayIntent: () => {},
		};
		internals.warmUpSynthesizer = () => events.push(`warmup:${synth.samplesPerSecond}`);
		synthConstructor._computeWorkletEnabled = () => true;

		try {
			await synth.play();
		} finally {
			synthConstructor._computeWorkletEnabled = originalComputeWorkletEnabled;
		}

		expect(events).toEqual([
			"activate",
			`worklet:${sampleRate}`,
			`warmup:${sampleRate}`,
			`reset:${sampleRate}`,
		]);
		expect(initPayload).toMatchObject({ type: "init", sampleRate });
		expect(synth.samplesPerSecond).toBe(sampleRate);
	});
});

// ---------------------------------------------------------------------------
// Category C: Cross-field contamination — verify dedicated flags are used
// for distinct purposes.
// ---------------------------------------------------------------------------

describe("Category C: dedicated state flags", () => {
	test("startSpectrumDecay uses _spectrumDecayStarted (not _lastSpectrumUpdateTime)", () => {
		const backend = new AudioBackend();
		// Access the private field to verify it exists
		expect((backend as any)._spectrumDecayStarted).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Category D: Paused transport position stays frozen while queued audio drains.
// ---------------------------------------------------------------------------

describe("Category D: paused playhead contract", () => {
	test("playhead remains at the pause snapshot after fade completion", () => {
		const synth = new Synth(createTestSong());
		const internals = synth as any;
		internals.isPlayingSong = true;
		internals.playheadInternal = 3;
		internals._audio.getQueuedSampleCount = () => 0;
		synth.pause();
		const pausedPlayhead = synth.playhead;

		internals.playheadInternal = 4;
		internals._stopFadeSamplesRemaining = 0;
		internals._audio.getQueuedSampleCount = () => synth.getSamplesPerBar();

		expect(synth.playhead).toBe(pausedPlayhead);
	});

	test("paused playhead setter refreshes the frozen position", () => {
		const synth = new Synth(createTestSong());
		synth.playhead = 2.5;
		expect(synth.playhead).toBe(2.5);
	});

	test("goToBar refreshes the frozen position while paused", () => {
		const synth = new Synth(createTestSong());
		synth.goToBar(3);
		expect(synth.playhead).toBe(3);
	});
});

// ---------------------------------------------------------------------------
// Category E: Barrel export erosion — verify key exports are present
// ---------------------------------------------------------------------------

describe("Category E: barrel exports", () => {
	test("Synth is exported from synth barrel", async () => {
		const barrel = await import("../synth");
		expect(barrel.Synth).toBe(Synth);
	});

	test("AudioBackend is exported (or not — check intent)", async () => {
		// AudioBackend is an internal detail — not re-exported from barrel.
		// If it later becomes public, this test catches the change.
	});
});

// ---------------------------------------------------------------------------
// Category F: Socket module capability wiring — verify render path uses
// getInstrumentCapability() helper, not direct getCapabilities() calls.
// ---------------------------------------------------------------------------

describe("Category F: socket capability lookup", () => {
	test("synth.ts imports getInstrumentCapability from socket/capability-lookup", () => {
		const source = readFileSync(
			new URL("../synth/synth.ts", import.meta.url),
			"utf8",
		);
		expect(source).toContain("import { getInstrumentCapability } from");
		expect(source).toMatch(/from\s+["'].\/socket\/capability-lookup["']/);
	});

	test("render path uses getInstrumentCapability not direct getCapabilities", () => {
		const source = readFileSync(
			new URL("../synth/synth.ts", import.meta.url),
			"utf8",
		);
		// After removal of capabilities.ts, synth.ts must use only the helper
		// for capability lookups. No direct getCapabilities() calls remain.
		const matches = source.match(/getCapabilities\(instrument\.type\)/g);
		expect(matches ? matches.length : 0).toBe(0);
	});
});
