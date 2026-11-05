// pmd-hue.test.ts
//
// Purpose: Verifies local-clock PMD hue policy and singleton scheduling behavior.

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
	getPMDRealtimeHueCoordinator,
	PMDRealtimeHueCoordinator,
} from "../editor/core/pmd-realtime-hue";
import { ColorConfig } from "../shared/color-config";
import { getPMD, PMD_DARK, PMD_LIGHT } from "../shared/pmd/variables";
import {
	clampPMDManualHue,
	clockHue,
	effectivePMDHue,
	millisecondsUntilNextMinute,
	nearestSignedPMDOffset,
	normalizePMDHue,
	normalizePMDOffset,
} from "../shared/pmd-hue";

class TrackedTarget extends EventTarget {
	public readonly additions = new Map<string, number>();
	public readonly removals = new Map<string, number>();

	public override addEventListener(
		type: string,
		callback: EventListenerOrEventListenerObject | null,
		options?: AddEventListenerOptions | boolean,
	): void {
		super.addEventListener(type, callback, options);
		this.additions.set(type, (this.additions.get(type) ?? 0) + 1);
	}

	public override removeEventListener(
		type: string,
		callback: EventListenerOrEventListenerObject | null,
		options?: EventListenerOptions | boolean,
	): void {
		super.removeEventListener(type, callback, options);
		this.removals.set(type, (this.removals.get(type) ?? 0) + 1);
	}
}

class FakeStorage {
	public readonly values = new Map<string, string>();
	public readonly writes: string[] = [];

	public getItem(key: string): string | null {
		return this.values.get(key) ?? null;
	}

	public setItem(key: string, value: string): void {
		this.values.set(key, value);
		this.writes.push(key);
	}
}

class FakeWindow extends TrackedTarget {
	private nextId = 1;
	public readonly document = new TrackedTarget();
	public readonly localStorage = new FakeStorage();
	public readonly timers = new Map<number, { callback: () => void; delay: number }>();

	public setTimeout(callback: () => void, delay = 0): number {
		const id = this.nextId++;
		this.timers.set(id, { callback, delay });
		return id;
	}

	public clearTimeout(id: number): void {
		this.timers.delete(id);
	}

	public fireTimer(): void {
		const entry = this.timers.entries().next().value as
			| [number, { callback: () => void; delay: number }]
			| undefined;
		if (entry === undefined) return;
		this.timers.delete(entry[0]);
		entry[1].callback();
	}
}

interface ColorSnapshot {
	readonly currentTheme: string;
	readonly dark: boolean;
	readonly effectiveHue: number;
	readonly hue: number;
}

let colorSnapshot: ColorSnapshot;
let setPMDStateSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
	colorSnapshot = {
		currentTheme: ColorConfig.currentTheme,
		dark: ColorConfig.pmdDark,
		effectiveHue: ColorConfig.pmdEffectiveHue,
		hue: ColorConfig.pmdHue,
	};
	ColorConfig.pmdHue = 120;
	ColorConfig.pmdEffectiveHue = 120;
	ColorConfig.pmdDark = true;
	ColorConfig.currentTheme = ColorConfig.PMD_THEME;
	setPMDStateSpy = spyOn(ColorConfig, "setPMDState").mockImplementation(
		(control, effective, _persist, targetTheme) => {
			const rendered =
				ColorConfig.currentTheme === ColorConfig.PMD_THEME &&
				ColorConfig.pmdEffectiveHue !== effective;
			const themeChanged =
				targetTheme !== undefined && ColorConfig.currentTheme !== targetTheme;
			ColorConfig.pmdHue = control;
			ColorConfig.pmdEffectiveHue = effective;
			ColorConfig.pmdDark = true;
			if (targetTheme !== undefined) ColorConfig.currentTheme = targetTheme;
			return rendered || themeChanged;
		},
	);
});

afterEach(() => {
	setPMDStateSpy.mockRestore();
	ColorConfig.pmdHue = colorSnapshot.hue;
	ColorConfig.pmdEffectiveHue = colorSnapshot.effectiveHue;
	ColorConfig.pmdDark = colorSnapshot.dark;
	ColorConfig.currentTheme = colorSnapshot.currentTheme;
});

