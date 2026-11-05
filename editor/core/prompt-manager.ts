// prompt-manager.ts
//
// Purpose: Manages the full lifecycle of editor prompt dialogs
//
// This module:
// - Owns prompt stack, focus, drag, position memory, and enter/exit animation
// - Constructs Prompt subclass instances by name via PromptEditorRefs
// - Handles play/pause state around modal prompt display

import { HarmonicsEditorPrompt } from "../components/harmonics-editor";
import type { PatternEditor } from "../components/pattern-editor";
import { type SpectrumEditor, SpectrumEditorPrompt } from "../components/spectrum-editor";
import { getNavigatorRouteAvailability } from "../navigator/route-catalog";
import { BeatsPerBarPrompt } from "../prompts/beats-per-bar-prompt";
import { ChannelSettingsPrompt } from "../prompts/channel-settings-prompt";
import { CleanChannelPrompt } from "../prompts/clean-channel-prompt";
import { CustomChipPrompt } from "../prompts/custom-chip-prompt";
import { CustomFilterPrompt } from "../prompts/custom-filter-prompt";
import { CustomScalePrompt } from "../prompts/custom-scale-prompt";
import { CustomThemePrompt } from "../prompts/custom-theme-prompt";
import { EuclidgenRhythmPrompt } from "../prompts/euclidgen-rhythm-prompt";
import { ExportPrompt } from "../prompts/export-prompt";
import { ImportPrompt } from "../prompts/import-prompt";
import { InstrumentExportPrompt } from "../prompts/instrument-export-prompt";
import { InstrumentImportPrompt } from "../prompts/instrument-import-prompt";
import { KeyboardShortcutsPrompt } from "../prompts/keyboard-shortcuts-prompt";
import { LayoutPrompt } from "../prompts/layout-prompt";
import { LimiterPrompt } from "../prompts/limiter-prompt";
import { MoveNotesSidewaysPrompt } from "../prompts/move-notes-sideways-prompt";
import { OctaveCountPrompt } from "../prompts/octave-count-prompt";
import { PalettePrompt } from "../prompts/palette-prompt";
import type { Prompt } from "../prompts/prompt";
import { RecordingSetupPrompt } from "../prompts/recording-setup-prompt";
import { SampleLoadingStatusPrompt } from "../prompts/sample-loading-status-prompt";
import { ShortenerConfigPrompt } from "../prompts/shortener-config-prompt";
import { SongDurationPrompt } from "../prompts/song-duration-prompt";
import { SongRecoveryPrompt } from "../prompts/song-recovery-prompt";
import { SustainPrompt } from "../prompts/sustain-prompt";
import { ThemePrompt } from "../prompts/theme-prompt";
import { TipPrompt } from "../prompts/tip-prompt";
import { VisualLoopControlsPrompt } from "../prompts/visual-loop-controls-prompt";
import type { SongDocument } from "../song-document";
import { iconButton } from "../ui";
import { makeLogger } from "./debug-log";
import { PromptDock } from "./prompt-dock";
import { attachPromptDrag } from "./prompt-drag";
import { PromptFocusController } from "./prompt-focus-controller";
import { PromptPopout } from "./prompt-popout";

const log = makeLogger("prompts");

export interface PromptEditorRefs {
	togglePlay(): void;
	muteEditor: { setHoveredChannel(channel: number): void };
	trackEditor: { setHoveredChannel(channel: number): void };
	drumsetSpectrumEditors: SpectrumEditor[];
	patternEditor: PatternEditor;
	trackArea: HTMLDivElement;
	// Opens the ImportPrompt and passes the file for drag-drop import.
	// rafWin, when provided, is the window whose requestAnimationFrame
	// schedules the deferred ChangeSong — needed when the drop targets
	// a popped-out prompt so the work runs on the visible (unthrottled)
	// window instead of the backgrounded main editor.
	handleImportFile(file: File, rafWin?: Window): void;
}

export interface PromptHost {
	doc: SongDocument;
	mainLayer: HTMLDivElement;
	promptContainer: HTMLDivElement;
	refocusStage(): void;
	onLayoutChanged(): void;
}

// Legacy popout cannot transfer Navigator host ownership atomically. Keep it
// disabled until pane extraction supplies a Navigator-owned detached host.
const _popoutCapablePrompts: ReadonlySet<object> = new Set();

