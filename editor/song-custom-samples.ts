// song-custom-samples.ts
//
// Purpose: Bridges Song's custom sample callbacks to EditorConfig state
//
// This module:
// - Creates a CustomSampleHandler using EditorConfig
// - Provides createCustomSampleHandler to pass to Song constructor
// - Stages every decode against a side-effect-free handler before the live handler runs
//
// decodeEditorSong decodes twice. The staged pass keeps samples, preset
// categories and title in local values and touches no global, so any decode
// error surfaces before state changes. The live pass is the single commit step
// and is the only writer of Config.chipWaves, Config.rawChipWaves,
// Config.rawRawChipWaves, Config.willReloadForCustomSamples, sample loading
// state, EditorConfig.customSamples, EditorConfig.presetCategories and
// document.title. It runs only after the staged pass succeeds on identical input.

import { type CustomSampleHandler, Song } from "../synth";
import { EditorConfig } from "./config/editor-config";

export function createStagedSampleHandler(): CustomSampleHandler {
	let samples: string[] | null = EditorConfig.customSamples?.slice() ?? null;
	const categories: any[] = [];

	return {
		deferSampleLoading: true,
		getCustomSamples(): string[] | null {
			return samples;
		},
		setCustomSamples(urls: string[]): void {
			samples = urls.slice();
		},
		getPresetCategories(): any[] {
			return EditorConfig.presetCategories.concat(categories);
		},
		addPresetCategory(category: any): void {
			categories.push(category);
		},
		nameToPresetValue(name: string): number | null {
			return EditorConfig.nameToPresetValue(name);
		},
		getVersionDisplayName(): string {
			return EditorConfig.versionDisplayName;
		},
		setDocumentTitle(): void {},
		clearSamples(): void {
			samples = null;
		},
	};
}

export function decodeEditorSong(
	serializedSong: string,
	liveHandler: CustomSampleHandler,
	jsonFormat: string = "auto",
): Song {
	const staged = new Song(undefined, createStagedSampleHandler());
	staged.fromBase64String(serializedSong, jsonFormat);

	const song = new Song(undefined, liveHandler);
	song.fromBase64String(serializedSong, jsonFormat);
	return song;
}

export function createCustomSampleHandler(): CustomSampleHandler {
	return {
		getCustomSamples(): string[] | null {
			return EditorConfig.customSamples;
		},
		setCustomSamples(urls: string[]): void {
			EditorConfig.customSamples = urls;
		},
		getPresetCategories(): any[] {
			return EditorConfig.presetCategories;
		},
		addPresetCategory(category: any): void {
			category.index = EditorConfig.presetCategories.length;
			EditorConfig.presetCategories[EditorConfig.presetCategories.length] = category;
		},
		nameToPresetValue(name: string): number | null {
			return EditorConfig.nameToPresetValue(name);
		},
		getVersionDisplayName(): string {
			return EditorConfig.versionDisplayName;
		},
		setDocumentTitle(nextTitle: string): void {
			if (typeof document !== "undefined") {
				document.title = `${nextTitle} - ${EditorConfig.versionDisplayName}`;
			}
		},
		clearSamples(): void {
			EditorConfig.customSamples = null;
		},
	};
}
