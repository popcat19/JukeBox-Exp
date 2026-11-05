// song-import-state.test.ts
//
// Purpose: Verifies ChangeSong leaves cursor, selection, scroll and per-channel instrument state consistent after import and rollback.

import { describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { ChangeSong } from "../editor/changes";
import { SongDocument } from "../editor/song-document";

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

function makeHash(channels: number, bars: number): string {
	const doc = new SongDocument();
	doc.song.barCount = bars;
	doc.song.pitchChannelCount = channels;
	doc.song.noiseChannelCount = 0;
	doc.song.modChannelCount = 0;
	doc.song.channels.length = channels;
	return doc.song.toBase64String();
}

function dirty(): SongDocument {
	const doc = new SongDocument();
	doc.bar = 7;
	doc.channel = 3;
	doc.viewedInstrument[3] = 1;
	doc.recentPatternInstruments[3] = [1];
	doc.barScrollPos = 5;
	doc.channelScrollPos = 2;
	doc.synth.goToBar(7);
	doc.selection.boxSelectionX0 = 6;
	doc.selection.boxSelectionX1 = 7;
	return doc;
}

function expectReset(doc: SongDocument): void {
	const channels = doc.song.channels.length;
	expect(doc.bar).toBe(0);
	expect(doc.channel).toBe(0);
	expect(doc.synth.playhead).toBe(0);
	expect(doc.barScrollPos).toBe(0);
	expect(doc.channelScrollPos).toBe(0);
	expect(doc.selection.boxSelectionX0).toBe(0);
	expect(doc.selection.boxSelectionX1).toBe(0);
	expect(doc.selection.boxSelectionY0).toBe(0);
	expect(doc.selection.boxSelectionY1).toBe(0);
	expect(doc.viewedInstrument).toEqual(new Array(channels).fill(0));
	expect(doc.recentPatternInstruments).toEqual(
		Array.from({ length: channels }, () => [0]),
	);
}

describe("ChangeSong import state", () => {
	test("smaller song resets cursor, selection, scroll and instrument state", () => {
		const doc = dirty();
		doc.record(new ChangeSong(doc, makeHash(2, 2)), false, true);
		expect(doc.song.channels.length).toBe(2);
		expect(doc.song.barCount).toBe(2);
		expectReset(doc);
	});

	test("same-shape song resets state too", () => {
		const doc = dirty();
		const shape = doc.song.toBase64String();
		doc.record(new ChangeSong(doc, shape), false, true);
		expect(doc.song.channels.length).toBe(
			new SongDocument().song.channels.length,
		);
		expectReset(doc);
	});

	test("failing import restores previous state", () => {
		const doc = dirty();
		const oldSong = doc.song;
		const oldViewed = doc.viewedInstrument.slice();
		const oldRecent = doc.recentPatternInstruments.map((r) => r.slice());
		const ok = makeHash(2, 2);
		const original = doc.notifier.changed.bind(doc.notifier);
		doc.notifier.changed = () => {
			throw new Error("boom");
		};
		expect(() => new ChangeSong(doc, ok)).toThrow("boom");
		doc.notifier.changed = original;
		expect(doc.song).toBe(oldSong);
		expect(doc.bar).toBe(7);
		expect(doc.channel).toBe(3);
		expect(doc.barScrollPos).toBe(5);
		expect(doc.channelScrollPos).toBe(2);
		expect(doc.selection.boxSelectionX0).toBe(6);
		expect(doc.selection.boxSelectionX1).toBe(7);
		expect(doc.viewedInstrument).toEqual(oldViewed);
		expect(doc.recentPatternInstruments).toEqual(oldRecent);
	});
});