export function closePromptFromContextMenu(
	event: MouseEvent,
	prompt: Prompt,
	closeLegacyPrompt: (prompt: Prompt) => void,
): void {
	if (event.defaultPrevented) return;
	if (prompt.closeCallback !== undefined) {
		prompt.closeCallback(prompt);
		return;
	}
	closeLegacyPrompt(prompt);
}

export class PromptPlaybackOwnership {
	private readonly pausingPrompts = new Set<Prompt>();
	private wasPlaying = false;

	open(prompt: Prompt, pausesPlayback: boolean, playing: boolean, pause: () => void): void {
		if (!pausesPlayback || this.pausingPrompts.has(prompt)) return;
		if (this.pausingPrompts.size === 0) {
			this.wasPlaying = playing;
			pause();
		}
		this.pausingPrompts.add(prompt);
	}

	close(prompt: Prompt, play: () => void): void {
		if (!this.pausingPrompts.delete(prompt) || this.pausingPrompts.size !== 0) return;
		if (this.wasPlaying) play();
		this.wasPlaying = false;
	}
}

export class PromptRootOwnership {
	private readonly navigatorOwned = new WeakSet<Prompt>();

	claim(prompt: Prompt): () => void {
		this.navigatorOwned.add(prompt);
		return () => {
			this.navigatorOwned.delete(prompt);
		};
	}

	bringLegacyPromptToFront(prompt: Prompt, legacyHost: HTMLElement): boolean {
		if (this.navigatorOwned.has(prompt)) return false;
		if (legacyHost.lastElementChild !== prompt.container) legacyHost.append(prompt.container);
		return true;
	}
}

const _noPlayPausePrompts: ReadonlySet<Function> = new Set([
	TipPrompt,
	LimiterPrompt,
	CustomChipPrompt,
	CustomFilterPrompt,
	VisualLoopControlsPrompt,
	SustainPrompt,
	HarmonicsEditorPrompt,
	SpectrumEditorPrompt,
	KeyboardShortcutsPrompt,
]);

export class PromptManager {
	private readonly _prompts: Prompt[] = [];
	private _hideContainerTimer: ReturnType<typeof setTimeout> | null = null;
	private _openingForNavigator: boolean = false;
	private _navigatorTipName: string | null = null;
	private _navigatorTipSourceScope: string | null = null;
	// Cursor position and target element rect at last click before a
	// prompt opens. Used by _spawnNearCursor for desktop desktop
	// (near cursor) vs mobile (centered) spawning.
	private _clickInfo: { clientX: number; clientY: number; elRect: DOMRect } | null = null;
	// Last mouse position, updated on mousemove. Used by keybind-triggered
	// prompts (no click event) to spawn near the cursor.
	private _mousePos: { x: number; y: number } = { x: 0, y: 0 };
	private _focusedPrompt: Prompt | null = null;
	private readonly _promptPositions: Map<string, { x: number; y: number }> = new Map();
	private readonly _promptDragDisposers = new Map<Prompt, () => void>();
	private _draggingPrompt: boolean = false;
	private readonly _playbackOwnership = new PromptPlaybackOwnership();
	private readonly _focusController: PromptFocusController;
	private readonly _dock: PromptDock;
	private readonly _popout: PromptPopout;
	private readonly _rootOwnership = new PromptRootOwnership();
	private _transientImport: ImportPrompt | null = null;
	private _transientImportGeneration = 0;
	private _backdropPreference: boolean | null = null;

