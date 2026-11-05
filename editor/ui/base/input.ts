// Base Input
//
// Purpose: Parent factory for all input element variants
//
// This module:
// - Provides the foundational input element factory
// - Child variants extend this with specific styling and behavior

import { HTML } from "imperative-html/dist/esm/elements-strict";

export interface InputOptions {
	placeholder?: string;
	min?: string;
	max?: string;
	step?: string;
	value?: string;
	class?: string;
	"data-*"?: string;
}

const WHEEL_BOUND = "wheelStepBound";

export function addWheelSupport(input: HTMLInputElement): void {
	// createInput attaches wheel support to every number field, and several
	// prompts call this again explicitly. Without the guard, each extra call
	// adds a listener and a single wheel notch steps twice.
	if (input.dataset[WHEEL_BOUND] === "true") return;
	input.dataset[WHEEL_BOUND] = "true";
	input.addEventListener(
		"wheel",
		(event: WheelEvent) => {
			if (window.localStorage.getItem("enableScrollStep") !== "true") return;
			if (!Number.isFinite(event.deltaY) || event.deltaY === 0) return;

			const current = Number(input.value);
			if (input.value.trim() === "" || !Number.isFinite(current)) return;

			const parsedStep = Number.parseFloat(input.step);
			const step = Number.isFinite(parsedStep) && parsedStep !== 0 ? Math.abs(parsedStep) : 1;
			const parsedMin = Number(input.min);
			const parsedMax = Number(input.max);
			const min = input.min !== "" && Number.isFinite(parsedMin) ? parsedMin : -Infinity;
			const max = input.max !== "" && Number.isFinite(parsedMax) ? parsedMax : Infinity;
			const next = Math.min(max, Math.max(min, current + (event.deltaY > 0 ? -step : step)));
			if (!Number.isFinite(next) || next === current) return;

			event.preventDefault();
			input.value = String(next);
			input.dispatchEvent(new Event("input", { bubbles: true }));
			input.dispatchEvent(new Event("change", { bubbles: true }));
		},
		{ passive: false },
	);
}

export function createInput(
	type: string,
	baseStyle: string,
	options?: InputOptions,
): HTMLInputElement {
	const attrs: Record<string, string> = {
		type,
		style: baseStyle,
	};

	if (options?.placeholder) attrs.placeholder = options.placeholder;
	if (options?.min) attrs.min = options.min;
	if (options?.max) attrs.max = options.max;
	if (options?.step) attrs.step = options.step;
	if (options?.value) attrs.value = options.value;
	if (options?.class) attrs.class = options.class;

	const inputEl = HTML.input(attrs);

	if (type === "number") {
		addWheelSupport(inputEl);
	}

	return inputEl;
}
