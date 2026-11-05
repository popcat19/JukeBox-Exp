// import-boundaries.test.ts
//
// Purpose: Verifies forbidden cross-context import detection and import-cycle ratcheting.
//
// This module:
// - Builds fixture source trees and runs scripts/check-import-boundaries.ts against them
// - Checks each boundary rule, baseline acceptance, stale entries, and cycle growth

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const temporaryDirectories: string[] = [];

function createTree(files: Record<string, string>): string {
	const root = mkdtempSync(join(tmpdir(), "jukebox-import-boundaries-"));
	temporaryDirectories.push(root);
	for (const [path, content] of Object.entries(files)) {
		mkdirSync(dirname(join(root, path)), { recursive: true });
		writeFileSync(join(root, path), content);
	}
	return root;
}

function runChecker(root: string, write = false) {
	const result = Bun.spawnSync(
		[
			process.execPath,
			join(process.cwd(), "scripts/check-import-boundaries.ts"),
			"--root",
			root,
			...(write ? ["--write"] : []),
		],
		{ cwd: root },
	);
	return { exitCode: result.exitCode, stderr: result.stderr.toString(), stdout: result.stdout.toString() };
}

function baselinedTree(files: Record<string, string>): string {
	const root = createTree({ ...files });
	expect(runChecker(root, true).exitCode).toBe(0);
	return root;
}

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

const clean = { "shared/a.ts": "export const a = 1;\n", "synth/b.ts": 'import { a } from "../shared/a";\nexport const b = a;\n' };

describe("import boundary rules", () => {
	test("accepts a clean tree against its own baseline", () => {
		const root = baselinedTree(clean);
		expect(runChecker(root).exitCode).toBe(0);
	});

	const cases: [string, Record<string, string>, string][] = [
		["shared importing synth", { "shared/a.ts": 'import "../synth/b";\n', "synth/b.ts": "export {};\n" }, "shared-to-synth"],
		["shared importing editor", { "shared/a.ts": 'import "../editor/b";\n', "editor/b.ts": "export {};\n" }, "shared-to-editor"],
		["shared importing player", { "shared/a.ts": 'import "../player/b";\n', "player/b.ts": "export {};\n" }, "shared-to-player"],
		["synth importing editor", { "synth/a.ts": 'import "../editor/b";\n', "editor/b.ts": "export {};\n" }, "synth-to-editor"],
		["synth importing player", { "synth/a.ts": 'import "../player/b";\n', "player/b.ts": "export {};\n" }, "synth-to-player"],
		[
			"synth importing shared styles",
			{ "synth/a.ts": 'import "../shared/styles/inject";\n', "shared/styles/inject.ts": "export {};\n" },
			"synth-to-shared-ui",
		],
		["player importing editor", { "player/a.ts": 'import "../editor/b";\n', "editor/b.ts": "export {};\n" }, "player-to-editor"],
		[
			"editor changes importing ui",
			{ "editor/changes/a.ts": 'import "../ui/b";\n', "editor/ui/b.ts": "export {};\n" },
			"editor-model-to-view",
		],
		[
			"editor change dispatcher importing components",
			{ "editor/core/change-x.ts": 'import type { P } from "../components/p";\n', "editor/components/p.ts": "export type P = 1;\n" },
			"editor-model-to-view",
		],
	];

	for (const [label, files, rule] of cases) {
		test(`rejects ${label}`, () => {
			const root = createTree(files);
			writeFileSync(join(root, "import-boundaries-baseline.json"), '{"version":1,"violations":[],"sccSizes":[]}\n');
			const result = runChecker(root);
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain(`forbidden import: ${rule}:`);
		});
	}

	test("allows permitted directions", () => {
		const root = createTree({
			"editor/a.ts": 'import "../synth/b";\nimport "../shared/c";\nimport "../player/d";\n',
			"player/d.ts": 'import "../synth/b";\n',
			"synth/b.ts": 'import "../shared/c";\n',
			"shared/c.ts": "export {};\n",
			"editor/core/other.ts": 'import "../components/x";\n',
			"editor/components/x.ts": "export {};\n",
		});
		writeFileSync(join(root, "import-boundaries-baseline.json"), '{"version":1,"violations":[],"sccSizes":[]}\n');
		expect(runChecker(root).exitCode).toBe(0);
	});

	test("accepts baselined violations and rejects resolved ones left in the baseline", () => {
		const root = baselinedTree({ "shared/a.ts": 'import "../synth/b";\n', "synth/b.ts": "export {};\n" });
		expect(runChecker(root).exitCode).toBe(0);
		writeFileSync(join(root, "shared/a.ts"), "export {};\n");
		const result = runChecker(root);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("resolved violation still baselined");
	});
});

describe("import cycle ratchet", () => {
	const cycle = {
		"synth/a.ts": 'import "./b";\n',
		"synth/b.ts": 'import "./a";\n',
		"synth/c.ts": "export {};\n",
	};

	test("records strongly connected components in the baseline", () => {
		const root = baselinedTree(cycle);
		expect(JSON.parse(readFileSync(join(root, "import-boundaries-baseline.json"), "utf8")).sccSizes).toEqual([2]);
	});

	test("rejects a cycle that grows", () => {
		const root = baselinedTree(cycle);
		writeFileSync(join(root, "synth/b.ts"), 'import "./a";\nimport "./c";\n');
		writeFileSync(join(root, "synth/c.ts"), 'import "./b";\n');
		const result = runChecker(root);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("import cycle #1 grew: 3 > 2");
	});

	test("rejects a new cycle", () => {
		const root = baselinedTree(cycle);
		writeFileSync(join(root, "synth/x.ts"), 'import "./y";\n');
		writeFileSync(join(root, "synth/y.ts"), 'import "./x";\n');
		const result = runChecker(root);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("import cycle count grew: 2 > 1");
	});

	test("accepts a shrunk cycle and reports the improvement", () => {
		const root = baselinedTree(cycle);
		writeFileSync(join(root, "synth/b.ts"), "export {};\n");
		const result = runChecker(root);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("import cycles shrank");
	});
});