	constructor(
		private readonly _host: PromptHost,
		private readonly _refs: PromptEditorRefs,
	) {
		// Capture the last clicked element's bounds for caller-relative
		// prompt spawning. Must use capture phase so the target is still
		// valid before prompt open handlers fire.
		document.addEventListener(
			"click",
			(e: MouseEvent) => {
				this._mousePos = { x: e.clientX, y: e.clientY };
				this._clickInfo = {
					clientX: e.clientX,
					clientY: e.clientY,
					elRect: (e.target as HTMLElement).getBoundingClientRect(),
				};
			},
			true,
		);
		document.addEventListener("mousemove", (e: MouseEvent) => {
			this._mousePos = { x: e.clientX, y: e.clientY };
		});

		// Right-click on a hovered prompt closes it without closing
		// other prompts or the browser context menu.
		// Excludes input, button, select, textarea, and slider elements
		// so their native context menu still works.
		document.addEventListener("contextmenu", (e: MouseEvent) => {
			if (e.defaultPrevented) return;
			const target = e.target as HTMLElement;
			const tc = this._host.promptContainer;
			if (!tc.contains(target)) return;
			if (
				target.closest(
					'input, textarea, select, button, a[href], summary, [contenteditable]:not([contenteditable="false"]), [role="button"], [role="link"], [role="slider"], .slider',
				) !== null
			)
				return;
			e.preventDefault();
			for (const p of this._prompts) {
				if (p.container.contains(target)) {
					closePromptFromContextMenu(e, p, (legacyPrompt) => {
						this.close(legacyPrompt);
					});
					return;
				}
			}
		});

		this._focusController = new PromptFocusController({
			isDraggingPrompt: () => this._draggingPrompt,
			getFocusedPrompt: () => this._focusedPrompt,
			setFocusedPrompt: (p) => {
				this._focusedPrompt = p;
			},
			updatePromptFocus: () => {
				this._updatePromptFocus();
			},
			refocusSongEditor: () => {
				this._host.refocusStage();
			},
			isInPromptContainer: (el) => el !== null && this._host.promptContainer.contains(el),
		});

		this._dock = new PromptDock({
			editor: this._host.mainLayer,
			onLayoutChanged: () => {
				this._host.onLayoutChanged();
			},
		});
		this._popout = new PromptPopout({
			onPopoutClosed: (p) => {
				this.close(p);
			},
		});
	}

	public get prompt(): Prompt | null {
		return this._focusedPrompt;
	}

	public get dockController(): PromptDock {
		return this._dock;
	}

	public claimNavigatorOwnership(prompt: Prompt): () => void {
		return this._rootOwnership.claim(prompt);
	}

	public handleImportFile(file: File, rafWin?: Window): void {
		this._transientImport?.cleanUp();
		const prompt = new ImportPrompt(this._host.doc);
		const generation = ++this._transientImportGeneration;
		this._transientImport = prompt;
		const isCurrent = (): boolean =>
			this._transientImport === prompt && this._transientImportGeneration === generation;
		const finish = (): void => {
			if (!isCurrent()) return;
			this._transientImport = null;
			prompt.cleanUp();
		};
		prompt.handleExternalFile(file, rafWin, finish, isCurrent, finish);
	}

	public openForNavigator(promptName: string, context?: unknown): void {
		const tipContext =
			promptName === "tipPromptScope" && context !== null && typeof context === "object"
				? (context as { tipName?: unknown; sourceScope?: unknown })
				: null;
		this._navigatorTipName =
			typeof tipContext?.tipName === "string" ? tipContext.tipName : null;
		this._navigatorTipSourceScope =
			typeof tipContext?.sourceScope === "string" ? tipContext.sourceScope : null;
		this._openingForNavigator = true;
		try {
			this.open(promptName);
		} finally {
			this._openingForNavigator = false;
			this._navigatorTipName = null;
			this._navigatorTipSourceScope = null;
		}
	}

	public syncBackdropPreference(): void {
		const enabled = this._host.doc.prefs.showPromptBackdrop;
		if (this._backdropPreference === enabled) return;
		this._backdropPreference = enabled;
		for (const prompt of this._prompts) this._applyBackdropPreference(prompt);
	}

	public disposeNavigatorPrompt(prompt: Prompt): void {
		const index = this._prompts.indexOf(prompt);
		if (index === -1) return;
		prompt.discard();
		this._prompts.splice(index, 1);
		this._dock.remove(prompt);
		this._popout.closeWindow(prompt);
		this._promptDragDisposers.get(prompt)?.();
		this._promptDragDisposers.delete(prompt);
		this._focusController.detachPrompt(prompt);
		prompt.container.remove();
		prompt.cleanUp();
		if (this._focusedPrompt === prompt) {
			this._focusedPrompt = this._prompts[this._prompts.length - 1] || null;
			this._updatePromptFocus();
		}
		this._playbackOwnership.close(prompt, () => this._host.doc.performance.play());
		this._host.doc.prompt = this._focusedPrompt?.name ?? null;
		this._host.doc.notifier.changed();
	}

	// Programmatic popout for the currently-focused prompt (keybinding).
	public popoutCurrent(): void {
		const p = this._focusedPrompt;
		if (!p || !_popoutCapablePrompts.has(p.constructor)) return;
		if (this._popout.isOpen(p)) return;
		this._dock.undock(p);
		this._popout.open(p);
	}

	private _pendingClickInfo: { clientX: number; clientY: number; elRect: DOMRect } | null = null;

