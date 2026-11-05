import { describe, expect, test } from "bun:test";
import { ChangeNotifier } from "../editor/core/change-notifier";
import { FrameScheduler } from "../editor/core/frame-scheduler";

function makeScheduler() {
	const queue: ((t: number) => void)[] = [];
	const scheduler = new FrameScheduler(
		(cb) => queue.push(cb),
		() => {
			queue.length = 0;
		},
	);
	const step = (t = 0): void => {
		const batch = queue.splice(0);
		for (const cb of batch) cb(t);
	};
	return { scheduler, queue, step };
}

describe("FrameScheduler", () => {
	test("runs a registered callback each frame through one rAF request", () => {
		const { scheduler, queue, step } = makeScheduler();
		let calls = 0;
		scheduler.register(() => {
			calls++;
		});
		scheduler.register(() => {});
		expect(queue.length).toBe(1);
		step();
		step();
		expect(calls).toBe(2);
		expect(queue.length).toBe(1);
	});

	test("duplicate registration of the same function runs once per frame", () => {
		const { scheduler, step } = makeScheduler();
		let calls = 0;
		const cb = (): void => {
			calls++;
		};
		scheduler.register(cb);
		scheduler.register(cb);
		step();
		expect(calls).toBe(1);
	});

	test("returning false unregisters and stops the loop", () => {
		const { scheduler, queue, step } = makeScheduler();
		let calls = 0;
		scheduler.register(() => ++calls < 2);
		step();
		expect(queue.length).toBe(1);
		step();
		expect(calls).toBe(2);
		expect(queue.length).toBe(0);
		expect(scheduler.running).toBe(false);
	});

	test("disposer unregisters", () => {
		const { scheduler, queue, step } = makeScheduler();
		let calls = 0;
		const off = scheduler.register(() => {
			calls++;
		});
		off();
		step();
		expect(calls).toBe(0);
		expect(queue.length).toBe(0);
	});

	test("flush requests dedupe, run after callbacks, and do not keep the loop alive", () => {
		const { scheduler, queue, step } = makeScheduler();
		const order: string[] = [];
		scheduler.register(() => {
			order.push("cb");
			return false;
		});
		const flush = (): void => {
			order.push("flush");
		};
		scheduler.requestFlush(flush);
		scheduler.requestFlush(flush);
		step();
		expect(order).toEqual(["cb", "flush"]);
		expect(queue.length).toBe(0);
	});

	test("a flush requested during a flush runs next frame", () => {
		const { scheduler, queue, step } = makeScheduler();
		let n = 0;
		const flush = (): void => {
			if (++n < 2) scheduler.requestFlush(flush);
		};
		scheduler.requestFlush(flush);
		step();
		expect(n).toBe(1);
		expect(queue.length).toBe(1);
		step();
		expect(n).toBe(2);
	});

	test("a throwing callback still reschedules the loop", () => {
		const { scheduler, queue, step } = makeScheduler();
		scheduler.register(() => {
			throw new Error("boom");
		});
		expect(() => step()).toThrow("boom");
		expect(queue.length).toBe(1);
	});
});

describe("ChangeNotifier frame flush", () => {
	test("changed() notifies watchers on the next frame without notifyWatchers()", () => {
		const { scheduler, step } = makeScheduler();
		const notifier = new ChangeNotifier(scheduler);
		let seen = 0;
		notifier.watch(() => seen++);
		notifier.changed();
		notifier.changed();
		expect(seen).toBe(0);
		step();
		expect(seen).toBe(1);
	});

	test("manual notifyWatchers() clears dirty so the frame flush is a no-op", () => {
		const { scheduler, step } = makeScheduler();
		const notifier = new ChangeNotifier(scheduler);
		let seen = 0;
		notifier.watch(() => seen++);
		notifier.changed();
		notifier.notifyWatchers();
		step();
		expect(seen).toBe(1);
	});

	test("flushGate defers the flush until it opens", () => {
		const { scheduler, queue, step } = makeScheduler();
		const notifier = new ChangeNotifier(scheduler);
		let open = false;
		notifier.flushGate = () => open;
		let seen = 0;
		notifier.watch(() => seen++);
		notifier.changed();
		step();
		expect(seen).toBe(0);
		expect(queue.length).toBe(1);
		open = true;
		step();
		expect(seen).toBe(1);
	});
});
