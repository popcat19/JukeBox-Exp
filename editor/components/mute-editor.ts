import { BorderRadius, Typography } from "../ui/style-constants";
// MuteEditor
//
// Purpose: Renders channel mute/solo controls in the track editor
//
// This module:
// - Displays mute and solo buttons for each channel
// - Handles mute state changes on the song document

// Copyright (c) 2012-2022 John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

import { HTML, SVG } from "imperative-html/dist/esm/elements-strict";
import { ColorConfig } from "../../shared/color-config";
import { Config } from "../../synth/synth-config";
import {
	ChangeChannelName,
	ChangeChannelOrder,
	ChangeCleanChannelInstruments,
	ChangeCleanChannelPatterns,
	ChangeRemoveChannel,
} from "../changes";
import type { SongDocument } from "../song-document";
import type { SongEditor } from "../song-editor";
import { InputBox, setDisabled } from "../ui";
import { ChannelRow } from "./channel-row";

// namespace beepbox {
export class MuteEditor {
	private static _loopIconPath: string =
		"M4 12v-3a3 3 0 0 1 3 -3h13m-3 -3l3 3l-3 3 M20 12v3a3 3 0 0 1 -3 3h-13m3 3l-3 -3l3 -3";
	private readonly _loopIcon: SVGPathElement = SVG.path({
		d: MuteEditor._loopIconPath,
		stroke: "currentColor",
		"stroke-width": "4",
		"stroke-linecap": "round",
		"stroke-linejoin": "round",
		fill: "none",
	});
	private readonly _loopButton: HTMLButtonElement = HTML.button(
		{
			style: `width: 20px; height: 20px; padding: 0; border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; outline: none; line-height: 1; font-size: 10px; background: var(--tab-inactive-bg); color: var(--tab-inactive-fg); transition: none;`,
			class: "cvv-loop-btn",
			title: "Toggle loop",
		},
		SVG.svg({ width: 10, height: 10, viewBox: "0 0 24 24" }, this._loopIcon),
	);

	private readonly _buttons: HTMLDivElement[] = [];
	private readonly _channelCounts: HTMLDivElement[] = [];
	private readonly _channelNameDisplay: HTMLDivElement = HTML.div(
		{
			style: `background-color: ${ColorConfig.uiWidgetFocus}; white-space:nowrap; display: none; transform:translate(20px); width: auto; pointer-events: none; position: absolute; border-radius: var(--border-radius-medium); z-index: 2;`,
			color: ColorConfig.primaryText,
		},
		"",
	);
	public readonly _channelNameInput: InputBox = new InputBox(
		HTML.input(
			{
				style: `color: ${ColorConfig.primaryText}; background-color: ${ColorConfig.uiWidgetFocus}; margin-top: -2px; display: none; width: 6em; position: absolute; border-radius: var(--border-radius-medium); z-index: 2;`,
				color: ColorConfig.primaryText,
			},
			"",
		),
		this._doc,
		(oldValue: string, newValue: string) =>
			new ChangeChannelName(this._doc, oldValue, newValue),
	);

	private readonly _channelDropDown: HTMLSelectElement = HTML.select(
		{ style: "width: 0px; left: 19px; height: 19px; position:absolute; opacity:0" },
		HTML.option({ value: "rename" }, "Rename..."),
		HTML.option({ value: "chnUp" }, "Move Channel Up"),
		HTML.option({ value: "chnDown" }, "Move Channel Down"),
		HTML.option({ value: "chnMute" }, "Mute Channel"),
		HTML.option({ value: "chnSolo" }, "Solo Channel"),
		HTML.option({ value: "chnInsert" }, "Insert Channel Below"),
		HTML.option({ value: "chnClone" }, "Clone Channel"),
		HTML.option({ value: "chnClean" }, "Clean Patterns (LSDj)"),
		HTML.option({ value: "chnCleanInst" }, "Clean Instruments (LSDj)"),
		HTML.option({ value: "chnDelete" }, "Delete This Channel"),
	);

	public readonly container: HTMLElement = HTML.div(
		{
			class: "muteEditor",
			style: `position: sticky; padding-top: ${Config.barEditorHeight}px;`,
		},
		this._channelNameDisplay,
		this._channelNameInput.input,
		this._channelDropDown,
		this._loopButton,
	);