	public open(promptName: string): void {
		log.log("open", promptName, {
			docPrompt: this._host.doc.prompt,
			focused: this._focusedPrompt?.name ?? null,
			stack: this._prompts.map((p) => p.name),
		});
		// For keybind-triggered prompts (no click event), synthesize
		// from last mouse position. Only use cursor when mouse has
		// actually moved to a position > 10px from origin to prevent
		// spawning at the top-left corner if the mouse was never moved
		// or was at an edge position.
		const hasMouse = this._mousePos.x > 10 || this._mousePos.y > 10;
		this._pendingClickInfo =
			this._clickInfo ??
			(hasMouse
				? {
						clientX: this._mousePos.x,
						clientY: this._mousePos.y,
						elRect: new DOMRect(this._mousePos.x - 8, this._mousePos.y - 8, 16, 16),
					}
				: null);
		this._clickInfo = null;

		const availability = getNavigatorRouteAvailability(
			promptName,
			this._host.doc.getCurrentInstrumentObj(),
		);
		if (!availability.available) {
			log.log("open: unavailable focused route", promptName, availability.error);
			return;
		}
		this._host.doc.openPrompt(promptName);
		this._setPrompt(promptName);
	}

	public sync(promptName: string | null): void {
		log.log("sync", promptName, {
			docPrompt: this._host.doc.prompt,
			focused: this._focusedPrompt?.name ?? null,
			stack: this._prompts.map((p) => p.name),
		});
		this._setPrompt(promptName);
	}

	public close(prompt: Prompt | null): void {
		const targetName = prompt?.name ?? this._focusedPrompt?.name ?? null;
		log.log("close", {
			arg: prompt?.name ?? null,
			willClose: targetName,
			stack: this._prompts.map((p) => p.name),
		});
		if (prompt == null) {
			prompt = this._focusedPrompt || this._prompts[this._prompts.length - 1];
		}
		if (prompt) {
			const index = this._prompts.indexOf(prompt);
			if (index !== -1) {
				this._promptDragDisposers.get(prompt)?.();
				this._promptDragDisposers.delete(prompt);
				this._focusController.detachPrompt(prompt);
				prompt.discard();
				this._prompts.splice(index, 1);
				this._playbackOwnership.close(prompt, () => this._host.doc.performance.play());
				this._dock.remove(prompt);
				this._popout.closeWindow(prompt);
				log.log("spliced", prompt.name, {
					stack: this._prompts.map((p) => p.name),
					remaining: this._prompts.length,
				});
				const target = prompt;
				// Removal is synchronous: PMD mandates immediate state changes, so
				// there is no exit animation to wait on. The pointer-events guard
				// on .exiting is unnecessary now that the node leaves the DOM in
				// the same task as the close.
				this._promptDragDisposers.get(target)?.();
				this._promptDragDisposers.delete(target);
				if (target.container.parentNode === this._host.promptContainer) {
					this._host.promptContainer.removeChild(target.container);
				}
				target.cleanUp();
				if (this._focusedPrompt === target) {
					this._focusedPrompt = this._prompts[this._prompts.length - 1] || null;
					this._updatePromptFocus();
				}
				const nextName = this._focusedPrompt ? this._focusedPrompt.name! : null;
				this._host.doc.prompt = nextName;
				this._host.doc.notifier.changed();
			}
		}
		if (this._prompts.length === 0 && prompt != null) {
			this._focusController.detachAll();
			// If a new prompt is opened before this timer fires, the
			// setTimeout would run afterwards and set display:none on
			// the container, hiding the newly opened prompt. Track the
			// timer so _setPrompt can cancel it.
			if (this._hideContainerTimer != null) clearTimeout(this._hideContainerTimer);
			this._hideContainerTimer = setTimeout(() => {
				this._host.promptContainer.style.display = "none";
				this._hideContainerTimer = null;
			}, 150);
			this._host.refocusStage();
		}
	}

	public shouldReceiveKeys(): boolean {
		return this._focusController.shouldPromptReceiveKeys(this._focusedPrompt);
	}

	public repositionOutOfBounds(): void {
		const containerWidth = this._host.mainLayer.clientWidth;
		const containerHeight = this._host.mainLayer.clientHeight;
		for (const p of this._prompts) {
			if (this._dock.isDocked(p)) continue;
			if (this._popout.isOpen(p)) continue;
			const savedPos = this._promptPositions.get(p.name!);
			if (!savedPos) continue;
			const pw: number = p.container.offsetWidth;
			const ph: number = p.container.offsetHeight;
			let { x, y } = savedPos;
			if (x < 0 || y < 0 || x + pw > containerWidth || y + ph > containerHeight) {
				x = Math.max(0, Math.min(x, containerWidth - pw));
				y = Math.max(0, Math.min(y, containerHeight - ph));
				p.container.style.left = `${x}px`;
				p.container.style.top = `${y}px`;
				this._promptPositions.set(p.name!, { x, y });
			}
		}
	}

