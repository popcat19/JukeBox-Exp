// prompt-drag.test.ts
//
// Purpose: Verifies reusable prompt dragging behavior and PromptManager wiring

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { attachPromptDrag } from "../editor/core/prompt-drag";

class FakeElement {
	public readonly style: Record<string, string> = {};
	public parent: FakeElement | null = null;
	public tagName = "DIV";
	public clientWidth = 0;
	public clientHeight = 0;
	public width = 0;
	public height = 0;
	private readonly listeners = new Map<string, Set<(event: MouseEvent) => void>>();

	public addEventListener(type: string, listener: (event: MouseEvent) => void): void {
		const listeners = this.listeners.get(type) ?? new Set();
		listeners.add(listener);
		this.listeners.set(type, listeners);
	}
	public removeEventListener(type: string, listener: (event: MouseEvent) => void): void {
		this.listeners.get(type)?.delete(listener);
	}
	public dispatch(
		type: string,
		event: { target?: FakeElement; clientX?: number; clientY?: number },
	): void {
		this.listeners.get(type)?.forEach((listener) => listener(event as unknown as MouseEvent));
	}
	public listenerCount(type: string): number {
		return this.listeners.get(type)?.size ?? 0;
	}
	public closest(selector: string): FakeElement | null {
		if (selector.split(",").some((part) => part.trim() === (this as { selector?: string }).selector)) return this;
		return this.parent?.closest(selector) ?? null;
	}
	public getBoundingClientRect(): DOMRect {
		return { width: this.width, height: this.height } as DOMRect;
	}
}

const originalElement = globalThis.Element;
let ownerDocument: FakeElement;
let container: FakeElement;
let bounds: FakeElement;

beforeEach(() => {
	Object.assign(globalThis, { Element: FakeElement });
	ownerDocument = new FakeElement();
	container = new FakeElement();
	bounds = new FakeElement();
	bounds.clientWidth = 300;
	bounds.clientHeight = 200;
	container.width = 100;
	container.height = 50;
});

afterEach(() => Object.assign(globalThis, { Element: originalElement }));

function attach(onPosition = (_position: { x: number; y: number }): void => {}): () => void {
	return attachPromptDrag({
		container: container as unknown as HTMLElement,
		bounds: bounds as unknown as HTMLElement,
		document: ownerDocument as unknown as Document,
		getPosition: () => ({ x: 20, y: 30 }),
		onPosition,
	});
}

describe("prompt drag", () => {
	test("drags from the whole prompt surface", () => {
		attach();
		const body = new FakeElement();
		body.parent = container;
		container.dispatch("mousedown", { target: body, clientX: 30, clientY: 40 });
		ownerDocument.dispatch("mousemove", { clientX: 80, clientY: 90 });
		expect(container.style.left).toBe("70px");
		expect(container.style.top).toBe("80px");
	});

	test("excludes controls and existing editor surfaces", () => {
		attach();
		for (const excluded of ["INPUT", "BUTTON", "SELECT", "TEXTAREA", ".slider", ".harmonics", ".filterEditor", ".spectrum", ".prompt-dock-divider", ".prompt-dock-slot-divider"]) {
			const target = new FakeElement() as FakeElement & { selector?: string };
			if (excluded.startsWith(".")) target.selector = excluded;
			else target.tagName = excluded;
			container.dispatch("mousedown", { target, clientX: 30, clientY: 40 });
		}
		expect(ownerDocument.listenerCount("mousemove")).toBe(0);
	});

	test("clamps geometry to parent bounds", () => {
		const positions: Array<{ x: number; y: number }> = [];
		attach((position) => positions.push(position));
		container.dispatch("mousedown", { target: container, clientX: 30, clientY: 40 });
		ownerDocument.dispatch("mousemove", { clientX: 999, clientY: 999 });
		expect(positions).toEqual([{ x: 200, y: 150 }]);
	});

	test("cleans active and container listeners without duplicates", () => {
		const dispose = attach();
		container.dispatch("mousedown", { target: container, clientX: 30, clientY: 40 });
		container.dispatch("mousedown", { target: container, clientX: 30, clientY: 40 });
		expect(ownerDocument.listenerCount("mousemove")).toBe(1);
		ownerDocument.dispatch("mouseup", {});
		expect(ownerDocument.listenerCount("mousemove")).toBe(0);
		dispose();
		expect(container.listenerCount("mousedown")).toBe(0);
	});

	test("dispose during drag removes document listeners and ends dragging", () => {
		let dragging = false;
		const dispose = attachPromptDrag({
			container: container as unknown as HTMLElement,
			bounds: bounds as unknown as HTMLElement,
			document: ownerDocument as unknown as Document,
			getPosition: () => ({ x: 20, y: 30 }),
			onStart: () => {
				dragging = true;
			},
			onPosition: () => {},
			onEnd: () => {
				dragging = false;
			},
		});
		container.dispatch("mousedown", { target: container, clientX: 30, clientY: 40 });
		expect(dragging).toBeTrue();
		dispose();
		expect(dragging).toBeFalse();
		expect(ownerDocument.listenerCount("mousemove")).toBe(0);
		expect(ownerDocument.listenerCount("mouseup")).toBe(0);
	});

	test("PromptManager closes and replaces drag attachment immediately", () => {
		const source = readFileSync("editor/core/prompt-manager.ts", "utf8");
		const closeStart = source.indexOf("public close(");
		// Removal is synchronous, so the drag disposer must run before the
		// container leaves the DOM rather than before an exit callback.
		const removeStart = source.indexOf(
			"this._host.promptContainer.removeChild(target.container)",
			closeStart,
		);
		const closeDragDispose = source.indexOf("this._promptDragDisposers.get(prompt)?.();", closeStart);
		const attachStart = source.indexOf("private _attachDrag(");
		const helperAttach = source.indexOf("const dispose = attachPromptDrag({", attachStart);
		const replaceDispose = source.indexOf("this._promptDragDisposers.get(prompt)?.();", attachStart);
		expect(closeDragDispose).toBeGreaterThan(closeStart);
		expect(removeStart).toBeGreaterThan(closeStart);
		expect(closeDragDispose).toBeLessThan(removeStart);
		expect(replaceDispose).toBeGreaterThan(attachStart);
		expect(replaceDispose).toBeLessThan(helperAttach);
		expect(source.slice(attachStart, helperAttach)).toContain("this._promptDragDisposers.delete(prompt);");
		expect(source).toContain("this._draggingPrompt = false;");
	});

	test("PromptManager delegates drag behavior to shared helper", () => {
		const source = readFileSync("editor/core/prompt-manager.ts", "utf8");
		expect(source).toContain('import { attachPromptDrag } from "./prompt-drag";');
		expect(source).toContain("const dispose = attachPromptDrag({");
		expect(source).not.toContain('document.addEventListener("mouseup", onUp)');
	});
});
