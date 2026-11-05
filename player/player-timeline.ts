// Player Timeline
//
// Purpose: Renders song timeline with notes and playhead
//
// This module:
// - Draws individual note shapes as SVG path data
// - Renders the full timeline with bars, pitch lines, and note elements
// - Renders and animates the playhead position with note flash effects

import { SVG } from "imperative-html/dist/esm/elements-strict";
import { ColorConfig } from "../shared/color-config";
import type { TimelineSurface } from "../shared/timeline-surface";
import type { Note, NotePin, Pattern } from "../synth";
import { Config } from "../synth/synth-config";
import { getLocalStorage } from "./player-ui";

const { rect, path } = SVG;

let timelineWidth: number = 1;
let noteFlashElementsPerBar: SVGPathElement[][];
const currentNoteFlashElements: SVGPathElement[] = [];
let currentNoteFlashBar: number = -1;
const notesFlashWhenPlayed: boolean = getLocalStorage("notesFlashWhenPlayed") === "true";

export function drawNote(
	pitch: number,
	start: number,
	pins: NotePin[],
	radius: number,
	offsetX: number,
	offsetY: number,
	partWidth: number,
	pitchHeight: number,
): string {
	let d: string = `M ${offsetX + partWidth * (start + pins[0].time)} ${offsetY - pitch * pitchHeight + radius * (pins[0].size / Config.noteSizeMax)} `;
	for (let i: number = 0; i < pins.length; i++) {
		const pin: NotePin = pins[i];
		const x: number = offsetX + partWidth * (start + pin.time);
		const y: number = offsetY - pitchHeight * (pitch + pin.interval);
		const expression: number = pin.size / Config.noteSizeMax;
		d += `L ${x} ${y - radius * expression} `;
	}
	for (let i: number = pins.length - 1; i >= 0; i--) {
		const pin: NotePin = pins[i];
		const x: number = offsetX + partWidth * (start + pin.time);
		const y: number = offsetY - pitchHeight * (pitch + pin.interval);
		const expression: number = pin.size / Config.noteSizeMax;
		d += `L ${x} ${y + radius * expression} `;
	}
	return d;
}

export function setTimelineWidth(width: number): void {
	timelineWidth = width;
}

export function getTimelineWidth(): number {
	return timelineWidth;
}

// Invalidate the cached visualizationContainer width so the next
// renderPlayhead re-measures. Call after resize / popout transitions.
export function invalidateVizWidthCache(): void {
	cachedVizWidth = -1;
}