	private _applyBackdropPreference(prompt: Prompt): void {
		prompt.container.style.boxShadow = "none";
		const docked = this._dock.isDocked(prompt);
		const popped = this._popout.isOpen(prompt);
		if (docked || popped) {
			prompt.container.style.removeProperty("--prompt-backdrop-filter");
			prompt.container.style.removeProperty("--prompt-bg-color");
			prompt.container.style.background = "";
			prompt.container.style.opacity = "";
		} else if (this._host.doc.prefs.showPromptBackdrop) {
			prompt.container.style.setProperty("--prompt-backdrop-filter", "blur(24px)");
			prompt.container.style.setProperty("--prompt-bg-color", "var(--prompt-backdrop-color)");
			prompt.container.style.background = "";
		} else {
			prompt.container.style.setProperty("--prompt-backdrop-filter", "none");
			prompt.container.style.setProperty("--prompt-bg-color", "transparent");
			prompt.container.style.background = "";
			prompt.container.style.opacity = "";
		}
	}

	private _updatePromptFocus(): void {
		const activeEl = document.activeElement;
		const wasInPrompt = this._host.promptContainer.contains(activeEl);
		for (const p of this._prompts) {
			this._applyBackdropPreference(p);
			const docked = this._dock.isDocked(p);
			const popped = this._popout.isOpen(p);
			if (p === this._focusedPrompt) {
				p.container.classList.add("focused");
				if (!docked && !popped) {
					this._rootOwnership.bringLegacyPromptToFront(p, this._host.promptContainer);
				}
			} else {
				p.container.classList.remove("focused");
			}
		}
		if (
			wasInPrompt &&
			activeEl instanceof HTMLElement &&
			!this._host.promptContainer.contains(document.activeElement)
		) {
			activeEl.focus({ preventScroll: true });
		}
	}

