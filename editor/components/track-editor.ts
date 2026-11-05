// TrackEditor
//
// Purpose: Renders the bar/track timeline view showing channel patterns across bars
//
// This module:
// - Draws bar grid with pattern numbers and colors
// - Handles bar selection, drag reordering, and pattern assignment

// Copyright (c) 2012-2022 John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

import { HTML, SVG } from "imperative-html/dist/esm/elements-strict";
import { ColorConfig } from "../../shared/color-config";
import { Config } from "../../synth/synth-config";
import { isMobile } from "../config/editor-config";
import { frameScheduler } from "../core/frame-scheduler";
import type { SongDocument } from "../song-document";
import type { SongEditor } from "../song-editor";
import { ChannelRow } from "./channel-row";

function formatTime(seconds: number): string {
	const mins = Math.floor(seconds / 60);
	const secs = Math.floor(seconds % 60);
	return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export class TrackEditor {
	public readonly _barDropDown: HTMLSelectElement = HTML.select(
		{
			style: `width: 32px; height: ${Config.barEditorHeight}px; top: 0px; position: absolute; opacity: 0`,
		},
		HTML.option({ value: "barBefore" }, "Insert Bar Before"),
		HTML.option({ value: "barAfter" }, "Insert Bar After"),
		HTML.option({ value: "deleteBar" }, "Delete This Bar"),
	);
	private readonly _channelRowContainer: HTMLElement = HTML.div({
		style: `display: flex; flex-direction: column; padding-top: ${Config.barEditorHeight}px`,
	});
	private readonly _barNumberContainer: SVGGElement = SVG.g();
	private readonly _playhead: SVGRectElement = SVG.rect({
		fill: ColorConfig.playhead,
		x: 0,
		y: 0,
		width: 4,
		height: 128,
	});
	private readonly _boxHighlight: SVGRectElement = SVG.rect({
		fill: "none",
		stroke: "var(--primary-text)",
		"stroke-width": 2,
		"pointer-events": "none",
		x: 1,
		y: 1,
		width: 30,
		height: 30,
	});
	private readonly _upHighlight: SVGPathElement = SVG.path({
		fill: ColorConfig.invertedText,
		stroke: ColorConfig.invertedText,
		"stroke-width": 1,
		"pointer-events": "none",
	});
	private readonly _downHighlight: SVGPathElement = SVG.path({
		fill: ColorConfig.invertedText,
		stroke: ColorConfig.invertedText,
		"stroke-width": 1,
		"pointer-events": "none",
	});
	private readonly _barEditorPath: SVGPathElement = SVG.path({
		fill: ColorConfig.uiWidgetBackground,
		stroke: ColorConfig.uiWidgetBackground,
		"stroke-width": 1,
		"pointer-events": "none",
	});
	private readonly _selectionRect: SVGRectElement = SVG.rect({
		class: "dashed-line dash-move",
		fill: ColorConfig.boxSelectionFill,
		stroke: "var(--primary-text)",
		"stroke-width": 2,
		"stroke-dasharray": "5, 3",
		"fill-opacity": "0.4",
		"pointer-events": "none",
		visibility: "hidden",
		x: 1,
		y: 1,
		width: 62,
		height: 62,
	});
	private readonly _hoverTooltip: HTMLDivElement = HTML.div({
		// PMD card: 10px meta font, widget surface, 8px radius. Follows
		// the mouse cursor with a 12px offset. pointer-events: none so
		// it never blocks mouse events on the track grid.
		style: "position: fixed; left: 0; top: 0; padding: 4px 8px; background: var(--ui-widget-background); color: var(--primary-text); border-radius: 8px; font-size: 10px; font-weight: 600; font-family: var(--font-family-mono); white-space: pre-line; pointer-events: none; z-index: 999; display: none;",
	});
	private readonly _svg: SVGSVGElement = SVG.svg(
		{ style: `position: absolute; top: 0;` },
		this._barEditorPath,
		this._selectionRect,
		this._barNumberContainer,
		this._boxHighlight,
		this._upHighlight,
		this._downHighlight,
		this._playhead,
	);
	private readonly _select: HTMLSelectElement = HTML.select({
		class: "trackSelectBox",
		style: "background: none; border: none; appearance: none; border-radius: initial; box-shadow: none; color: transparent; position: absolute; touch-action: none;",
	});
	public readonly container: HTMLElement = HTML.div(
		{
			class: "noSelection",
			style: `background-color: ${ColorConfig.editorBackground}; position: relative; overflow: hidden;`,
		},
		this._channelRowContainer,
		this._svg,
		this._select,
		this._barDropDown,
		this._hoverTooltip,
	);
	private readonly _channels: ChannelRow[] = [];
	private readonly _barNumbers: SVGTextElement[] = [];
	private _mouseX: number = 0;
	private _mouseY: number = 0;
	private _mouseStartBar: number = 0;
	private _mouseStartChannel: number = 0;
	private _mouseBar: number = 0;
	private _mouseChannel: number = 0;
	private _mouseViewportX: number = 0;
	private _mouseViewportY: number = 0;
	private _mouseOver: boolean = false;
	private _mousePressed: boolean = false;
	private _mouseDragging = false;
	private _svgRect: DOMRect | null = null;
	private _barWidth: number = 32;
	private _renderedBarCount: number = -1;
	private _renderedEditorWidth: number = -1;
	private _renderedEditorHeight: number = -1;
	private _externalHoverChannel: number = -1;
	private _renderedPatternCount: number = 0;
	private _renderedPlayhead: number = -1;
	private _touchMode: boolean = isMobile;
	private _barDropDownBar: number = 0;
	private _lastScrollTime: number = 0;
	// rAF throttle for mousemove's expensive tail (hover tooltip +
	// preview). mousemove fires far faster than the frame budget;
	// coalescing removes the per-event getSamplesUpToBar + innerHTML
	// + offsetWidth/Height reflow storm. Mirrors pattern-editor's
	// _mouseMoveRAF. Coordinate math stays synchronous so drag
	// detection (_mouseBar/_mouseChannel) stays responsive.
	private _mouseMoveRAF: number | null = null;

	constructor(
		private _doc: SongDocument,
		private _songEditor: SongEditor,
	) {
		frameScheduler.register(this._animatePlayhead);
		this._svg.addEventListener("mousedown", this._whenMousePressed);
		document.addEventListener("mousemove", this._whenMouseMoved);
		document.addEventListener("mouseup", this._whenMouseReleased);
		window.addEventListener("resize", () => (this._svgRect = null));
		window.addEventListener("scroll", () => (this._svgRect = null), {
			capture: true,
			passive: true,
		});

		this._svg.addEventListener("mouseover", this._whenMouseOver);
		this._svg.addEventListener("mouseout", this._whenMouseOut);
		// Prevent wheel events on the track SVG from scrolling the page.
		// The track editor has no native scroll action, but the event
		// still reaches the document and scrolls <body>.
		this._svg.addEventListener(
			"wheel",
			(event: WheelEvent) => {
				event.preventDefault();
			},
			{
				passive: false,
			},
		);

		this._select.addEventListener("change", this._whenSelectChanged);
		this._select.addEventListener("touchstart", this._whenSelectPressed);
		this._select.addEventListener("touchmove", this._whenSelectMoved);
		this._select.addEventListener("touchend", this._whenSelectReleased);
		this._select.addEventListener("touchcancel", this._whenSelectReleased);

		let determinedCursorType: boolean = false;
		document.addEventListener(
			"mousedown",
			() => {
				if (!determinedCursorType) {
					this._touchMode = false;
					this._updatePreview();
				}
				determinedCursorType = true;
			},
			true,
		);
		document.addEventListener(
			"touchstart",
			() => {
				if (!determinedCursorType) {
					this._touchMode = true;
					this._updatePreview();
				}
				determinedCursorType = true;
			},
			true,
		);

		this._barDropDown.selectedIndex = -1;
		this._barDropDown.addEventListener("change", this._barDropDownHandler);
		this._barDropDown.addEventListener("mousedown", this._barDropDownGetOpenedPosition);
	}

	private _barDropDownGetOpenedPosition = (_event: MouseEvent): void => {
		this._barDropDownBar = Math.floor(
			Math.min(this._doc.song.barCount - 1, Math.max(0, this._mouseX / this._barWidth)),
		);
	};

	private _barDropDownHandler = (_event: Event): void => {
		const moveBarOffset = this._barDropDown.value === "barBefore" ? 0 : 1;

		if (this._barDropDown.value === "barBefore" || this._barDropDown.value === "barAfter") {
			this._doc.bar = this._barDropDownBar - 1 + moveBarOffset;

			this._doc.selection.resetBoxSelection();
			this._doc.selection.insertBars();

			// This moves doc.bar back. Consider instead moving it to the inserted zone.
			// this._doc.bar = prevBar + ((prevBar < this._barDropDownBar + moveBarOffset) ? 0 : 1);

			// Adjust song playhead
			if (this._doc.synth.playhead >= this._barDropDownBar + moveBarOffset) {
				this._doc.synth.playhead++;
				this._songEditor._barScrollBar.animatePlayhead();
			}
		} else if (this._barDropDown.value === "deleteBar") {
			this._doc.bar = this._barDropDownBar;

			this._doc.selection.resetBoxSelection();
			this._doc.selection.deleteBars();

			// This moves doc.bar back. Consider instead moving it to the deleted zone.
			// this._doc.bar = prevBar - ((prevBar <= this._barDropDownBar) ? 0 : 1);

			// Adjust song playhead
			if (this._doc.synth.playhead > this._barDropDownBar) {
				this._doc.synth.playhead--;
				this._songEditor._barScrollBar.animatePlayhead();
			}
		}

		this._barDropDown.selectedIndex = -1;
	};

	private _whenSelectChanged = (): void => {
		this._doc.selection.setPattern(this._select.selectedIndex);
	};

	private _lastFrameTime: number = 0;
	private _frameStutterCount: number = 0;
	private _lastFrameStutterLogMs: number = 0;

	private _animatePlayhead = (timestamp: number): void => {
		if (this._lastFrameTime > 0) {
			const frameDelta: number = timestamp - this._lastFrameTime;
			if (frameDelta > 50 && this._doc.synth.playing) {
				this._frameStutterCount++;
				const now: number = performance.now();
				if (now - this._lastFrameStutterLogMs > 1000) {
					this._lastFrameStutterLogMs = now;
					console.warn(
						"[UI] Frame stutter #" +
							this._frameStutterCount +
							", delta=" +
							frameDelta.toFixed(0) +
							"ms (target 16ms)",
					);
				}
			}
		}
		this._lastFrameTime = timestamp;

		const playhead = this._barWidth * this._doc.synth.playhead - 2;
		if (this._renderedPlayhead !== playhead) {
			this._renderedPlayhead = playhead;
			this._playhead.setAttribute("x", `${playhead}`);
		}
	};

	public movePlayheadToMouse(): boolean {
		if (this._mouseOver) {
			this._doc.synth.playhead =
				this._mouseBar + (this._mouseX % this._barWidth) / this._barWidth;
			return true;
		}
		return false;
	}

	private _dragBoxSelection(): void {
		this._doc.selection.setTrackSelection(
			this._doc.selection.boxSelectionX0,
			this._mouseBar,
			this._doc.selection.boxSelectionY0,
			this._mouseChannel,
		);
		this._doc.selection.selectionUpdated();
	}

	private _updateSelectPos(event: TouchEvent): void {
		const boundingRect: DOMRect = this._svg.getBoundingClientRect();
		this._mouseX = event.touches[0].clientX - boundingRect.left;
		this._mouseY = event.touches[0].clientY - boundingRect.top;
		if (Number.isNaN(this._mouseX)) this._mouseX = 0;
		if (Number.isNaN(this._mouseY)) this._mouseY = 0;
		this._mouseBar = Math.floor(
			Math.min(this._doc.song.barCount - 1, Math.max(0, this._mouseX / this._barWidth)),
		);
		this._mouseChannel = Math.floor(
			Math.min(
				this._doc.song.getChannelCount() - 1,
				Math.max(0, (this._mouseY - Config.barEditorHeight) / ChannelRow.patternHeight),
			),
		);
	}

	private _whenSelectPressed = (event: TouchEvent): void => {
		this._mousePressed = true;
		this._mouseDragging = true;
		this._updateSelectPos(event);
		this._mouseStartBar = this._mouseBar;
		this._mouseStartChannel = this._mouseChannel;
	};

	private _whenSelectMoved = (event: TouchEvent): void => {
		this._updateSelectPos(event);
		if (
			this._mouseStartBar !== this._mouseBar ||
			this._mouseStartChannel !== this._mouseChannel
		) {
			// if the touch has started dragging, cancel opening the select menu.
			event.preventDefault();
		}
		if (this._mousePressed) this._dragBoxSelection();
		this._updatePreview();
	};

	private _whenSelectReleased = (_event: TouchEvent): void => {
		this._mousePressed = false;
		this._mouseDragging = false;
		this._updatePreview();
	};

	private _whenMouseOver = (_event: MouseEvent): void => {
		if (this._mouseOver) return;
		this._mouseOver = true;
		this._hoverTooltip.style.display = "block";
	};

	private _whenMouseOut = (_event: MouseEvent): void => {
		if (!this._mouseOver) return;
		this._mouseOver = false;
		this._songEditor.muteEditor.setHoveredChannel(-1);
		this._hoverTooltip.style.display = "none";
	};

	private _updateMouseCoords(event: MouseEvent): void {
		if (this._svgRect == null) this._svgRect = this._svg.getBoundingClientRect();
		const boundingRect: DOMRect = this._svgRect;
		this._mouseViewportX = event.clientX || event.pageX;
		this._mouseViewportY = event.clientY || event.pageY;
		this._mouseX = this._mouseViewportX - boundingRect.left;
		this._mouseY = this._mouseViewportY - boundingRect.top;
		this._mouseBar = Math.floor(
			Math.min(this._doc.song.barCount - 1, Math.max(0, this._mouseX / this._barWidth)),
		);
		this._mouseChannel = Math.floor(
			Math.min(
				this._doc.song.getChannelCount() - 1,
				Math.max(0, (this._mouseY - Config.barEditorHeight) / ChannelRow.patternHeight),
			),
		);
	}

	private _updateMousePos(event: MouseEvent): void {
		this._updateMouseCoords(event);
		this._updateHoverTooltip();
	}

	private _cachedTooltipKey: string | null = null;
	private _cachedTooltipWidth: number = 0;
	private _cachedTooltipHeight: number = 0;
	private _renderedTooltipDisplay: string = "none";

	private _updateHoverTooltip(): void {
		if (!this._mouseOver || this._touchMode) {
			if (this._renderedTooltipDisplay !== "none") {
				this._hoverTooltip.style.display = "none";
				this._renderedTooltipDisplay = "none";
			}
			this._cachedTooltipKey = null;
			return;
		}
		const bar: number = this._mouseBar;
		const channel: number = this._mouseChannel;
		const overTrackEditor: boolean = this._mouseY >= Config.barEditorHeight;
		const channelType: string = overTrackEditor
			? this._doc.song.getChannelIsNoise(channel)
				? "D"
				: this._doc.song.getChannelIsMod(channel)
					? "M"
					: "P"
			: "";

		// Cache content by bar+channel key. Skip innerHTML + offset
		// re-reads on same-bar mouse moves inside the same cell.
		const key: string = overTrackEditor ? `${bar}_${channel}_${channelType}` : `B${bar}`;
		if (this._cachedTooltipKey !== key) {
			this._cachedTooltipKey = key;

			const barSamples = this._doc.synth.getSamplesUpToBar(bar);
			const barTime = barSamples > 0 ? barSamples / this._doc.synth.samplesPerSecond : 0;
			const elapsedStr = formatTime(barTime);

			this._hoverTooltip.textContent = overTrackEditor
				? `B${bar + 1}/${channelType}${channel + 1}\n${elapsedStr}`
				: `B${bar + 1}\n${elapsedStr}`;

			// Re-read size after content change. Cached between same-key
			// mouse moves to avoid layout thrash on every pixel.
			this._cachedTooltipWidth = this._hoverTooltip.offsetWidth || 100;
			this._cachedTooltipHeight = this._hoverTooltip.offsetHeight || 20;
		}

		// Position update still runs every rAF (cursor moved). Uses
		// cached dimensions — no reflow.
		const offset: number = 12;
		const viewportWidth: number = window.innerWidth;
		const viewportHeight: number = window.innerHeight;
		const tooltipWidth: number = this._cachedTooltipWidth;
		const tooltipHeight: number = this._cachedTooltipHeight;

		let left: number = this._mouseViewportX + offset;
		if (left + tooltipWidth > viewportWidth) {
			left = this._mouseViewportX - offset - tooltipWidth;
		}
		if (left < 0) left = 0;
		if (left + tooltipWidth > viewportWidth) {
			left = Math.max(0, viewportWidth - tooltipWidth);
		}

		let top: number = this._mouseViewportY + offset;
		if (top + tooltipHeight > viewportHeight) {
			top = this._mouseViewportY - offset - tooltipHeight;
		}
		if (top < 0) top = 0;
		if (top + tooltipHeight > viewportHeight) {
			top = Math.max(0, viewportHeight - tooltipHeight);
		}

		this._hoverTooltip.style.left = `${left}px`;
		this._hoverTooltip.style.top = `${top}px`;
		if (this._renderedTooltipDisplay !== "block") {
			this._hoverTooltip.style.display = "block";
			this._renderedTooltipDisplay = "block";
		}
	}

	private _whenMousePressed = (event: MouseEvent): void => {
		event.preventDefault();
		this._mousePressed = true;
		this._updateMousePos(event);
		this._mouseStartBar = this._mouseBar;
		this._mouseStartChannel = this._mouseChannel;

		// Act on track portion
		if (this._mouseY >= Config.barEditorHeight) {
			if (event.shiftKey) {
				this._mouseDragging = true;
				this._doc.selection.setTrackSelection(
					this._doc.selection.boxSelectionX0,
					this._mouseBar,
					this._doc.selection.boxSelectionY0,
					this._mouseChannel,
				);
				this._doc.selection.selectionUpdated();
			} else {
				this._mouseDragging = false;
				if (this._doc.channel !== this._mouseChannel || this._doc.bar !== this._mouseBar) {
					this._doc.selection.setChannelBar(this._mouseChannel, this._mouseBar);
					this._mouseDragging = true;
				}
				this._doc.selection.resetBoxSelection();
			}
		}
	};

	private _whenMouseMoved = (event: MouseEvent): void => {
		// Coordinate math stays synchronous so drag detection and
		// _dragBoxSelection see current _mouseBar/_mouseChannel. The
		// expensive tooltip (getSamplesUpToBar + innerHTML + offset
		// reads) and preview/highlight update are coalesced to one
		// rAF per frame, removing the reflow storm from high-rate
		// pointers (125-1000Hz mousemove vs 60Hz frame budget).
		this._updateMouseCoords(event);
		if (this._mousePressed) {
			if (
				this._mouseStartBar !== this._mouseBar ||
				this._mouseStartChannel !== this._mouseChannel
			) {
				this._mouseDragging = true;
			}
			this._dragBoxSelection();
		}
		if (this._mouseMoveRAF !== null) return;
		this._mouseMoveRAF = requestAnimationFrame(() => {
			this._mouseMoveRAF = null;
			this._updateHoverTooltip();
			this._updatePreview();
		});
	};

	private _whenMouseReleased = (_event: MouseEvent): void => {
		if (this._mousePressed && !this._mouseDragging) {
			if (this._doc.channel === this._mouseChannel && this._doc.bar === this._mouseBar) {
				const up: boolean =
					(this._mouseY - Config.barEditorHeight) % ChannelRow.patternHeight <
					ChannelRow.patternHeight / 2;
				const patternCount: number = this._doc.song.patternsPerChannel;
				this._doc.selection.setPattern(
					(this._doc.song.channels[this._mouseChannel].bars[this._mouseBar] +
						(up ? 1 : patternCount)) %
						(patternCount + 1),
				);
			}
		}
		this._mousePressed = false;
		this._mouseDragging = false;
		this._updatePreview();
	};

	public setHoveredChannel(channel: number): void {
		this._externalHoverChannel = channel;
		this._updatePreview();
	}

	private _updatePreview(): void {
		let channel: number = this._mouseChannel;
		let bar: number = this._mouseBar;

		if (this._touchMode) {
			bar = this._doc.bar;
			channel = this._doc.channel;
		}

		if (!this._mouseOver && this._externalHoverChannel !== -1) {
			bar = this._doc.bar;
			channel = this._externalHoverChannel;
		}

		const selected: boolean = bar === this._doc.bar && channel === this._doc.channel;
		const overTrackEditor: boolean =
			this._mouseY >= Config.barEditorHeight ||
			(!this._mouseOver && this._externalHoverChannel !== -1);

		if (this._mouseOver && overTrackEditor && !this._touchMode) {
			this._songEditor.muteEditor.setHoveredChannel(channel);
		} else if (this._externalHoverChannel === -1) {
			this._songEditor.muteEditor.setHoveredChannel(-1);
		}

		if (this._mouseDragging && this._mouseStartBar !== this._mouseBar) {
			// Handle auto-scroll in selection. Only @50ms or slower.
			const timestamp: number = Date.now();

			if (timestamp - this._lastScrollTime >= 50) {
				if (
					bar > this._doc.barScrollPos + this._doc.trackVisibleBars - 1 &&
					this._doc.barScrollPos < this._doc.song.barCount - this._doc.trackVisibleBars
				) {
					this._songEditor.changeBarScrollPos(1);
				}
				if (bar < this._doc.barScrollPos && this._doc.barScrollPos > 0) {
					this._songEditor.changeBarScrollPos(-1);
				}

				this._lastScrollTime = timestamp;
			}
		}

		if (
			(this._mouseOver || (!this._mouseOver && this._externalHoverChannel !== -1)) &&
			!this._mousePressed &&
			!selected &&
			overTrackEditor
		) {
			this._boxHighlight.setAttribute("x", `${1 + this._barWidth * bar}`);
			this._boxHighlight.setAttribute(
				"y",
				`${1 + Config.barEditorHeight + ChannelRow.patternHeight * channel}`,
			);
			this._boxHighlight.setAttribute("height", `${ChannelRow.patternHeight - 2}`);
			this._boxHighlight.setAttribute("width", `${this._barWidth - 2}`);
			this._boxHighlight.style.visibility = "visible";
		} else if (
			(this._mouseOver ||
				(this._mouseX >= bar * this._barWidth &&
					this._mouseX < bar * this._barWidth + this._barWidth &&
					this._mouseY > 0)) &&
			!overTrackEditor
		) {
			this._boxHighlight.setAttribute("x", `${1 + this._barWidth * bar}`);
			this._boxHighlight.setAttribute("y", "1"); // The y is set to 1 instead of 0 due to the thickness of the box causing it to go slightly outside the frame at y=0.
			this._boxHighlight.setAttribute("height", `${Config.barEditorHeight - 3}`);
			this._boxHighlight.style.visibility = "visible";
		} else {
			this._boxHighlight.style.visibility = "hidden";
		}

		if ((this._mouseOver || this._touchMode) && selected && overTrackEditor) {
			const up: boolean =
				(this._mouseY - Config.barEditorHeight) % ChannelRow.patternHeight <
				ChannelRow.patternHeight / 2;
			const center: number = this._barWidth * (bar + 0.8);
			const middle: number =
				Config.barEditorHeight + ChannelRow.patternHeight * (channel + 0.5);
			const base: number = ChannelRow.patternHeight * 0.1;
			const tip: number = ChannelRow.patternHeight * 0.4;
			const width: number = ChannelRow.patternHeight * 0.175;

			this._upHighlight.setAttribute(
				"fill",
				up && !this._touchMode ? "var(--primary-text)" : ColorConfig.invertedText,
			);
			this._downHighlight.setAttribute(
				"fill",
				!up && !this._touchMode ? "var(--primary-text)" : ColorConfig.invertedText,
			);

			this._upHighlight.setAttribute(
				"d",
				`M ${center} ${middle - tip} L ${center + width} ${middle - base} L ${center - width} ${middle - base} z`,
			);
			this._downHighlight.setAttribute(
				"d",
				`M ${center} ${middle + tip} L ${center + width} ${middle + base} L ${center - width} ${middle + base} z`,
			);

			this._upHighlight.style.visibility = "visible";
			this._downHighlight.style.visibility = "visible";
		} else {
			this._upHighlight.style.visibility = "hidden";
			this._downHighlight.style.visibility = "hidden";
		}

		this._selectionRect.style.left = `${this._barWidth * this._doc.bar}px`;
		this._selectionRect.style.top = `${Config.barEditorHeight + ChannelRow.patternHeight * this._doc.channel}px`;

		this._select.style.left = `${this._barWidth * this._doc.bar}px`;

		this._select.style.width = `${this._barWidth}px`;
		this._select.style.top = `${Config.barEditorHeight + ChannelRow.patternHeight * this._doc.channel}px`;
		this._select.style.height = `${ChannelRow.patternHeight}px`;

		this._barDropDown.style.left = `${this._barWidth * bar}px`;

		const patternCount: number = this._doc.song.patternsPerChannel + 1;
		for (let i: number = this._renderedPatternCount; i < patternCount; i++) {
			this._select.appendChild(HTML.option({ value: i }, i));
		}
		for (let i: number = patternCount; i < this._renderedPatternCount; i++) {
			this._select.removeChild(<Node>this._select.lastChild);
		}
		this._renderedPatternCount = patternCount;
		const selectedPattern: number =
			this._doc.song.channels[this._doc.channel].bars[this._doc.bar];
		if (this._select.selectedIndex !== selectedPattern)
			this._select.selectedIndex = selectedPattern;
	}

	public render(): void {
		this._barWidth = this._doc.getBarWidth();

		if (this._channels.length !== this._doc.song.getChannelCount()) {
			// Add new channel boxes if needed
			for (let y: number = this._channels.length; y < this._doc.song.getChannelCount(); y++) {
				const channelRow: ChannelRow = new ChannelRow(this._doc, y);
				this._channels[y] = channelRow;
				this._channelRowContainer.appendChild(channelRow.container);
			}

			// Remove old channel boxes
			for (let y: number = this._doc.song.getChannelCount(); y < this._channels.length; y++) {
				this._channelRowContainer.removeChild(this._channels[y].container);
			}

			this._channels.length = this._doc.song.getChannelCount();
			this._mousePressed = false;

			// Recompute mouse channel from mouseY when channel count changes
			// to prevent cursor offset after channel insert/delete
			this._mouseChannel = Math.floor(
				Math.min(
					this._doc.song.getChannelCount() - 1,
					Math.max(0, (this._mouseY - Config.barEditorHeight) / ChannelRow.patternHeight),
				),
			);
		}

		for (let j: number = 0; j < this._doc.song.getChannelCount(); j++) {
			this._channels[j].render();
		}

		const editorWidth: number = this._barWidth * this._doc.song.barCount;
		if (this._renderedEditorWidth !== editorWidth) {
			this._renderedEditorWidth = editorWidth;
			this._channelRowContainer.style.width = `${editorWidth}px`;
			this.container.style.width = `${editorWidth}px`;
			this._svg.setAttribute("width", `${editorWidth}`);
			this._mousePressed = false;

			// Update bar editor's SVG
			// this._upHighlight.setAttribute("d", `M ${center} ${middle - tip} L ${center + width} ${middle - base} L ${center - width} ${middle - base} z`);
			// this._downHighlight.setAttribute("d", `M ${center} ${middle + tip} L ${center + width} ${middle + base} L ${center - width} ${middle + base} z`);

			let pathString = "";

			for (let x: number = 0; x < this._doc.song.barCount; x++) {
				const pathLeft = x * this._barWidth + 2;
				const pathTop = 1;
				const pathRight = x * this._barWidth + this._barWidth - 2;
				const pathBottom = Config.barEditorHeight - 3;

				pathString += `M ${pathLeft} ${pathTop} H ${pathRight} V ${pathBottom} H ${pathLeft} V ${pathTop} Z `;
			}

			this._barEditorPath.setAttribute("d", pathString);

			if (this._renderedBarCount < this._doc.song.barCount) {
				this._barNumbers.length = this._doc.song.barCount;
				for (let pos = this._renderedBarCount; pos < this._barNumbers.length; pos++) {
					this._barNumbers[pos] = SVG.text(
						{
							"font-family": "'Fira Code', 'FiraCode Nerd Font', monospace",
							"font-size": "8px",
							"text-anchor": "middle",
							"font-weight": "700",
							x: `${pos * this._barWidth + this._barWidth / 2}px`,
							y: "7px",
							fill: ColorConfig.secondaryText,
						},
						`${pos + 1}`,
					);
					if (pos % 4 === 0) {
						// Highlighting every 4 bars
						this._barNumbers[pos].setAttribute("fill", ColorConfig.primaryText);
					}
					this._barNumberContainer.appendChild(this._barNumbers[pos]);
				}
				this._renderedBarCount = this._doc.song.barCount;
			} else if (this._renderedBarCount > this._doc.song.barCount) {
				for (let pos = this._renderedBarCount - 1; pos >= this._doc.song.barCount; pos--) {
					this._barNumberContainer.removeChild(this._barNumbers[pos]);
				}
				this._barNumbers.length = this._doc.song.barCount;
				this._renderedBarCount = this._doc.song.barCount;
			}

			// Update x of bar editor numbers
			for (let pos = 0; pos < this._barNumbers.length; pos++) {
				this._barNumbers[pos].setAttribute(
					"x",
					`${pos * this._barWidth + this._barWidth / 2}px`,
				);
			}

			this._renderedEditorWidth = editorWidth;
			this._channelRowContainer.style.width = `${editorWidth}px`;
			this.container.style.width = `${editorWidth}px`;
			this._svg.setAttribute("width", `${editorWidth}`);
			this._mousePressed = false;
		}

		const editorHeight: number = this._doc.song.getChannelCount() * ChannelRow.patternHeight;
		if (this._renderedEditorHeight !== editorHeight) {
			this._renderedEditorHeight = editorHeight;
			this._svg.setAttribute("height", `${editorHeight + Config.barEditorHeight}`);
			this._playhead.setAttribute("height", `${editorHeight + Config.barEditorHeight}`);
			this.container.style.height = `${editorHeight + Config.barEditorHeight}px`;
		}

		this._select.style.display = this._touchMode ? "" : "none";

		if (this._doc.selection.boxSelectionActive) {
			// TODO: This causes the selection rectangle to repaint every time the
			// editor renders and the selection is visible. Check if anything changed
			// before overwriting the attributes?
			this._selectionRect.setAttribute(
				"x",
				String(this._barWidth * this._doc.selection.boxSelectionBar + 1),
			);
			this._selectionRect.setAttribute(
				"y",
				String(
					Config.barEditorHeight +
						ChannelRow.patternHeight * this._doc.selection.boxSelectionChannel +
						1,
				),
			);
			this._selectionRect.setAttribute(
				"width",
				String(this._barWidth * this._doc.selection.boxSelectionWidth - 2),
			);
			this._selectionRect.setAttribute(
				"height",
				String(ChannelRow.patternHeight * this._doc.selection.boxSelectionHeight - 2),
			);
			this._selectionRect.setAttribute("visibility", "visible");
		} else {
			this._selectionRect.setAttribute("visibility", "hidden");
		}

		this._updatePreview();
		this._updateHoverTooltip();
	}
}
