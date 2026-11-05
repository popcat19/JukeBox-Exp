// Layout
//
// Purpose: Manages editor layout modes and responsive CSS grid configuration
//
// This module:
// - Defines layout variants (small, long, tall, wide, AB Special, focus)
// - Injects layout-specific CSS into the document via style element

// Copyright (c) 2012-2022 John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

import { ColorConfig } from "../../../shared/color-config";
import { injectGlobalStyles } from "../../../shared/styles/inject";

export class Layout {
	private static readonly _webkitScrollbarCSS: string = `\
.beepboxEditor .trackAndMuteContainer::-webkit-scrollbar {
	width: 20px;
	height: 20px;
}
.beepboxEditor .trackAndMuteContainer::-webkit-scrollbar-track {
	background: ${ColorConfig.editorBackground};
}
.beepboxEditor .trackAndMuteContainer::-webkit-scrollbar-thumb {
	background-color: ${ColorConfig.uiWidgetBackground};
	border: 3px solid ${ColorConfig.editorBackground};
}
.beepboxEditor .trackAndMuteContainer::-webkit-scrollbar-corner {
	background-color: ${ColorConfig.editorBackground};
}`;

	// CSS rules shared by all non-small layout variants — injected into each @media block.
	private static readonly _baseLayoutCSS: string = `\
#beepboxEditorContainer {
	max-width: initial;
	height: 100vh;
	padding: 0px !important;
}
.beepboxEditor {
	width: 100%;
	height: 100vh;
}
.beepboxEditor .pattern-area {
	width: 100%;
	height: 100%;
}
.beepboxEditor .instrument-settings-area > .editor-controls {
	position: absolute;
	width: 100%;
}
.beepboxEditor .trackContainer {
	overflow: visible;
}`;