	private _editorHeight: number = 128;
	private _renderedPitchChannels: number = 0;
	private _renderedNoiseChannels: number = 0;
	private _renderedChannelHeight: number = -1;
	private _renderedModChannels: number = 0;
	private _channelDropDownChannel: number = 0;
	private _channelDropDownOpen: boolean = false;
	private _channelDropDownLastState: boolean = false;
	private _hoveredChannel: number = -1;

	constructor(
		private _doc: SongDocument,
		private _editor: SongEditor,
	) {
		this.container.addEventListener("click", this._onClick);
		this.container.addEventListener("mousemove", this._onMouseMove);
		this.container.addEventListener("mouseleave", this._onMouseLeave);

		this._channelDropDown.selectedIndex = -1;
		this._channelDropDown.addEventListener("change", this._channelDropDownHandler);
		this._channelDropDown.addEventListener("mousedown", this._channelDropDownGetOpenedPosition);
		this._channelDropDown.addEventListener("blur", this._channelDropDownBlur);
		this._channelDropDown.addEventListener("click", this._channelDropDownClick);

		this._channelNameInput.input.addEventListener("change", this._channelNameInputHide);
		this._channelNameInput.input.addEventListener("blur", this._channelNameInputHide);
		this._channelNameInput.input.addEventListener("mousedown", this._channelNameInputClicked);
		this._channelNameInput.input.addEventListener("input", this._channelNameInputWhenInput);

		this._loopButton.addEventListener("click", this._toggleLoop);
		this._loopButton.addEventListener("mouseenter", this._onLoopMouseEnter);
		this._loopButton.addEventListener("mouseleave", this._updateLoopButton);
		this._updateLoopButton();
	}

	private _channelNameInputWhenInput = (): void => {
		const newValue = this._channelNameInput.input.value;
		if (newValue.length > 15) {
			this._channelNameInput.input.value = newValue.substring(0, 15);
		}
	};

	private _channelNameInputClicked = (event: MouseEvent): void => {
		event.stopPropagation();
	};

	private _channelNameInputHide = (): void => {
		this._channelNameInput.input.style.setProperty("display", "none");
		this._channelNameDisplay.style.setProperty("display", "none");
	};

	private _channelDropDownClick = (event: MouseEvent): void => {
		this._channelDropDownOpen = !this._channelDropDownLastState;
		this._channelDropDownGetOpenedPosition(event);
	};

	private _channelDropDownBlur = (): void => {
		this._channelDropDownOpen = false;
		this._channelNameDisplay.style.setProperty("display", "none");
	};

	private _channelDropDownGetOpenedPosition = (_event: MouseEvent): void => {
		// Guard: if the dropdown was already hidden (e.g. by the change handler
		// via _channelDropDownHandler), a trailing click event from the native
		// select popup must not re-show the name display or corrupt the
		// _channelDropDownOpen / _channelDropDownLastState flags. Without this
		// guard, _onMouseMove sees _channelDropDownOpen === true and refuses to
		// re-show the dropdown, freezing the mute editor until page refresh.
		if (this._channelDropDown.style.getPropertyValue("display") === "none") return;

		this._channelDropDownLastState = this._channelDropDownOpen;

		this._channelDropDownChannel = Math.floor(
			Math.min(
				this._buttons.length,
				Math.max(
					0,
					parseInt(this._channelDropDown.style.getPropertyValue("top"), 10) /
						ChannelRow.patternHeight,
				),
			),
		);
		this._doc.muteEditorChannel = this._channelDropDownChannel;

		this._channelNameDisplay.style.setProperty("display", "");

		// Check if channel is at limit, in which case another can't be inserted
		const song = this._doc.song;
		const ch = this._channelDropDownChannel;
		const noiseStart = song.pitchChannelCount;
		const modStart = song.pitchChannelCount + song.noiseChannelCount;
		const isPitchChannel = ch < noiseStart;
		const isNoiseChannel = ch >= noiseStart && ch < modStart;
		const isModChannel = ch >= modStart;
		const channelGroupAtLimit =
			(isPitchChannel && song.pitchChannelCount === Config.pitchChannelCountMax) ||
			(isNoiseChannel && song.noiseChannelCount === Config.noiseChannelCountMax) ||
			(isModChannel && song.modChannelCount === Config.modChannelCountMax);
		if (channelGroupAtLimit) {
			setDisabled(this._channelDropDown.options[5], true);
			setDisabled(this._channelDropDown.options[6], true);
		} else {
			setDisabled(this._channelDropDown.options[5], false);
			setDisabled(this._channelDropDown.options[6], false);
		}

		// Also check if a channel is eligible to move up or down based on the song's channel settings.
		if (
			this._channelDropDownChannel === 0 ||
			this._channelDropDownChannel === this._doc.song.pitchChannelCount ||
			this._channelDropDownChannel ===
				this._doc.song.pitchChannelCount + this._doc.song.noiseChannelCount
		) {
			setDisabled(this._channelDropDown.options[1], true);
		} else {
			setDisabled(this._channelDropDown.options[1], false);
		}
		if (
			this._channelDropDownChannel === this._doc.song.pitchChannelCount - 1 ||
			this._channelDropDownChannel ===
				this._doc.song.pitchChannelCount + this._doc.song.noiseChannelCount - 1 ||
			this._channelDropDownChannel === this._doc.song.getChannelCount() - 1
		) {
			setDisabled(this._channelDropDown.options[2], true);
		} else {
			setDisabled(this._channelDropDown.options[2], false);
		}

		// Also, can't delete the last pitch channel.
		if (this._doc.song.pitchChannelCount === 1 && this._channelDropDownChannel === 0) {
			setDisabled(this._channelDropDown.options[9], true);
		} else {
			setDisabled(this._channelDropDown.options[9], false);
		}
	};