	private _setPrompt(promptName: string | null): void {
		if (promptName == null) {
			this.close(null);
			return;
		}
		const existing = this._prompts.find((p) => p.name === promptName);
		if (existing) {
			log.log("_setPrompt: existing found, refocusing", promptName, {
				stack: this._prompts.map((p) => p.name),
			});
			this._focusedPrompt = existing;
			this._updatePromptFocus();
			return;
		}

		log.log("_setPrompt: creating new", promptName);
		const availability = getNavigatorRouteAvailability(
			promptName,
			this._host.doc.getCurrentInstrumentObj(),
		);
		if (!availability.available) {
			log.log("_setPrompt: unavailable focused route", promptName, availability.error);
			return;
		}

		const doc = this._host.doc;
		const refs = this._refs;
		let newPrompt: Prompt | null = null;

		switch (promptName) {
			case "export":
				newPrompt = new ExportPrompt(doc);
				break;
			case "import":
				newPrompt = new ImportPrompt(doc);
				break;
			case "songRecovery":
				newPrompt = new SongRecoveryPrompt(doc);
				break;
			case "barCount":
				newPrompt = new SongDurationPrompt(doc);
				break;
			case "beatsPerBar":
				newPrompt = new BeatsPerBarPrompt(doc);
				break;
			case "octaves":
				newPrompt = new OctaveCountPrompt(doc);
				break;
			case "moveNotesSideways":
				newPrompt = new MoveNotesSidewaysPrompt(doc);
				break;
			case "channelSettings":
				newPrompt = new ChannelSettingsPrompt(doc);
				break;
			case "limiterSettings":
				newPrompt = new LimiterPrompt(doc, refs);
				break;
			case "customScale":
				newPrompt = new CustomScalePrompt(doc);
				break;
			case "customChipSettings":
				newPrompt = new CustomChipPrompt(doc, refs);
				break;
			case "customEQFilterSettings":
				newPrompt = new CustomFilterPrompt(doc, refs, false);
				break;
			case "customNoteFilterSettings":
				newPrompt = new CustomFilterPrompt(doc, refs, true);
				break;
			case "customSongEQFilterSettings":
				newPrompt = new CustomFilterPrompt(doc, refs, false, true);
				break;
			case "theme":
				newPrompt = new ThemePrompt(doc);
				break;
			case "layout":
				newPrompt = new LayoutPrompt(doc);
				break;
			case "recordingSetup":
				newPrompt = new RecordingSetupPrompt(doc);
				break;
			case "exportInstrument":
				newPrompt = new InstrumentExportPrompt(doc);
				break;
			case "importInstrument":
				newPrompt = new InstrumentImportPrompt(doc);
				break;
			case "stringSustain":
				newPrompt = new SustainPrompt(doc);
				break;
			case "cleanLsdj":
				newPrompt = new CleanChannelPrompt(doc);
				break;
			case "generateEuclideanRhythm":
				newPrompt = new EuclidgenRhythmPrompt(doc);
				break;
			case "customTheme":
				newPrompt = new PalettePrompt(doc);
				break;
			case "customThemeRaw":
				newPrompt = new CustomThemePrompt(
					doc,
					refs.patternEditor,
					refs.trackArea,
					document.getElementById("beepboxEditorContainer")!,
				);
				break;
			case "visualLoopControls":
				newPrompt = new VisualLoopControlsPrompt(doc, refs);
				break;
			case "sampleLoadingStatus":
				newPrompt = new SampleLoadingStatusPrompt(doc);
				break;
			case "configureShortener":
				newPrompt = new ShortenerConfigPrompt(doc);
				break;
			case "harmonicsSettings":
				newPrompt = new HarmonicsEditorPrompt(doc, refs);
				break;
			case "spectrumSettings":
				newPrompt = new SpectrumEditorPrompt(doc, refs, false);
				break;
			case "drumsetSettings":
				newPrompt = new SpectrumEditorPrompt(doc, refs, true);
				break;
			case "keyboardShortcuts":
				newPrompt = new KeyboardShortcutsPrompt(doc);
				break;
			case "tipPromptScope": {
				const tipName = this._navigatorTipName ?? "tipPromptScope";
				newPrompt = new TipPrompt(doc, tipName, this._navigatorTipSourceScope ?? tipName);
				break;
			}
			default:
				newPrompt = new TipPrompt(doc, promptName);
				break;
		}

		if (!newPrompt) return;

		newPrompt.name = promptName;
		newPrompt.closeCallback = (p) => {
			this.close(p);
		};
		newPrompt.openAlongsideCallback = (name) => {
			this._setPrompt(name);
		};

		this._prompts.push(newPrompt);
		log.log("pushed", promptName, {
			stack: this._prompts.map((p) => p.name),
			total: this._prompts.length,
		});
		this._focusedPrompt = newPrompt;
		this._updatePromptFocus();

		this._playbackOwnership.open(
			newPrompt,
			!this._openingForNavigator && !_noPlayPausePrompts.has(newPrompt.constructor),
			doc.synth.playing,
			() => {
				doc.performance.pause();
			},
		);

		// Cancel any pending container-hide timeout from a recent close
		// — otherwise it would fire after this open and hide the new
		// prompt mid-animation. (See close(): _hideContainerTimer.)
		if (this._hideContainerTimer != null) {
			clearTimeout(this._hideContainerTimer);
			this._hideContainerTimer = null;
		}

		// No exit animations remain (see animations.ts), so no in-flight
		// containers can outlive their close. Nothing to cancel here.

		this._host.promptContainer.style.display = "";
		// Positioning happens in the rAF below, before the first paint.
		this._host.promptContainer.appendChild(newPrompt.container);

		// Close over cursor info here (synchronously before any
		// rAF or other _setPrompt call clears _pendingClickInfo).
		const cursorInfo = this._pendingClickInfo ?? this._clickInfo;
		this._pendingClickInfo = null;
		this._clickInfo = null;

		const savedPos = this._promptPositions.get(promptName);

		// Measure and position via rAF (for layout) before the
		// enter animation's first painted frame. offsetWidth/offsetHeight
		// are transform-safe, so the scale(0.96) from-state does not skew
		// the measurement.
		const afterPos = (): void => {
			if (cursorInfo) {
				this._spawnNearCursor(newPrompt, promptName, cursorInfo);
			} else if (savedPos) {
				this._applyPosition(newPrompt, promptName, savedPos.x, savedPos.y);
			} else {
				this._centerPrompt(newPrompt, promptName);
			}
		};
		requestAnimationFrame(afterPos);

		this._attachDrag(newPrompt, promptName);
		this._attachWheelLock(newPrompt);
		this._focusController.attachPrompt(newPrompt);

		if (newPrompt.buildTitlebar) newPrompt.buildTitlebar();

		if (_popoutCapablePrompts.has(newPrompt.constructor)) {
			this._addPopoutButton(newPrompt);
		}

		const cancelButton = newPrompt.container.querySelector(".cancelButton");
		if (cancelButton) {
			cancelButton.addEventListener("click", () => {
				this.close(newPrompt);
			});
		}

		newPrompt.container.setAttribute("tabindex", "-1");
		newPrompt.container.focus({ preventScroll: true });
	}

