// PromptFocusController
//
// Purpose: Manages Hyprland-style focus behavior for prompt dialogs
//
// This module:
// - Handles focus-on-spawn with focus-hold until cursor movement
// - Transitions to hover-based focus after first cursor movement
// - Coordinates between prompts and song editor for focus handoff

import type { Prompt } from "../prompts/prompt";

export interface PromptFocusHost {
	isDraggingPrompt(): boolean;
	getFocusedPrompt(): Prompt | null;
	setFocusedPrompt(prompt: Prompt | null): void;
	updatePromptFocus(): void;
	refocusSongEditor(): void;
	isInPromptContainer(element: HTMLElement | null): boolean;
}

export class PromptFocusController {
	private holdFocus: boolean = false;
	private cursorMoved: boolean = false;
	private mouseInPrompt: boolean = false;
	private cleanupFns = new Map<Prompt, Array<() => void>>();
	private lastFocusedElement: HTMLElement | null = null;

	constructor(private host: PromptFocusHost) {}

	getHoldFocus(): boolean {
		return this.holdFocus;
	}

	shouldPromptReceiveKeys(prompt: Prompt | null): boolean {
		if (!prompt) return false;
		if (this.holdFocus) return true;
		// Focus ownership decides key routing, not pointer position. A prompt
		// whose own control has focus must keep receiving Enter, Escape, and
		// arrow keys after the cursor wanders off it; a prompt with no focus
		// inside still answers to hover so click-then-type keeps working.
		const active = document.activeElement;
		if (active !== null && active !== document.body && prompt.container.contains(active)) {
			return true;
		}
		try {
			return prompt.container.matches(":hover");
		} catch {
			return false;
		}
	}

	attachPrompt(prompt: Prompt): void {
		this.detachPrompt(prompt);
		const cleanupFns: Array<() => void> = [];
		this.cleanupFns.set(prompt, cleanupFns);
		this.holdFocus = true;
		this.cursorMoved = false;
		this.mouseInPrompt = true;

		prompt.container.setAttribute("tabindex", "-1");
		prompt.container.focus({ preventScroll: true });

		const checkCursorOverPrompt = (e: MouseEvent): boolean => {
			const topmost = document.elementFromPoint(e.clientX, e.clientY);
			return topmost !== null && prompt.container.contains(topmost);
		};

		const refocusSongEditor = (): void => {
			if (this.host.getFocusedPrompt() === prompt) {
				this.host.setFocusedPrompt(null);
				this.host.updatePromptFocus();
			}
			this.host.refocusSongEditor();
		};

		const onFirstMouseMove = (e: MouseEvent): void => {
			if (this.cursorMoved) return;
			this.cursorMoved = true;
			this.holdFocus = false;
			this.mouseInPrompt = checkCursorOverPrompt(e);
			if (!this.mouseInPrompt) {
				refocusSongEditor();
			}
			document.removeEventListener("mousemove", onFirstMouseMove);
		};
		document.addEventListener("mousemove", onFirstMouseMove);
		cleanupFns.push(() => {
			document.removeEventListener("mousemove", onFirstMouseMove);
		});

		const onMouseEnter = (): void => {
			if (this.host.isDraggingPrompt()) return;
			this.mouseInPrompt = true;
			if (!this.cursorMoved) return;
			if (this.host.getFocusedPrompt() !== prompt) {
				this.host.setFocusedPrompt(prompt);
				this.host.updatePromptFocus();
			}
			if (!prompt.container.contains(document.activeElement)) {
				if (this.lastFocusedElement && prompt.container.contains(this.lastFocusedElement)) {
					this.lastFocusedElement.focus({ preventScroll: true });
				} else {
					prompt.container.focus({ preventScroll: true });
				}
			}
		};
		prompt.container.addEventListener("mouseenter", onMouseEnter);
		cleanupFns.push(() => {
			prompt.container.removeEventListener("mouseenter", onMouseEnter);
		});

		const onFocusIn = (): void => {
			if (!this.cursorMoved || !this.mouseInPrompt) return;
			if (this.host.getFocusedPrompt() !== prompt) {
				this.host.setFocusedPrompt(prompt);
				this.host.updatePromptFocus();
			}
		};
		prompt.container.addEventListener("focusin", onFocusIn);
		cleanupFns.push(() => {
			prompt.container.removeEventListener("focusin", onFocusIn);
		});

		const onMouseLeave = (e: Event): void => {
			if (this.host.isDraggingPrompt()) return;
			this.mouseInPrompt = false;
			if (!this.cursorMoved) return;
			const related = (e as MouseEvent).relatedTarget as HTMLElement;
			if (related && this.host.isInPromptContainer(related)) return;
			if (document.activeElement && prompt.container.contains(document.activeElement)) {
				this.lastFocusedElement = document.activeElement as HTMLElement;
			}
			refocusSongEditor();
		};
		prompt.container.addEventListener("mouseleave", onMouseLeave);
		cleanupFns.push(() => {
			prompt.container.removeEventListener("mouseleave", onMouseLeave);
		});

		const onMouseDown = (e: Event): void => {
			if (this.host.getFocusedPrompt() !== prompt) {
				this.host.setFocusedPrompt(prompt);
				this.host.updatePromptFocus();
			}
			const target = e.target as HTMLElement;
			if (
				!(target instanceof HTMLInputElement) &&
				!(target instanceof HTMLButtonElement) &&
				!(target instanceof HTMLSelectElement) &&
				!(target instanceof HTMLTextAreaElement)
			) {
				prompt.container.focus({ preventScroll: true });
			}
		};
		prompt.container.addEventListener("mousedown", onMouseDown);
		cleanupFns.push(() => {
			prompt.container.removeEventListener("mousedown", onMouseDown);
		});
	}

	detachPrompt(prompt: Prompt): void {
		const cleanupFns = this.cleanupFns.get(prompt);
		if (cleanupFns === undefined) return;
		for (const cleanup of cleanupFns) cleanup();
		this.cleanupFns.delete(prompt);
		if (this.cleanupFns.size === 0) this.holdFocus = false;
	}

	detachAll(): void {
		this.holdFocus = false;
		for (const prompt of [...this.cleanupFns.keys()]) this.detachPrompt(prompt);
	}
}
