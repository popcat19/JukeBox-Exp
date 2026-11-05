// note-mutation-fuzz.test.ts
//
// Purpose: Randomized invariant checks for note pin mutations
//
// Applies ChangeNoteLength, ChangePinTime, and ChangePitchBend to random notes
// and asserts pins stay sorted, start at zero, and agree with note start/end.

import { describe, test, expect } from "bun:test";
import {
	ChangeNoteLength,
	ChangeNoteTruncate,
	ChangePinTime,
	ChangePitchBend,
} from "../editor/changes/notes";
import { makeNotePin, Note, Pattern } from "../synth";

function rng(seed: number): () => number {
	let s = seed >>> 0;
	return () => {
		s = (s * 1664525 + 1013904223) >>> 0;
		return s / 4294967296;
	};
}

function randomNote(r: () => number): Note {
	const start = Math.floor(r() * 12);
	const len = 2 + Math.floor(r() * 20);
	const note = new Note(10 + Math.floor(r() * 10), start, start + len, 3);
	const extra = Math.floor(r() * 3);
	const times = new Set<number>();
	for (let i = 0; i < extra; i++) times.add(1 + Math.floor(r() * (len - 1)));
	const pins = [makeNotePin(0, 0, 3)];
	for (const t of [...times].sort((a, b) => a - b)) {
		pins.push(makeNotePin(Math.floor(r() * 7) - 3, t, Math.floor(r() * 4)));
	}
	pins.push(makeNotePin(Math.floor(r() * 7) - 3, len, Math.floor(r() * 4)));
	pins[0].interval = 0;
	note.pins = pins;
	return note;
}

function problems(note: Note): string[] {
	const out: string[] = [];
	const p = note.pins;
	if (p.length < 2) out.push("fewer than 2 pins");
	if (p[0].interval !== 0) out.push("first interval != 0");
	if (p[0].time !== 0) out.push("first time != 0");
	for (let i = 1; i < p.length; i++) if (p[i].time <= p[i - 1].time) out.push("unsorted pins");
	if (note.end - note.start !== p[p.length - 1].time) out.push("end mismatch");
	if (note.start >= note.end) out.push("empty note");
	return out;
}

describe("note pin mutation invariants", () => {
	for (const [name, mutate] of [
		["ChangeNoteLength", (n: Note, r: () => number) => {
			const a = n.start + Math.floor(r() * (n.end - n.start));
			const b = a + 1 + Math.floor(r() * (n.end - a + 2));
			new ChangeNoteLength(null, n, Math.max(a, n.start), Math.min(b, n.end));
		}],
		["ChangePinTime", (n: Note, r: () => number) => {
			const idx = Math.floor(r() * n.pins.length);
			const t = n.start + Math.floor(r() * (n.end - n.start + 1));
			// The editor deletes the note instead of dragging an end pin past the other end.
			if ((t <= n.start && idx === n.pins.length - 1) || (t >= n.end && idx === 0)) return;
			new ChangePinTime(null, n, idx, t, false);
		}],
		["ChangePitchBend", (n: Note, r: () => number) => {
			const a = n.start + Math.floor(r() * (n.end - n.start + 1));
			const b = n.start + Math.floor(r() * (n.end - n.start + 1));
			if (a === b) return;
			new ChangePitchBend(null, n, a, b, n.pitches[0] + Math.floor(r() * 9) - 4, 0);
		}],
	] as const) {
		test(`${name} preserves invariants`, () => {
			const r = rng(12345);
			const bad: string[] = [];
			for (let k = 0; k < 3000; k++) {
				const note = randomNote(r);
				const before = JSON.stringify(note);
				try {
					for (let step = 0; step < 3; step++) mutate(note, r);
				} catch (e) {
					bad.push(`${before} threw ${(e as Error).message}`);
					continue;
				}
				const p = problems(note);
				if (p.length) bad.push(`${before} -> ${JSON.stringify(note)} ${p.join(",")}`);
			}
			expect(bad.slice(0, 5)).toEqual([]);
		});
	}
});

describe("ChangeNoteLength extension", () => {
	test("extending the tail holds the last pin and does not throw", () => {
		const note = new Note(10, 2, 6, 3);
		new ChangeNoteLength(null, note, 2, 10);
		expect(note.start).toBe(2);
		expect(note.end).toBe(10);
		expect(problems(note)).toEqual([]);
	});

	test("extending both ends keeps invariants", () => {
		const r = rng(777);
		for (let k = 0; k < 2000; k++) {
			const note = randomNote(r);
			const s = Math.max(0, note.start - Math.floor(r() * 5));
			const e = note.end + 1 + Math.floor(r() * 5);
			new ChangeNoteLength(null, note, s, e);
			expect(problems(note)).toEqual([]);
			expect(note.start).toBe(s);
			expect(note.end).toBe(e);
		}
	});

	test("truncate then lengthen leaves no overlapping notes", () => {
		const doc: any = {
			notifier: { changed() {} },
			channel: 0,
			song: { getChannelIsMod: () => false },
		};
		const pattern = new Pattern();
		const a = new Note(10, 0, 4, 3);
		const b = new Note(10, 4, 8, 3);
		const c = new Note(10, 8, 12, 3);
		pattern.notes.push(a, b, c);
		new ChangeNoteTruncate(doc, pattern, 4, 10, b);
		new ChangeNoteLength(doc, b, 4, 10);
		for (let i = 1; i < pattern.notes.length; i++) {
			expect(pattern.notes[i].start).toBeGreaterThanOrEqual(pattern.notes[i - 1].end);
		}
		expect(pattern.notes.map((n) => [n.start, n.end])).toEqual([[0, 4], [4, 10], [10, 12]]);
	});
});