	// Adds the "pop out" button to a capable prompt's titlebar. Toggling it
	// either detaches the prompt into a new OS window or closes that window.
	// Docking is cleared first so the dock does not fight the popout for the
	// container's parent and inline positioning.
	private _addPopoutButton(prompt: Prompt): void {
		const titlebar = prompt.container.querySelector(".prompt-titlebar");
		if (!titlebar || titlebar.querySelector(".popoutButton")) return;
		const btn = iconButton("popoutButton", {
			type: "button",
			title: "Pop out into separate window",
		});
		btn.addEventListener("click", (e: Event) => {
			e.stopPropagation();
			if (this._popout.isOpen(prompt)) {
				this.close(prompt);
			} else {
				// Close the in-window prompt so the popout owns the container.
				this._dock.undock(prompt);
				this._popout.open(prompt);
			}
		});
		const cancelButton = titlebar.querySelector(".cancelButton");
		if (cancelButton) {
			titlebar.insertBefore(btn, cancelButton);
		} else {
			titlebar.appendChild(btn);
		}
	}

	private _editorPadding(): { left: number; top: number; right: number; bottom: number } {
		const cs = getComputedStyle(this._host.mainLayer);
		return {
			left: parseFloat(cs.paddingLeft) || 0,
			top: parseFloat(cs.paddingTop) || 0,
			right: parseFloat(cs.paddingRight) || 0,
			bottom: parseFloat(cs.paddingBottom) || 0,
		};
	}

	private _applyPosition(prompt: Prompt, name: string, x: number, y: number): void {
		if (!this._prompts.includes(prompt)) return;
		if (this._popout.isOpen(prompt)) return;
		const w = this._host.mainLayer.clientWidth;
		const h = this._host.mainLayer.clientHeight;
		const pad = this._editorPadding();
		x = Math.max(pad.left, Math.min(x, w - pad.right - prompt.container.offsetWidth));
		y = Math.max(pad.top, Math.min(y, h - pad.bottom - prompt.container.offsetHeight));
		prompt.container.style.left = `${x}px`;
		prompt.container.style.top = `${y}px`;
		this._promptPositions.set(name, { x, y });
	}

	private _spawnNearCursor(
		prompt: Prompt,
		name: string,
		info: { clientX: number; clientY: number; elRect: DOMRect },
	): void {
		if (!this._prompts.includes(prompt)) return;
		if (this._popout.isOpen(prompt)) return;
		// Use offsetWidth/offsetHeight (forces synchronous layout) instead of
		// getBoundingClientRect().width — the latter can return 0 at rAF time if
		// the container was just appended and its grid/flex children haven't fully
		// resolved. A fallback of 300 would then let the prompt be placed far right,
		// causing overflow when its actual rendered width is much larger.
		const pw = prompt.container.offsetWidth || 300;
		const ph = prompt.container.offsetHeight || 200;
		// Everything is in mainLayer's coordinate space.
		// Convert viewport-relative coords by subtracting
		// mainLayer's viewport offset.
		const mlRect = this._host.mainLayer.getBoundingClientRect();
		const vw = this._host.mainLayer.clientWidth;
		const vh = this._host.mainLayer.clientHeight;
		const pad = this._editorPadding();
		const gap = 8;
		const isMobile =
			/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|android|ipad|playbook|silk/i.test(
				navigator.userAgent,
			);

		let x: number;
		let y: number;

		const minX = pad.left + gap;
		const maxX = vw - pad.right - pw - gap;
		const minY = pad.top + gap;
		const maxY = vh - pad.bottom - ph - gap;

		if (isMobile) {
			x = Math.max(minX, Math.min((vw - pw) / 2, maxX));
			y = Math.max(minY, Math.min((vh - ph) / 2, maxY));
		} else {
			const cursorX = info.clientX - mlRect.left;
			const cursorY = info.clientY - mlRect.top;
			x = Math.max(minX, Math.min(cursorX - pw / 2, maxX));
			// Prefer opening below the cursor like a context window. If there is
			// not enough room, fall back above, then center in the available area.
			if (cursorY + gap <= maxY) {
				y = cursorY + gap;
			} else if (cursorY - gap - ph >= minY) {
				y = cursorY - gap - ph;
			} else {
				y = (minY + maxY) / 2;
			}
			y = Math.max(minY, Math.min(y, maxY));
		}

		prompt.container.style.left = `${x}px`;
		prompt.container.style.top = `${y}px`;
		this._promptPositions.set(name, { x, y });
	}