describe("PMD hue policy", () => {
	test("maps local midnight and noon into the 24-hour hue wheel", () => {
		expect(clockHue(new Date(2026, 0, 1, 0, 0))).toBe(0);
		expect(clockHue(new Date(2026, 0, 1, 12, 0))).toBe(180);
		expect(clockHue(new Date(2026, 0, 1, 23, 59))).toBe(359);
	});

	test("wraps arithmetic hues and clamps persisted manual values", () => {
		expect(effectivePMDHue(0, -1)).toBe(359);
		expect(effectivePMDHue(359, 2)).toBe(1);
		expect(normalizePMDHue(-1)).toBe(359);
		expect(clampPMDManualHue(360)).toBe(0);
		expect(clampPMDManualHue(-1)).toBe(0);
		expect(clampPMDManualHue(999)).toBe(359);
		expect(clampPMDManualHue(Number.NaN)).toBe(0);
		expect(nearestSignedPMDOffset(359, 0)).toBe(-1);
	});

	test("clamps persisted signed offsets and invalid values", () => {
		expect(normalizePMDOffset(-999)).toBe(-180);
		expect(normalizePMDOffset(999)).toBe(180);
		expect(normalizePMDOffset(Number.NaN)).toBe(0);
	});

	test("targets the next exact minute boundary", () => {
		expect(millisecondsUntilNextMinute(new Date(2026, 0, 1, 1, 2, 0, 0))).toBe(60_000);
		expect(millisecondsUntilNextMinute(new Date(2026, 0, 1, 1, 2, 59, 999))).toBe(1);
	});

	test("migrates stale PMD light storage on persistence", () => {
		const g = globalThis as unknown as { window?: { localStorage: FakeStorage } };
		const previous = g.window;
		const storage = new FakeStorage();
		g.window = { localStorage: storage };
		try {
			storage.setItem("pmdDark", "0");
			ColorConfig.pmdDark = false;
			ColorConfig.persistPMD();
			expect(ColorConfig.pmdDark).toBeTrue();
			expect(storage.getItem("pmdDark")).toBe("1");
		} finally {
			g.window = previous;
		}
	});

	test("keeps the light palette as dormant compatibility data", () => {
		expect(getPMD(true).pmd).toBe(PMD_DARK);
		expect(getPMD(false).pmd).toBe(PMD_LIGHT);
		const coordinator = new PMDRealtimeHueCoordinator(new FakeWindow() as unknown as Window);
		expect(coordinator.capture()).toEqual({
			controlHue: ColorConfig.pmdHue,
			effectiveHue: ColorConfig.pmdEffectiveHue,
			enabled: false,
		});
		coordinator.stop();
	});

	test("restricted localStorage cannot abort ColorConfig module load", () => {
		const moduleUrl = new URL("../shared/color-config.ts?restricted-storage", import.meta.url).href;
		const script = `
			globalThis.window = { localStorage: {
				getItem() { throw new Error("restricted"); },
				setItem() { throw new Error("restricted"); }
			} };
			const { ColorConfig } = await import(${JSON.stringify(moduleUrl)});
			console.log(ColorConfig.pmdDark, ColorConfig.pmdHue);
		`;
		const result = Bun.spawnSync([process.execPath, "-e", script]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout.toString().trim()).toBe("true 345");
	});
});

