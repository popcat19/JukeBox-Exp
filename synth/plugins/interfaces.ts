// interfaces.ts
//
// Purpose: Plugin interface types for the synth plugin registry
//
// This module:
// - Defines SynthPlugin interface for per-instrument synthesis dispatch
// - Defines EditorRowName for data-driven editor row visibility
// - Allows future plugins to self-register without modifying synth.ts

import type { Instrument } from "../instruments";
import type { InstrumentType } from "../synth-config";
import type { PluginHost } from "./host";

export type EditorRowName =
	| "waveSelect"
	| "loopControls"
	| "noiseSelect"
	| "spectrum"
	| "harmonics"
	| "stringSustain"
	| "drumset"
	| "customWave"
	| "supersaw"
	| "pulseWidth"
	| "fm"
	| "fm6";

export interface SynthPlugin {
	readonly type: InstrumentType;
	readonly name: string;
	readonly displayName?: string;
	readonly editorRows: readonly EditorRowName[];
	initialize?: (instrument: Instrument) => void;
	serialize?(instrument: Instrument, json: Record<string, any>): void;
	deserialize?(instrument: Instrument, json: Record<string, any>): void;
	getSynthFunction(instrument: Instrument, synth: PluginHost): Function;
	buildSource(instrument: Instrument, voiceCount?: number): string;
}
