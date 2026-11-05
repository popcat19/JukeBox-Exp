// InputHelpers
//
// Purpose: Shared validation and layout helpers for prompt dialogs
//
// This module:
// - Provides number input validation (key filtering, blur clamping)
// - Manages play/pause button state toggling
// - Provides close handler factory for prompt-like components

import type { SongDocument } from "../song-document";
import type { Prompt } from "./prompt";

export function validateKey(event: KeyboardEvent): boolean {
	const charCode = event.which ? event.which : event.keyCode;
	if (charCode !== 46 && charCode > 31 && (charCode < 48 || charCode > 57)) {
		event.preventDefault();
		return true;
	}
	return false;
}

export function validateNumber(event: Event): void {
	const el: HTMLInputElement = <HTMLInputElement>event.target;
	el.value = String(validate(el));
}

export function validate(input: HTMLInputElement): number {
	const min = Number(input.min);
	const max = Number(input.max);
	const raw = Number(input.value);
	// Empty or malformed text parses to NaN, and Math.max/min propagate NaN,
	// so every caller recorded a NaN numeric setting. Fall back to the bound
	// the field already declares.
	const value = Number.isFinite(raw) ? raw : Number.isFinite(min) ? min : 0;
	const lower = Number.isFinite(min) ? min : value;
	const upper = Number.isFinite(max) ? max : value;
	return Math.floor(Math.max(lower, Math.min(upper, value)));
}

export function updatePlayButton(btn: HTMLButtonElement, playing: boolean): void {
	if (playing) {
		btn.classList.remove("playButton");
		btn.classList.add("pauseButton");
		btn.title = "Pause (Space)";
		btn.innerText = "Pause";
	} else {
		btn.classList.remove("pauseButton");
		btn.classList.add("playButton");
		btn.title = "Play (Space)";
		btn.innerText = "Play";
	}
}

export function closePrompt(
	doc: SongDocument,
	closeCallback: ((prompt: Prompt) => void) | undefined | null,
	prompt: Prompt,
): void {
	if (closeCallback) {
		closeCallback(prompt);
	} else {
		doc.prompt = null;
	}
}