	private _channelDropDownHandler = (event: Event): void => {
		this._channelNameDisplay.style.setProperty("display", "none");
		this._channelDropDown.style.setProperty("display", "none");
		this._channelDropDownOpen = false;
		event.stopPropagation();

		try {
			switch (this._channelDropDown.value) {
				case "rename":
					this._channelNameInput.input.style.setProperty("display", "");
					this._channelNameInput.input.style.setProperty(
						"transform",
						this._channelNameDisplay.style.getPropertyValue("transform"),
					);
					if (this._channelNameDisplay.textContent != null) {
						this._channelNameInput.input.value = this._channelNameDisplay.textContent;
					} else {
						this._channelNameInput.input.value = "";
					}
					this._channelNameInput.input.select();
					break;
				case "chnUp":
					this._doc.record(
						new ChangeChannelOrder(
							this._doc,
							this._channelDropDownChannel,
							this._channelDropDownChannel,
							-1,
						),
					);
					break;
				case "chnDown":
					this._doc.record(
						new ChangeChannelOrder(
							this._doc,
							this._channelDropDownChannel,
							this._channelDropDownChannel,
							1,
						),
					);
					break;
				case "chnMute":
					this._doc.song.channels[this._channelDropDownChannel].muted =
						!this._doc.song.channels[this._channelDropDownChannel].muted;
					this.render();
					break;
				case "chnSolo": {
					// Check for any channel not matching solo pattern
					let shouldSolo: boolean = false;
					for (
						let channel: number = 0;
						channel <
						this._doc.song.pitchChannelCount + this._doc.song.noiseChannelCount;
						channel++
					) {
						if (
							this._doc.song.channels[channel].muted ===
							(channel === this._channelDropDownChannel)
						) {
							shouldSolo = true;
							channel =
								this._doc.song.pitchChannelCount + this._doc.song.noiseChannelCount;
						}
					}
					if (shouldSolo) {
						for (
							let channel: number = 0;
							channel <
							this._doc.song.pitchChannelCount + this._doc.song.noiseChannelCount;
							channel++
						) {
							this._doc.song.channels[channel].muted =
								channel !== this._channelDropDownChannel;
						}
					} else {
						for (
							let channel: number = 0;
							channel <
							this._doc.song.pitchChannelCount + this._doc.song.noiseChannelCount;
							channel++
						) {
							this._doc.song.channels[channel].muted = false;
						}
					}
					this.render();
					break;
				}
				case "chnInsert": {
					this._doc.channel = this._channelDropDownChannel;
					this._doc.selection.resetBoxSelection();
					this._doc.selection.insertChannel();
					break;
				}
				case "chnClone": {
					this._doc.channel = this._channelDropDownChannel;
					this._doc.selection.resetBoxSelection();
					this._doc.selection.cloneChannel();
					break;
				}
				case "chnClean": {
					this._doc.record(
						new ChangeCleanChannelPatterns(this._doc, this._channelDropDownChannel),
					);
					break;
				}
				case "chnCleanInst": {
					this._doc.record(
						new ChangeCleanChannelInstruments(this._doc, this._channelDropDownChannel),
					);
					break;
				}
				case "chnDelete": {
					this._doc.record(
						new ChangeRemoveChannel(
							this._doc,
							this._channelDropDownChannel,
							this._channelDropDownChannel,
						),
					);

					break;
				}
			}
			if (this._channelDropDown.value !== "rename") {
				this._editor.refocusStage();
			}
		} finally {
			// Reset width so a stale 15px invisible select does not linger;
			// _onMouseMove / _onMouseLeave both reset width but the change
			// handler previously only set display:none, leaving width:15px.
			this._channelDropDown.style.setProperty("width", "0px");
			this._channelDropDown.selectedIndex = -1;
		}
	};