// Generic parameter required so caller can type the array element — not inferable from arguments alone
export function renderTimeline(
	ui: TimelineSurface,
	zoomEnabled: boolean,
	removeFromUnorderedArray: <T>(array: T[], index: number) => void, // eslint-disable-line @typescript-eslint/no-unnecessary-type-parameters
	startBar: number = 0,
	endBar?: number,
	noBackground: boolean = false,
): void {
	ui.timeline.innerHTML = "";
	if (ui.synth.song == null) return;
	// Optional bar window: only note paths inside [barStart, barEnd) are
	// created. Bar lines and octave shading still span the full timeline
	// (cheap rects, keep edge continuity). Callers that want the whole
	// song omit the window.
	const barStart: number = Math.max(0, Math.floor(startBar));
	const barEnd: number = Math.min(ui.synth.song.barCount, endBar ?? ui.synth.song.barCount);

	const boundingRect: ClientRect = ui.visualizationContainer.getBoundingClientRect();

	let timelineHeight: number;
	let windowOctaves: number;
	let windowPitchCount: number;

	if (zoomEnabled) {
		timelineHeight = boundingRect.height;
		windowOctaves = Math.max(
			1,
			Math.min(ui.synth.song.octaveCount, Math.round(timelineHeight / (12 * 2))),
		);
		windowPitchCount = windowOctaves * 12 + 1;
		const semitoneHeight: number = (timelineHeight - 1) / windowPitchCount;
		const targetBeatWidth: number = Math.max(8, semitoneHeight * 4);
		timelineWidth = Math.max(
			boundingRect.width,
			targetBeatWidth * ui.synth.song.barCount * ui.synth.song.beatsPerBar,
		);
	} else {
		timelineWidth = boundingRect.width;
		const targetSemitoneHeight: number = Math.max(
			1,
			timelineWidth / (ui.synth.song.barCount * ui.synth.song.beatsPerBar) / 6.0,
		);
		timelineHeight = Math.min(
			boundingRect.height,
			targetSemitoneHeight * (Config.maxPitch + 1) + 1,
		);
		windowOctaves = Math.max(
			3,
			Math.min(
				ui.synth.song.octaveCount,
				Math.round(timelineHeight / (12 * targetSemitoneHeight)),
			),
		);
		windowPitchCount = windowOctaves * 12 + 1;
	}

	ui.timelineContainer.style.width = `${timelineWidth}px`;
	ui.timelineContainer.style.height = `${timelineHeight}px`;
	ui.timeline.style.width = `${timelineWidth}px`;
	ui.timeline.style.height = `${timelineHeight}px`;

	const barWidth: number = timelineWidth / ui.synth.song.barCount;
	const partWidth: number = barWidth / (ui.synth.song.beatsPerBar * Config.partsPerBeat);

	const wavePitchHeight: number = (timelineHeight - 1) / windowPitchCount;
	const drumPitchHeight: number = (timelineHeight - 1) / Config.drumCount;

	if (!noBackground) {
		for (let bar: number = 0; bar < ui.synth.song.barCount + 1; bar++) {
			const color: string =
				bar === ui.synth.song.loopStart ||
				bar === ui.synth.song.loopStart + ui.synth.song.loopLength
					? ColorConfig.loopAccent
					: ColorConfig.uiWidgetBackground;
			ui.timeline.appendChild(
				rect({
					x: bar * barWidth - 1,
					y: 0,
					width: 2,
					height: timelineHeight,
					fill: color,
				}),
			);
		}

		for (let octave: number = 0; octave <= windowOctaves; octave++) {
			ui.timeline.appendChild(
				rect({
					x: 0,
					y: octave * 12 * wavePitchHeight,
					width: timelineWidth,
					height: wavePitchHeight + 1,
					fill: ColorConfig.tonic,
					opacity: 0.75,
				}),
			);
		}
	}

	// note flash colors
	let noteFlashColor: string = "#ffffff";
	let noteFlashColorSecondary: string = "#ffffff77";
	if (notesFlashWhenPlayed) {
		noteFlashColor = "var(--note-flash)";
		noteFlashColorSecondary = "var(--note-flash-secondary)";
	}

	if (notesFlashWhenPlayed) {
		noteFlashElementsPerBar = [];
		for (let bar: number = 0; bar < ui.synth.song.barCount; bar++) {
			noteFlashElementsPerBar.push([]);
		}
		currentNoteFlashBar = -1;
	}

	for (
		let channel: number = ui.synth.song.channels.length - 1 - ui.synth.song.modChannelCount;
		channel >= 0;
		channel--
	) {
		const isNoise: boolean = ui.synth.song.getChannelIsNoise(channel);
		const pitchHeight: number = isNoise ? drumPitchHeight : wavePitchHeight;

		const configuredOctaveScroll: number = ui.synth.song.channels[channel].octave;
		const newOctaveScroll: number = Math.max(
			0,
			Math.min(
				ui.synth.song.octaveCount - windowOctaves,
				Math.ceil(configuredOctaveScroll - windowOctaves * 0.5),
			),
		);

		const offsetY: number =
			newOctaveScroll * pitchHeight * 12 + timelineHeight - pitchHeight * 0.5 - 0.5;

		for (let bar: number = barStart; bar < barEnd; bar++) {
			const pattern: Pattern | null = ui.synth.song.getPattern(channel, bar);
			if (pattern == null) continue;
			const offsetX: number = bar * barWidth;

			for (let i: number = 0; i < pattern.notes.length; i++) {
				const note: Note = pattern.notes[i];

				for (const pitch of note.pitches) {
					const d: string = drawNote(
						pitch,
						note.start,
						note.pins,
						(pitchHeight + 1) / 2,
						offsetX,
						offsetY,
						partWidth,
						pitchHeight,
					);
					const noteElement: SVGPathElement = path({
						d: d,
						fill: ColorConfig.getChannelColor(ui.synth.song, channel).primaryChannel,
					});
					if (isNoise) noteElement.style.opacity = String(0.6);
					ui.timeline.appendChild(noteElement);

					if (notesFlashWhenPlayed) {
						const dflash: string = drawNote(
							pitch,
							note.start,
							note.pins,
							(pitchHeight + 1) / 2,
							offsetX,
							offsetY,
							partWidth,
							pitchHeight,
						);
						const noteFlashElement: SVGPathElement = path({
							d: dflash,
							fill: isNoise ? noteFlashColorSecondary : noteFlashColor,
						});
						noteFlashElement.style.opacity = "0";
						noteFlashElement.setAttribute("note-start", String(note.start));
						noteFlashElement.setAttribute("note-end", String(note.end));
						noteFlashElement.setAttribute("note-bar", String(bar));
						ui.timeline.appendChild(noteFlashElement);
						const noteFlashElementsForThisBar: SVGPathElement[] =
							noteFlashElementsPerBar[bar];
						noteFlashElementsForThisBar.push(noteFlashElement);
					}
				}
			}
		}
	}

	renderPlayhead(ui, removeFromUnorderedArray);
}