	private static readonly _layoutMap: { [K: string]: string } = {
		small: `\
#beepboxEditorContainer {
	height: 100vh;
	min-height: initial;
}
.beepboxEditor {
	height: 100vh;
	overflow-y: auto;
}`,
		long: `\

			/* long layout */
			@media (min-width: 711px) {
				${Layout._baseLayoutCSS}
				.beepboxEditor .barScrollBar {
					display: none;
				}
				.beepboxEditor {
					grid-template-columns: minmax(0, 1fr) 390px;
					grid-template-rows: minmax(481px, 1fr) minmax(0, min-content);
					grid-template-areas: "pattern-area settings-area" "track-area track-area";
				}
				.beepboxEditor .track-area {
					width: 100%;
					display: flex;
					flex-direction: column;
				}
				.beepboxEditor .trackAndMuteContainer {
					width: 100%;
					min-height: 0;
					flex: 1;
					overflow: auto;
					max-height: 97.5vh;
				}
				.beepboxEditor .instrument-settings-area {
					overflow-y: auto;
					position: relative;
				}
				.beepboxEditor .song-settings-area {
					overflow-y: auto;
				}
				.beepboxEditor .settings-area {
					width: 390px;
					grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
					grid-template-rows: auto auto auto minmax(0, 1fr);
					grid-template-areas:
						"instrument-settings-area version-area"
						"instrument-settings-area play-pause-area"
						"instrument-settings-area menu-area"
						"instrument-settings-area song-settings-area";
				}
				.beepboxEditor.selectRow {
					height: 2em;
				}
				.beepboxEditor .operatorRow {
					height: 2em;
				}
				.beepboxEditor .trackAndMuteContainer {
					max-height: 446px;
				}
				.beepboxEditor .trackAndMuteContainer {
					scrollbar-width: auto;
				}
				${Layout._webkitScrollbarCSS}
			}
		`,
		tall: `\
		/* tall layout */
		@media (min-width: 711px) {
			${Layout._baseLayoutCSS}
			.beepboxEditor .barScrollBar {
				display: none;
			}
			.beepboxEditor {
				grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 192px;
				grid-template-rows: 1fr;
				grid-template-areas: "track-area pattern-area settings-area";
			}
			.beepboxEditor .track-area {
				width: 100%;
				height: 100%;
				display: flex;
				flex-direction: column;
				justify-content: center;
			}
			.beepboxEditor .trackAndMuteContainer {
				width: 100%;
				min-height: 0;
				flex: 0;
				overflow: auto;
				flex-basis: initial;
				flex-grow: 0;
				max-height: 97.5vh;
			}
			.beepboxEditor .settings-area {
				width: 192px;
				position: relative;
				overflow-y: auto;
				grid-template-columns: minmax(0, 1fr);
				grid-template-rows: auto auto auto auto minmax(0, 1fr);
				grid-template-areas:
					"version-area"
					"play-pause-area"
					"menu-area"
					"song-settings-area"
					"instrument-settings-area";
			}
			.beepboxEditor .version-area {
				position: sticky;
				top: 0;
				z-index: 1;
				background: ${ColorConfig.editorBackground};
			}
			.beepboxEditor .play-pause-area {
				position: sticky;
				top: 22px;
				z-index: 1;
				background: ${ColorConfig.editorBackground};
			}
			.beepboxEditor .menu-area {
				position: sticky;
				top: 82px;
				z-index: 1;
				background: ${ColorConfig.editorBackground};
			}
			.beepboxEditor .trackAndMuteContainer {
				scrollbar-width: auto;
			}
			${Layout._webkitScrollbarCSS}
		}
	`,
		wide: `\
			/* wide (JB) layout */
			@media (min-width: 1001px) {
				${Layout._baseLayoutCSS}
				.beepboxEditor {
					grid-template-columns: 512px minmax(0, 1fr) 30em;
					grid-template-rows: minmax(481px, 1fr) min-content;
					grid-template-areas: "track-area pattern-area settings-area" "track-area track-area track-area";
				}
				.beepboxEditor .track-area {
					width: 100%;
					height: 100%;
					max-height: 100%
				}
				.beepboxEditor .editor-widget-column {
					flex: 0;
				}
				.beepboxEditor .trackAndMuteContainer {
					width: 100%;
					flex: 0;
					flex-basis: initial;
					flex-grow: 0;
					overflow-y: auto;
					max-height: 97.5vh;
				}
				.beepboxEditor .instrument-settings-area {
					overflow-y: auto;
					position: relative;
				}
				.beepboxEditor .song-settings-area {
					overflow-y: auto;
				}
				.beepboxEditor .settings-area {
					width: 30em;
					grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
					grid-template-rows: auto auto auto minmax(0, 1fr);
					grid-template-areas:
						"instrument-settings-area version-area"
						"instrument-settings-area play-pause-area"
						"instrument-settings-area menu-area"
						"instrument-settings-area song-settings-area";
				}
				.beepboxEditor .version-area {
					position: sticky;
					top: 0;
					z-index: 1;
					background: ${ColorConfig.editorBackground};
				}
				.beepboxEditor .play-pause-area {
					position: sticky;
					top: 22px;
					z-index: 1;
					background: ${ColorConfig.editorBackground};
				}
				.beepboxEditor .menu-area {
					position: sticky;
					top: 82px;
					z-index: 1;
					background: ${ColorConfig.editorBackground};
				}
			}
		`,
		"AbyssBox Special": `\

            	/* AB Special layout */
			@media (min-width: 711px) {
				${Layout._baseLayoutCSS}
				.beepboxEditor .barScrollBar {
					display: none;
				}
				.beepboxEditor {
					grid-template-columns: 390px minmax(0, 1fr);
					grid-template-rows: minmax(481px, 1fr) minmax(0, min-content);
					grid-template-areas: "settings-area pattern-area" "track-area track-area";
				}
				.beepboxEditor .track-area {
					width: 100%;
					display: flex;
					flex-direction: column;
				}
				.beepboxEditor .trackAndMuteContainer {
					width: 100%;
					min-height: 0;
					flex: 1;
					overflow: auto;
					max-height: 97.5vh;
				}
				.beepboxEditor .instrument-settings-area {
					overflow-y: auto;
					position: relative;
				}
				.beepboxEditor .song-settings-area {
					overflow-y: auto;
				}
				.beepboxEditor .settings-area {
					width: 30em;
					grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
					grid-template-rows: auto auto auto minmax(0, 1fr);
					grid-template-areas:
						"version-area instrument-settings-area"
						"play-pause-area instrument-settings-area"
						"menu-area instrument-settings-area"
						"song-settings-area instrument-settings-area";
				}
				.beepboxEditor.selectRow {
					height: 2em;
				}
				.beepboxEditor .operatorRow {
					height: 2em;
				}
				.beepboxEditor .trackAndMuteContainer {
					max-height: 446px;
				}
				.beepboxEditor .trackAndMuteContainer {
					scrollbar-width: auto;
					scrollbar-color: ${ColorConfig.scrollbarColor} ${ColorConfig.uiWidgetBackground} ${ColorConfig.editorBackground};
				}
				${Layout._webkitScrollbarCSS}
			}
		`,
		"long (AB)": `\

			/* focus layout */
			@media (min-width: 711px) {
				${Layout._baseLayoutCSS}
				.beepboxEditor .barScrollBar {
					display: none;
				}
				.beepboxEditor {
					grid-template-columns: minmax(0, 1fr) 390px;
					grid-template-rows: minmax(481px, 1fr) minmax(0, min-content);
					grid-template-areas: "pattern-area settings-area" "track-area";
				}
				.beepboxEditor .trackAndMuteContainer {
					width: 100%;
					min-height: 0;
					flex: 1;
					overflow: auto;
					max-height: 97.5vh;
				}
				.beepboxEditor .instrument-settings-area {
					overflow-y: auto;
					position: relative;
				}
				.beepboxEditor .song-settings-area {
					overflow-y: auto;
				}
				.beepboxEditor .settings-area {
					width: 30em;
					grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
					grid-template-rows: auto auto auto minmax(0, 1fr);
					grid-template-areas:
						"instrument-settings-area version-area"
						"instrument-settings-area play-pause-area"
						"instrument-settings-area menu-area"
						"instrument-settings-area song-settings-area";
				}
				.beepboxEditor.selectRow {
					height: 2em;
				}
				.beepboxEditor .operatorRow {
					height: 2em;
				}
				.beepboxEditor .trackAndMuteContainer {
					max-height: 446px;
				}
				.beepboxEditor .trackAndMuteContainer {
					scrollbar-width: auto;
					scrollbar-color: ${ColorConfig.scrollbarColor} ${ColorConfig.uiWidgetBackground} ${ColorConfig.editorBackground};
				}
				${Layout._webkitScrollbarCSS}
				div.track-area {
					display: flex;
				}
			}
		`,
		focus: `\

			/* focus layout */
			@media (min-width: 711px) {
				${Layout._baseLayoutCSS}
				.beepboxEditor .barScrollBar {
					display: none;
				}
				.beepboxEditor {
					grid-template-columns: minmax(0, 1fr) 190px;
					grid-template-rows: minmax(481px, 1fr) minmax(0, min-content);
					grid-template-areas: "pattern-area settings-area" "track-area track-area";
				}
				.beepboxEditor .trackAndMuteContainer {
					width: 100%;
					min-height: 0;
					flex: 1;
					overflow: auto;
					max-height: 97.5vh;
				}
				.beepboxEditor .instrument-settings-area {
					overflow-y: auto;
					position: relative;
				}
				.beepboxEditor .settings-area {
					width: 100%;
					position: relative;
					overflow-y: auto;
					grid-template-columns: minmax(0, 1fr);
					grid-template-rows: auto auto auto auto minmax(0, 1fr);
					grid-template-areas:
						"version-area"
						"play-pause-area"
						"menu-area"
						"song-settings-area"
						"instrument-settings-area";
				}
				.beepboxEditor.selectRow {
					height: 2em;
				}
				.beepboxEditor .operatorRow {
					height: 2em;
				}
				.beepboxEditor .trackAndMuteContainer {
					max-height: 446px;
				}
				.beepboxEditor .trackAndMuteContainer {
					scrollbar-width: auto;
					scrollbar-color: ${ColorConfig.scrollbarColor} ${ColorConfig.uiWidgetBackground} ${ColorConfig.editorBackground};
				}
				${Layout._webkitScrollbarCSS}
				div.track-area {
					display: flex;
				}
			}
		`,
		theatre: `\

		/* Theatre layout */
		@media (min-width: 711px) {
			${Layout._baseLayoutCSS}
			.beepboxEditor .barScrollBar {
				display: none;
			}
			.beepboxEditor {
				height: 200vh;
				grid-template-columns: minmax(0, 1fr) 390px;
				grid-template-rows: minmax(480px, 50%) minmax(0, 50%);
				grid-template-areas:
			"pattern-area pattern-area "
			"track-area settings-area";
			  }
			.beepboxEditor .track-area {
				width: 100%;
				display: flex;
				flex-direction: column;
			}
			.beepboxEditor .trackAndMuteContainer {
				width: 100%;
				min-height: 0;
				flex: 1;
				overflow: auto;
				max-height: 97.5vh;
			}
			.beepboxEditor .instrument-settings-area {
				overflow-y: auto;
				position: relative;
			}
			.beepboxEditor .song-settings-area {
				overflow-y: auto;
			}
			.beepboxEditor .settings-area {
				width: 390px;
				grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
				grid-template-rows: auto auto auto minmax(0, 1fr);
				grid-template-areas:
					"instrument-settings-area version-area"
					"instrument-settings-area play-pause-area"
					"instrument-settings-area menu-area"
					"instrument-settings-area song-settings-area";
			}
			.beepboxEditor.selectRow {
				height: 2em;
			}
			.beepboxEditor .operatorRow {
				height: 2em;
			}
			.beepboxEditor .trackAndMuteContainer {
				max-height: 100%;
			}
			.beepboxEditor .trackAndMuteContainer {
				scrollbar-width: auto;
				scrollbar-color: ${ColorConfig.scrollbarColor} ${ColorConfig.uiWidgetBackground} ${ColorConfig.editorBackground};
			}
			${Layout._webkitScrollbarCSS}
		}
	`,
		"Upside Down": `\

				/* Upside Down */
			@media (min-width: 711px) {
				${Layout._baseLayoutCSS}
				.beepboxEditor .barScrollBar {
					display: none;
				}
				.beepboxEditor {
					grid-template-columns: 195px minmax(0, 1fr);
					grid-template-rows: minmax(0, min-content) minmax(481px, 1fr);
					grid-template-areas: "settings-area track-area" "settings-area pattern-area";
				}
				.beepboxEditor .track-area {
					width: 100%;
					display: flex;
					flex-direction: column;
				}
				.beepboxEditor .trackAndMuteContainer {
					width: 100%;
					min-height: 0;
					flex: 1;
					overflow: auto;
					max-height: 97.5vh;
				}
				.beepboxEditor .instrument-settings-area {
					overflow-y: auto;
					position: relative;
				}
				.beepboxEditor .song-settings-area {
					overflow-y: auto;
				}
				.beepboxEditor .settings-area {
					width: 100%;
					position: relative;
					overflow-y: auto;
					grid-template-columns: minmax(0, 1fr);
					grid-template-rows: auto auto auto auto minmax(0, 1fr);
					grid-template-areas:
						"version-area"
						"play-pause-area"
						"menu-area"
						"song-settings-area"
						"instrument-settings-area";
				}
				.beepboxEditor.selectRow {
					height: 2em;
				}
				.beepboxEditor .operatorRow {
					height: 2em;
				}
				.beepboxEditor .trackAndMuteContainer {
					max-height: 446px;
				}
				.beepboxEditor .trackAndMuteContainer {
					scrollbar-width: auto;
					scrollbar-color: ${ColorConfig.scrollbarColor} ${ColorConfig.uiWidgetBackground} ${ColorConfig.editorBackground};
				}
				${Layout._webkitScrollbarCSS}
			}
			`,
	};

	private static _styleElement: HTMLStyleElement = null!;
	private static _initialized = false;
	private static _ensureInit(): void {
		if (!Layout._initialized && typeof document !== "undefined") {
			Layout._styleElement = injectGlobalStyles(document, "layout", "");
			Layout._initialized = true;
		}
	}

	public static setLayout(layout: string): void {
		Layout._ensureInit();
		Layout._styleElement.textContent = Layout._layoutMap[layout];
		window.dispatchEvent(new Event("resize"));
		window.dispatchEvent(new Event("scroll"));
	}
}