	private _onClick = (event: MouseEvent): void => {
		const index = this._buttons.indexOf(<HTMLDivElement>event.target);
		if (index === -1) return;
		const xPos: number = event.clientX - this._buttons[0].getBoundingClientRect().left;
		if (xPos < 21.0) {
			this._doc.song.channels[index].muted = !this._doc.song.channels[index].muted;
		}
		this._doc.notifier.changed();
	};

	private _onMouseMove = (event: MouseEvent): void => {
		const index = this._buttons.indexOf(<HTMLDivElement>event.target);
		if (index === -1) {
			if (
				!this._channelDropDownOpen &&
				event.target !== this._channelNameDisplay &&
				event.target !== this._channelDropDown
			) {
				this._channelNameDisplay.style.setProperty("display", "none");
				this._channelDropDown.style.setProperty("display", "none");
				this._channelDropDown.style.setProperty("width", "0px");
			}
			return;
		}
		if (
			this._channelDropDownOpen &&
			this._channelNameDisplay.style.getPropertyValue("display") === "none" &&
			this._channelNameInput.input.style.getPropertyValue("display") === "none"
		) {
			this._channelDropDownOpen = false;
		}
		const xPos: number = event.clientX - this._buttons[0].getBoundingClientRect().left;
		if (xPos >= 21.0) {
			if (!this._channelDropDownOpen) {
				// Mouse over chn. number
				this._channelDropDown.style.setProperty("display", "");
				const height = ChannelRow.patternHeight;
				this._channelNameDisplay.style.setProperty(
					"transform",
					`translate(20px, ${height / 4 + height * index}px)`,
				);

				if (this._doc.song.channels[index].name !== "") {
					this._channelNameDisplay.textContent = this._doc.song.channels[index].name;
					this._channelNameDisplay.style.setProperty("display", "");
				} else {
					if (index < this._doc.song.pitchChannelCount) {
						this._channelNameDisplay.textContent = `Pitch ${index + 1}`;
					} else if (
						index <
						this._doc.song.pitchChannelCount + this._doc.song.noiseChannelCount
					) {
						this._channelNameDisplay.textContent = `Noise ${index - this._doc.song.pitchChannelCount + 1}`;
					} else {
						this._channelNameDisplay.textContent = `Mod ${index - this._doc.song.pitchChannelCount - this._doc.song.noiseChannelCount + 1}`;
					}
					// The name set will only show up when this becomes visible, e.g. when the dropdown is opened.
					this._channelNameDisplay.style.setProperty("display", "none");
				}

				this._channelDropDown.style.top = `${Config.barEditorHeight + 2 + index * ChannelRow.patternHeight}px`;
				this._channelDropDown.style.setProperty("width", "15px");
			}
		} else {
			if (!this._channelDropDownOpen) {
				this._channelNameDisplay.style.setProperty("display", "none");
				this._channelDropDown.style.setProperty("display", "none");
				this._channelDropDown.style.setProperty("width", "0px");
			}
		}
	};

	private _onMouseLeave = (_event: MouseEvent): void => {
		if (!this._channelDropDownOpen) {
			this._channelNameDisplay.style.setProperty("display", "none");
			this._channelDropDown.style.setProperty("width", "0px");
		}
	};