describe("PMD realtime hue coordinator", () => {
	test("shares one singleton and idempotent scheduler across editor-like ensures", () => {
		const owner = new FakeWindow();
		const first = getPMDRealtimeHueCoordinator(owner as unknown as Window);
		const second = getPMDRealtimeHueCoordinator(owner as unknown as Window);
		expect(second).toBe(first);
		first.ensureEnabled(true);
		second.ensureEnabled(true);
		second.ensureEnabled(false);
		const releaseA = first.attach(() => {});
		const releaseB = second.attach(() => {});
		expect(first.enabled).toBeTrue();
		expect(owner.timers.size).toBe(1);
		expect(owner.document.additions.get("visibilitychange")).toBe(1);
		expect(owner.additions.get("pageshow")).toBe(1);
		releaseA();
		releaseB();
		expect(owner.timers.size).toBe(1);
		first.stop();
	});

	test("binds visibility to document, pageshow to window, and cleans both", () => {
		const owner = new FakeWindow();
		let now = new Date(2026, 0, 1, 0, 0);
		const coordinator = new PMDRealtimeHueCoordinator(owner as unknown as Window, () => now);
		const effective: number[] = [];
		coordinator.attach((update) => effective.push(update.effectiveHue));
		coordinator.setEnabled(true, false);
		effective.length = 0;
		now = new Date(2026, 0, 1, 0, 4);
		owner.fireTimer();
		now = new Date(2026, 0, 1, 0, 8);
		owner.document.dispatchEvent(new Event("visibilitychange"));
		now = new Date(2026, 0, 1, 0, 12);
		owner.dispatchEvent(new Event("pageshow"));
		expect(effective).toEqual([121, 122, 123]);
		expect(owner.timers.size).toBe(1);
		coordinator.stop();
		expect(owner.document.removals.get("visibilitychange")).toBe(1);
		expect(owner.removals.get("pageshow")).toBe(1);
		expect(owner.timers.size).toBe(0);
	});

	test("captures one timestamp while preserving hue across each toggle", () => {
		const owner = new FakeWindow();
		let calls = 0;
		let now = new Date(2026, 0, 1, 12, 0);
		const coordinator = new PMDRealtimeHueCoordinator(owner as unknown as Window, () => {
			calls++;
			return now;
		});
		coordinator.setEnabled(true);
		expect(calls).toBe(1);
		expect(ColorConfig.pmdHue).toBe(-60);
		expect(ColorConfig.pmdEffectiveHue).toBe(120);
		now = new Date(2026, 0, 1, 13, 0);
		calls = 0;
		coordinator.setEnabled(false);
		expect(calls).toBe(1);
		expect(ColorConfig.pmdHue).toBe(135);
		expect(ColorConfig.pmdEffectiveHue).toBe(135);
		coordinator.stop();
	});

	test("restores atomically, notifies once, and ignores repeated restore", () => {
		const owner = new FakeWindow();
		const coordinator = new PMDRealtimeHueCoordinator(
			owner as unknown as Window,
			() => new Date(2026, 0, 1, 12, 0),
		);
		let updates = 0;
		coordinator.attach(() => updates++);
		const opening = coordinator.capture();
		coordinator.setEnabled(true, false);
		updates = 0;
		coordinator.restore(opening, "forest");
		coordinator.restore(opening, "forest");
		expect(updates).toBe(1);
		expect(ColorConfig.pmdHue).toBe(opening.controlHue);
		expect(ColorConfig.currentTheme).toBe("forest");
		coordinator.stop();
	});

	test("retains policy without rendering on a non-PMD theme", () => {
		ColorConfig.currentTheme = "forest";
		setPMDStateSpy.mockImplementation((control: number, effective: number) => {
			ColorConfig.pmdHue = control;
			ColorConfig.pmdEffectiveHue = effective;
			ColorConfig.pmdDark = true;
			return false;
		});
		const owner = new FakeWindow();
		const coordinator = new PMDRealtimeHueCoordinator(
			owner as unknown as Window,
			() => new Date(2026, 0, 1, 12, 0),
		);
		let renderedUpdates = 0;
		const release = coordinator.attach((update) => {
			if (update.rendered) renderedUpdates++;
		});
		coordinator.setEnabled(true, false);
		coordinator.preview(10);
		expect(ColorConfig.pmdEffectiveHue).toBe(190);
		expect(renderedUpdates).toBe(0);
		release();
		coordinator.stop();
	});

	test("persists policy through one explicit commit call", () => {
		const owner = new FakeWindow();
		const coordinator = new PMDRealtimeHueCoordinator(owner as unknown as Window);
		const persist = spyOn(ColorConfig, "persistPMD").mockImplementation(() => {});
		coordinator.setEnabled(true, false);
		coordinator.preview(-10);
		expect(persist).toHaveBeenCalledTimes(0);
		coordinator.persist();
		expect(persist).toHaveBeenCalledTimes(1);
		expect(owner.localStorage.writes).toEqual(["pmdRealtimeHue"]);
		persist.mockRestore();
		coordinator.stop();
	});

	test("released prompt subscriptions receive no later updates", () => {
		const owner = new FakeWindow();
		const coordinator = new PMDRealtimeHueCoordinator(owner as unknown as Window);
		let updates = 0;
		const release = coordinator.attach(() => updates++);
		release();
		release();
		coordinator.setEnabled(true, false);
		coordinator.preview(20);
		expect(updates).toBe(0);
		coordinator.stop();
	});
});