	private _centerPrompt(prompt: Prompt, name: string): void {
		if (!this._prompts.includes(prompt)) return;
		if (this._popout.isOpen(prompt)) return;
		const w = this._host.mainLayer.clientWidth;
		const h = this._host.mainLayer.clientHeight;
		const pad = this._editorPadding();
		const availableW = Math.max(0, w - pad.left - pad.right);
		const availableH = Math.max(0, h - pad.top - pad.bottom);
		const x = pad.left + Math.max(0, (availableW - prompt.container.offsetWidth) / 2);
		const y = pad.top + Math.max(0, (availableH - prompt.container.offsetHeight) / 2);
		prompt.container.style.left = `${x}px`;
		prompt.container.style.top = `${y}px`;
		this._promptPositions.set(name, { x, y });
	}

	private _attachWheelLock(prompt: Prompt): void {
		const container = prompt.container;
		const onWheel = (e: WheelEvent): void => {
			const navigatorWorkspace = container.closest(".navigator-workspace");
			let el = e.target as HTMLElement | null;
			while (el && el !== container) {
				const sty = getComputedStyle(el);
				const overflowY = sty.overflowY;
				const canScroll =
					(overflowY === "auto" || overflowY === "scroll") &&
					el.scrollHeight > el.clientHeight;
				if (canScroll) {
					const delta = e.deltaY;
					const atTop = delta < 0 && el.scrollTop <= 0;
					const atBottom =
						delta > 0 && el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
					if ((atTop || atBottom) && navigatorWorkspace == null) e.preventDefault();
					return;
				}
				el = el.parentElement;
			}
			// Attached Navigator panes delegate wheel scrolling to the workspace.
			if (navigatorWorkspace == null) e.preventDefault();
		};
		container.addEventListener("wheel", onWheel, { passive: false });
	}

	private _attachDrag(prompt: Prompt, promptName: string): void {
		this._promptDragDisposers.get(prompt)?.();
		this._promptDragDisposers.delete(prompt);
		let suppressSnap = false;
		const dispose = attachPromptDrag({
			container: prompt.container,
			bounds: this._host.mainLayer,
			isDisabled: () => this._popout.isOpen(prompt),
			getPosition: () => {
				if (!this._dock.isDocked(prompt)) {
					return this._promptPositions.get(promptName) || { x: 0, y: 0 };
				}
				const rect = prompt.container.getBoundingClientRect();
				const boundsRect = this._host.mainLayer.getBoundingClientRect();
				return { x: rect.left - boundsRect.left, y: rect.top - boundsRect.top };
			},
			getPadding: () => this._editorPadding(),
			onStart: () => {
				this._draggingPrompt = true;
				suppressSnap = false;
			},
			beforeMove: (event, session) => {
				if (!this._prompts.includes(prompt)) return false;
				if (!this._dock.isDocked(prompt)) return true;
				if (!this._dock.shouldUnsnapByDrag(prompt, event.clientX - session.anchorX))
					return false;
				this._dock.undock(prompt);
				const boundsRect = this._host.mainLayer.getBoundingClientRect();
				const rect = prompt.container.getBoundingClientRect();
				session.reanchor(event.clientX, event.clientY, {
					x: rect.left - boundsRect.left,
					y: rect.top - boundsRect.top,
				});
				suppressSnap = true;
				return true;
			},
			onMove: ({ event, position, width, session }) => {
				const side = this._dock.getSnapSide(position.x, width, event.clientX);
				if (side && !suppressSnap) {
					this._dock.snap(prompt, side);
					session.anchorX = event.clientX;
					return false;
				}
				if (!side) suppressSnap = false;
				return true;
			},
			onPosition: (position) => this._promptPositions.set(promptName, position),
			onEnd: () => {
				this._draggingPrompt = false;
			},
		});
		this._promptDragDisposers.set(prompt, dispose);
	}
}