	public onKeyUp(event: KeyboardEvent): void {
		switch (event.keyCode) {
			case 27: // esc
			case 13: // enter
				this._channelDropDownOpen = false;
				this._channelNameDisplay.style.setProperty("display", "none");
				break;
			default:
				break;
		}
	}

	public setHoveredChannel(channel: number): void {
		if (this._hoveredChannel === channel) return;
		this._hoveredChannel = channel;
		this.render();
	}

	public render(): void {
		if (!this._doc.prefs.enableChannelMuting) return;
		this._updateLoopButton();
		const startingChannelCount: number = this._buttons.length;

		if (this._buttons.length !== this._doc.song.getChannelCount()) {
			for (let y: number = this._buttons.length; y < this._doc.song.getChannelCount(); y++) {
				const channelCountText: HTMLDivElement = HTML.div({
					class: "noSelection muteButtonText",
					style: `display: table-cell; -webkit-text-stroke: 1.5px; vertical-align: middle; text-align: center; -webkit-user-select: none; -webkit-touch-callout: none; -moz-user-select: none; -ms-user-select: none; user-select: none; pointer-events: none; width: 12px; height: 20px; transform: translate(0px, 1px); font-weight: ${Typography.weightSemibold}; font-family: var(--font-family-mono);`,
				});
				const muteButton: HTMLDivElement = HTML.div({
					class: "mute-button",
					title: "Mute (M), Mute All (⇧M), Solo (S), Exclude (⇧S)",
					style: `display: block; pointer-events: none; width: 16px; height: 20px; transform: translate(2px, 1px);`,
				});

				const muteContainer: HTMLDivElement = HTML.div(
					{
						style: `align-items: center; height: 20px; margin: 0px; display: table; flex-direction: row; justify-content: space-between;`,
					},
					[muteButton, channelCountText],
				);
				this.container.appendChild(muteContainer);
				this._buttons[y] = muteContainer;
				this._channelCounts[y] = channelCountText;
			}

			for (let y: number = this._doc.song.getChannelCount(); y < this._buttons.length; y++) {
				this.container.removeChild(this._buttons[y]);
			}

			this._buttons.length = this._doc.song.getChannelCount();

			this.container.appendChild(this._loopButton);
		}

		for (let y: number = 0; y < this._doc.song.getChannelCount(); y++) {
			const active: boolean = y === this._doc.channel;
			this._channelCounts[y].style.opacity = "1";
			if (active) {
				const colors = ColorConfig.getChannelColor(this._doc.song, y);
				this._channelCounts[y].style.color = ColorConfig.invertedText;
				this._channelCounts[y].style.background = colors.primaryChannel;
				this._channelCounts[y].style.borderRadius = BorderRadius.sm;
			} else {
				this._channelCounts[y].style.background = "transparent";
				this._channelCounts[y].style.borderRadius = "0";
			}

			if (this._doc.song.channels[y].muted) {
				this._buttons[y].children[0].classList.add("muted");

				if (!active) {
					this._channelCounts[y].style.color = ColorConfig.muteEditorTextDim;
				}
			} else {
				this._buttons[y].children[0].classList.remove("muted");

				if (!active) {
					this._channelCounts[y].style.color = ColorConfig.muteEditorTextDim;
				}
			}
		}

		if (
			this._hoveredChannel >= 0 &&
			this._hoveredChannel !== this._doc.channel &&
			this._hoveredChannel < this._channelCounts.length
		) {
			const colors = ColorConfig.getChannelColor(this._doc.song, this._hoveredChannel);
			this._channelCounts[this._hoveredChannel].style.color = ColorConfig.invertedText;
			this._channelCounts[this._hoveredChannel].style.background = colors.primaryChannel;
			this._channelCounts[this._hoveredChannel].style.opacity = "0.5";
			this._channelCounts[this._hoveredChannel].style.borderRadius = BorderRadius.sm;
		}

		if (
			this._renderedChannelHeight !== ChannelRow.patternHeight ||
			startingChannelCount !== this._buttons.length
		) {
			for (let y: number = 0; y < this._doc.song.getChannelCount(); y++) {
				this._buttons[y].style.marginTop = `${(ChannelRow.patternHeight - 20) / 2}px`;
				this._buttons[y].style.marginBottom = `${(ChannelRow.patternHeight - 20) / 2}px`;
			}
		}

		if (
			this._renderedModChannels !== this._doc.song.modChannelCount ||
			startingChannelCount !== this._buttons.length
		) {
			for (let y: number = 0; y < this._doc.song.getChannelCount(); y++) {
				if (y < this._doc.song.pitchChannelCount + this._doc.song.noiseChannelCount) {
					this._buttons[y].children[0].classList.remove("modMute");
				} else {
					this._buttons[y].children[0].classList.add("modMute");
				}
			}
		}

		if (
			this._renderedModChannels !== this._doc.song.modChannelCount ||
			this._renderedPitchChannels !== this._doc.song.pitchChannelCount ||
			this._renderedNoiseChannels !== this._doc.song.noiseChannelCount
		) {
			for (let y: number = 0; y < this._doc.song.getChannelCount(); y++) {
				if (y < this._doc.song.pitchChannelCount) {
					const val: number = y + 1;
					this._channelCounts[y].textContent = `${val}`;
					this._channelCounts[y].style.fontSize = val >= 10 ? "xx-small" : "inherit";
				} else if (
					y <
					this._doc.song.pitchChannelCount + this._doc.song.noiseChannelCount
				) {
					const val: number = y - this._doc.song.pitchChannelCount + 1;
					this._channelCounts[y].textContent = `${val}`;
					this._channelCounts[y].style.fontSize = val >= 10 ? "xx-small" : "inherit";
				} else {
					const val: number =
						y - this._doc.song.pitchChannelCount - this._doc.song.noiseChannelCount + 1;
					this._channelCounts[y].textContent = `${val}`;
					this._channelCounts[y].style.fontSize = val >= 10 ? "xx-small" : "inherit";
				}
			}
			this._renderedPitchChannels = this._doc.song.pitchChannelCount;
			this._renderedNoiseChannels = this._doc.song.noiseChannelCount;
			this._renderedModChannels = this._doc.song.modChannelCount;
		}

		if (
			startingChannelCount !== this._buttons.length ||
			this._renderedChannelHeight !== ChannelRow.patternHeight
		) {
			this._renderedChannelHeight = ChannelRow.patternHeight;
			this._editorHeight =
				Config.barEditorHeight +
				this._doc.song.getChannelCount() * ChannelRow.patternHeight;
			this._channelNameDisplay.style.setProperty("display", "none");
			this.container.style.height = `${this._editorHeight + 16}px`;

			if (ChannelRow.patternHeight < 27) {
				this._channelNameDisplay.style.setProperty("margin-top", "-2px");
				this._channelDropDown.style.setProperty("margin-top", "-4px");
				this._channelNameInput.input.style.setProperty("margin-top", "-4px");
			} else if (ChannelRow.patternHeight < 30) {
				this._channelNameDisplay.style.setProperty("margin-top", "-1px");
				this._channelDropDown.style.setProperty("margin-top", "-3px");
				this._channelNameInput.input.style.setProperty("margin-top", "-3px");
			} else {
				this._channelNameDisplay.style.setProperty("margin-top", "0px");
				this._channelDropDown.style.setProperty("margin-top", "0px");
				this._channelNameInput.input.style.setProperty("margin-top", "-2px");
			}
		}
	}

	private _toggleLoop = (): void => {
		this._doc.synth.loopRepeatCount = this._doc.synth.loopRepeatCount === -1 ? 0 : -1;
		this._doc.prefs.loopEnabled = this._doc.synth.loopRepeatCount === -1;
		this._doc.prefs.save();
		this._updateLoopButton();
		this._doc.notifier.changed();
	};

	private _updateLoopButton = (): void => {
		const active: boolean = this._doc.synth.loopRepeatCount === -1;
		this._loopButton.style.background = active ? "var(--cta-bg)" : "var(--tab-inactive-bg)";
		this._loopButton.style.color = active ? "var(--cta-fg)" : "var(--tab-inactive-fg)";
	};

	private _onLoopMouseEnter = (): void => {
		// Hover accent depends on the loop state: when active, --cta-fg
		// (already the dark contrast text on --cta-bg) remains; when
		// inactive, --primary-text lifts the muted glyph into focus.
		// Mirrors the pre-phase-2 semantic exactly.
		this._loopButton.style.color =
			this._doc.synth.loopRepeatCount === -1 ? "var(--cta-fg)" : "var(--primary-text)";
	};
}
// }