// Cached visualizationContainer width so renderPlayhead avoids a
// per-frame getBoundingClientRect (forced reflow). Invalidated when
// the container width changes, which only happens on resize / popout.
let cachedVizWidth: number = -1;

// Generic parameter required so caller can type the array element — not inferable from arguments alone
export function renderPlayhead(
	ui: TimelineSurface,
	removeFromUnorderedArray: <T>(array: T[], index: number) => void, // eslint-disable-line @typescript-eslint/no-unnecessary-type-parameters
): void {
	if (ui.synth.song != null) {
		const pos: number = ui.synth.playhead / ui.synth.song.barCount;
		ui.playhead.style.left = `${timelineWidth * pos}px`;

		let vizWidth: number = cachedVizWidth;
		if (vizWidth < 0) {
			const boundingRect: ClientRect = ui.visualizationContainer.getBoundingClientRect();
			vizWidth = boundingRect.width;
			cachedVizWidth = vizWidth;
		}
		ui.visualizationContainer.scrollLeft = pos * (timelineWidth - vizWidth);

		if (notesFlashWhenPlayed) {
			const playheadBar: number = Math.floor(ui.synth.playhead);
			const modPlayhead: number = ui.synth.playhead - playheadBar;
			const partsPerBar: number = ui.synth.song.beatsPerBar * Config.partsPerBeat;
			const noteFlashElementsForThisBar: SVGPathElement[] =
				noteFlashElementsPerBar[playheadBar];

			if (noteFlashElementsForThisBar != null && playheadBar !== currentNoteFlashBar) {
				for (let i = currentNoteFlashElements.length - 1; i >= 0; i--) {
					const element: SVGPathElement = currentNoteFlashElements[i];
					const outsideOfCurrentBar =
						Number(element.getAttribute("note-bar")) !== playheadBar;
					const isInvisible: boolean = element.style.opacity === "0";
					if (outsideOfCurrentBar && isInvisible) {
						removeFromUnorderedArray(currentNoteFlashElements, i);
					}
				}
				for (let i = 0; i < noteFlashElementsForThisBar.length; i++) {
					const element: SVGPathElement = noteFlashElementsForThisBar[i];
					currentNoteFlashElements.push(element);
				}
			}

			if (currentNoteFlashElements != null) {
				for (let i = 0; i < currentNoteFlashElements.length; i++) {
					const element: SVGPathElement = currentNoteFlashElements[i];
					const noteStart: number =
						Number(element.getAttribute("note-start")) / partsPerBar;
					const noteEnd: number = Number(element.getAttribute("note-end")) / partsPerBar;
					const noteBar: number = Number(element.getAttribute("note-bar"));
					if (modPlayhead >= noteStart && noteBar === playheadBar) {
						const dist: number = noteEnd - noteStart;
						element.style.opacity = String(
							1 - (modPlayhead - noteStart - dist / 2) / (dist / 2),
						);
					} else {
						element.style.opacity = "0";
					}
				}
			}

			currentNoteFlashBar = playheadBar;
		}
	}
}
