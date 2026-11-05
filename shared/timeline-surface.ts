// Timeline Surface
//
// Purpose: Defines the minimal element and synth fields needed to render a song timeline and playhead
//
// This module:
// - Lets editor and player share timeline rendering without importing each other

import type { Synth } from "../synth";

export interface TimelineSurface {
	synth: Synth;
	timeline: SVGSVGElement;
	playhead: HTMLDivElement;
	timelineContainer: HTMLDivElement;
	visualizationContainer: HTMLDivElement;
}
