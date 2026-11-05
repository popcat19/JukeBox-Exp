//
// Purpose: Rejects forbidden cross-context imports and import-cycle growth against a reviewed baseline.
//
// This script:
// - Builds the relative import graph of editor, synth, shared, and player
// - Fails on imports that violate bounded-context rules unless baselined
// - Computes strongly connected components and fails if any grows past the baseline
// - Rewrites the baseline with --write after reviewed improvements

import { existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

export interface BoundaryRule {
	readonly name: string;
	readonly from: readonly string[];
	readonly to: readonly string[];
}

export interface Baseline {
	readonly version: 1;
	readonly violations: readonly string[];
	readonly sccSizes: readonly number[];
}

const SOURCE_ROOTS = ["editor", "synth", "shared", "player"];
const EDITOR_MODEL = ["editor/changes/", "editor/core/change"];
const EDITOR_VIEW = ["editor/ui/", "editor/components/"];
const SHARED_UI = ["shared/styles/", "shared/themes/"];

export const RULES: readonly BoundaryRule[] = [
	{ name: "shared-to-synth", from: ["shared/"], to: ["synth/"] },
	{ name: "shared-to-editor", from: ["shared/"], to: ["editor/"] },
	{ name: "shared-to-player", from: ["shared/"], to: ["player/"] },
	{ name: "synth-to-editor", from: ["synth/"], to: ["editor/"] },
	{ name: "synth-to-player", from: ["synth/"], to: ["player/"] },
	{ name: "synth-to-shared-ui", from: ["synth/"], to: SHARED_UI },
	{ name: "player-to-editor", from: ["player/"], to: ["editor/"] },
	{ name: "editor-model-to-view", from: EDITOR_MODEL, to: EDITOR_VIEW },
];

const matches = (path: string, prefixes: readonly string[]) => prefixes.some((prefix) => path.startsWith(prefix));

function collectFiles(root: string): string[] {
	const files: string[] = [];
	const walk = (directory: string) => {
		for (const name of readdirSync(directory)) {
			const path = join(directory, name);
			if (statSync(path).isDirectory()) walk(path);
			else if (path.endsWith(".ts")) files.push(resolve(path));
		}
	};
	for (const sourceRoot of SOURCE_ROOTS) {
		const path = join(root, sourceRoot);
		if (existsSync(path)) walk(path);
	}
	return files.sort();
}

const IMPORT_PATTERN = /(?:import|export)\s[^;'"]*?from\s*["']([^"']+)["']|import\s*["']([^"']+)["']/g;

export function buildGraph(root: string): Map<string, string[]> {
	const files = collectFiles(root);
	const known = new Set(files);
	const resolveSpecifier = (from: string, specifier: string) => {
		if (!specifier.startsWith(".")) return null;
		const base = resolve(dirname(from), specifier);
		for (const candidate of [`${base}.ts`, join(base, "index.ts"), base]) {
			if (known.has(candidate)) return candidate;
		}
		return null;
	};
	const graph = new Map<string, string[]>();
	for (const file of files) {
		const targets = new Set<string>();
		for (const match of readFileSync(file, "utf8").matchAll(IMPORT_PATTERN)) {
			const target = resolveSpecifier(file, match[1] ?? match[2]);
			if (target !== null && target !== file) targets.add(target);
		}
		graph.set(file, [...targets].sort());
	}
	return graph;
}

export function findViolations(graph: Map<string, string[]>, root: string): string[] {
	const rel = (path: string) => relative(root, path).replaceAll("\\", "/");
	const found: string[] = [];
	for (const [file, targets] of graph) {
		for (const target of targets) {
			const from = rel(file);
			const to = rel(target);
			for (const rule of RULES) {
				if (matches(from, rule.from) && matches(to, rule.to)) found.push(`${rule.name}: ${from} -> ${to}`);
			}
		}
	}
	return found.sort();
}

export function findCycles(graph: Map<string, string[]>): string[][] {
	let counter = 0;
	const stack: string[] = [];
	const onStack = new Set<string>();
	const index = new Map<string, number>();
	const low = new Map<string, number>();
	const components: string[][] = [];
	const visit = (start: string) => {
		const frames: { node: string; next: number }[] = [{ node: start, next: 0 }];
		index.set(start, counter);
		low.set(start, counter);
		counter++;
		stack.push(start);
		onStack.add(start);
		while (frames.length > 0) {
			const frame = frames[frames.length - 1];
			const edges = graph.get(frame.node) ?? [];
			if (frame.next < edges.length) {
				const next = edges[frame.next++];
				if (!index.has(next)) {
					index.set(next, counter);
					low.set(next, counter);
					counter++;
					stack.push(next);
					onStack.add(next);
					frames.push({ node: next, next: 0 });
				} else if (onStack.has(next)) {
					low.set(frame.node, Math.min(low.get(frame.node)!, index.get(next)!));
				}
				continue;
			}
			frames.pop();
			if (frames.length > 0) {
				const parent = frames[frames.length - 1].node;
				low.set(parent, Math.min(low.get(parent)!, low.get(frame.node)!));
			}
			if (low.get(frame.node) === index.get(frame.node)) {
				const component: string[] = [];
				let member: string;
				do {
					member = stack.pop()!;
					onStack.delete(member);
					component.push(member);
				} while (member !== frame.node);
				if (component.length > 1) components.push(component.sort());
			}
		}
	};
	for (const file of graph.keys()) if (!index.has(file)) visit(file);
	return components.sort((a, b) => b.length - a.length);
}

export function compareToBaseline(
	violations: readonly string[],
	cycleSizes: readonly number[],
	baseline: Baseline,
): string[] {
	const errors: string[] = [];
	const allowed = new Set(baseline.violations);
	const current = new Set(violations);
	for (const violation of violations) {
		if (!allowed.has(violation)) errors.push(`forbidden import: ${violation}`);
	}
	for (const violation of baseline.violations) {
		if (!current.has(violation)) errors.push(`resolved violation still baselined: ${violation}`);
	}
	const sizes = [...cycleSizes].sort((a, b) => b - a);
	const limits = [...baseline.sccSizes].sort((a, b) => b - a);
	if (sizes.length > limits.length) {
		errors.push(`import cycle count grew: ${sizes.length} > ${limits.length}`);
	}
	sizes.forEach((size, position) => {
		const limit = limits[position] ?? 0;
		if (size > limit) errors.push(`import cycle #${position + 1} grew: ${size} > ${limit}`);
	});
	return errors;
}

function readBaseline(path: string): Baseline {
	const parsed = JSON.parse(readFileSync(path, "utf8"));
	const valid =
		parsed?.version === 1 &&
		Array.isArray(parsed.violations) &&
		parsed.violations.every((entry: unknown) => typeof entry === "string") &&
		Array.isArray(parsed.sccSizes) &&
		parsed.sccSizes.every((size: unknown) => Number.isInteger(size) && (size as number) > 1);
	if (!valid) throw new Error(`Invalid import boundary baseline: ${path}`);
	return parsed;
}

export function main(argv: string[]): number {
	let root = process.cwd();
	let baselinePath = "import-boundaries-baseline.json";
	let write = false;
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--root") root = resolve(argv[++i]);
		else if (argv[i] === "--baseline") baselinePath = argv[++i];
		else if (argv[i] === "--write") write = true;
		else throw new Error(`Unknown argument: ${argv[i]}`);
	}
	baselinePath = resolve(root, baselinePath);

	const graph = buildGraph(root);
	const violations = findViolations(graph, root);
	const cycles = findCycles(graph);
	const sizes = cycles.map((cycle) => cycle.length);

	if (write) {
		const baseline: Baseline = { version: 1, violations, sccSizes: sizes };
		const temporaryPath = `${baselinePath}.tmp`;
		writeFileSync(temporaryPath, `${JSON.stringify(baseline, null, "\t")}\n`);
		renameSync(temporaryPath, baselinePath);
		return 0;
	}

	const baseline = readBaseline(baselinePath);
	const errors = compareToBaseline(violations, sizes, baseline);
	if (errors.length === 0) {
		if (sizes.length < baseline.sccSizes.length || sizes.some((size, i) => size < baseline.sccSizes[i])) {
			console.log("import cycles shrank: run bun run check:imports:baseline to lock in the improvement");
		}
		return 0;
	}
	for (const error of errors) console.error(error);
	const rel = (path: string) => relative(root, path).replaceAll("\\", "/");
	for (const cycle of cycles.slice(0, 3)) {
		console.error(`cycle of ${cycle.length} files, first members: ${cycle.slice(0, 5).map(rel).join(", ")}`);
	}
	return 1;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
