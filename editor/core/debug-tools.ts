// Debug Tools
//
// Purpose: Exposes window.__jukebox__ with dev inspection utilities
//
// This module:
// - Decodes URL hashes to human-readable JSON
// - Inspects clipboard contents (localStorage + system)
// - Runs consistency checks on song state
// - Records actions as replayable backend scripts

import { applyPMDTheme } from "../../shared/pmd-adapter";
import type { Song } from "../../synth";
import { ChangeSong } from "../changes";
import type { SongDocument } from "../song-document";
import { type Change, ChangeGroup } from "./change";
import { makeLogger } from "./debug-log";

const log = makeLogger("startup");

interface ReplayOp {
	op: string;
	// biome-ignore lint/suspicious/noExplicitAny: varied arg types across ops
	args?: any;
	ts: number;
}

interface DebugAPI {
	hash: () => object | null;
	clipboard: () => void;
	validate: () => string[];
	pmd: (hue?: number, isDark?: boolean) => object;
	record: {
		start: () => void;
		stop: () => string;
		ops: () => ReplayOp[];
		dump: () => void;
	};
	replay: (ops: ReplayOp[]) => void;
	audio: () => { underrunRecoveries: number };
}

export function installDebugTools(doc: SongDocument): void {
	const ops: ReplayOp[] = [];
	let recording: boolean = false;
	let suppress: boolean = false; // true during replay to avoid double-recording

	// ── Recorder hooks ──────────────────────────────────────────

	const _origRecord = doc.record.bind(doc);
	const _origGroupAppend = ChangeGroup.prototype.append;

	// Capture cursor position for navigation-dependent ops
	function cursor(): { bar: number; ch: number } {
		return { bar: doc.bar, ch: doc.channel };
	}

	// Intercept ChangeGroup.append to capture inner change names
	ChangeGroup.prototype.append = function (change: Change): void {
		if (recording && !suppress) {
			const n: string = change.constructor.name;
			if (n === "ChangeChannelBar") {
				// Capture navigation as a positioned no-op for replay
				const c = cursor();
				ops.push({ op: "navigate", args: { bar: c.bar, ch: c.ch }, ts: Date.now() });
			} else if (n !== "ChangeGroup" && n !== "ChangeSequence") {
				ops.push({ op: "change", args: { _change: n }, ts: Date.now() });
			}
		}
		_origGroupAppend.call(this, change);
	};

	doc.record = (change: Change, replace?: boolean, newSong?: boolean): void => {
		_origRecord(change, replace, newSong);
	};

	const _origCopy = doc.selection.copy.bind(doc.selection);
	doc.selection.copy = (): void => {
		_origCopy();
		if (recording && !suppress) {
			const payload: string | null = window.localStorage.getItem("selectionCopy");
			ops.push({
				op: "copy",
				args: { ...cursor(), payload: payload || undefined },
				ts: Date.now(),
			});
		}
	};

	const _origPaste = doc.selection.pasteNotes.bind(doc.selection);
	doc.selection.pasteNotes = (): void => {
		if (recording && !suppress) {
			const payload: string | null = window.localStorage.getItem("selectionCopy");
			ops.push({
				op: "pasteNotes",
				args: { bar: doc.bar, ch: doc.channel, payload: payload || undefined },
				ts: Date.now(),
			});
		}
		_origPaste();
	};

	const _origInsert = doc.selection.insertChannel.bind(doc.selection);
	doc.selection.insertChannel = (): void => {
		if (recording && !suppress) ops.push({ op: "insertChannel", ts: Date.now() });
		_origInsert();
	};

	const _origDelete = doc.selection.deleteChannel.bind(doc.selection);
	doc.selection.deleteChannel = (): void => {
		if (recording && !suppress) ops.push({ op: "deleteChannel", ts: Date.now() });
		_origDelete();
	};

	const _origClone = doc.selection.cloneChannel.bind(doc.selection);
	doc.selection.cloneChannel = (): void => {
		if (recording && !suppress)
			ops.push({
				op: "cloneChannel",
				args: { src: doc.selection.boxSelectionChannel },
				ts: Date.now(),
			});
		_origClone();
	};

	// ── API ─────────────────────────────────────────────────────

	function genScript(pretty: boolean): string {
		const json: string = pretty ? JSON.stringify(ops, null, 2) : JSON.stringify(ops);
		const prefix: string = pretty
			? "// Replay script — paste into console on a fresh JukeBox page\n"
			: "";
		return `${prefix}__jukebox__.replay(${json});`;
	}

	const api: DebugAPI = {
		hash(): object | null {
			try {
				const h: string = window.location.hash.slice(1);
				if (!h) return null;
				// biome-ignore lint/suspicious/noExplicitAny: dynamic constructor call
				const song: Song = new (doc.song.constructor as any)(h);
				return song.toJsonObject();
			} catch (e) {
				console.error("hash decode failed:", e);
				return null;
			}
		},

		clipboard(): void {
			const ls = window.localStorage.getItem("selectionCopy");
			if (ls) {
				try {
					const obj: any = JSON.parse(ls);
					console.log("── localStorage clipboard ──");
					console.log(
						`channels: ${obj.channels?.length}  partDuration: ${obj.partDuration}`,
					);
					for (let i = 0; i < (obj.channels || []).length; i++) {
						const ch = obj.channels[i];
						const hasDefs = ch.instrumentDefs != null;
						console.log(
							`  ch${i}: noise=${ch.isNoise} mod=${ch.isMod}  bars=${ch.bars?.length}  patterns=${Object.keys(ch.patterns || {}).length}  instDefs=${hasDefs}`,
						);
						if (hasDefs) console.log("    defs:", ch.instrumentDefs);
					}
				} catch (e) {
					console.log("localStorage: parse error", e);
				}
			} else {
				console.log("localStorage clipboard: empty");
			}
			if (navigator.clipboard?.readText) {
				navigator.clipboard
					.readText()
					.then((text: string) => {
						try {
							const obj: any = JSON.parse(text);
							if (obj?.channels) {
								console.log("── system clipboard ──");
								console.log(
									`channels: ${obj.channels.length}  partDuration: ${obj.partDuration}`,
								);
								for (let i = 0; i < obj.channels.length; i++) {
									const ch = obj.channels[i];
									console.log(
										`  ch${i}: noise=${ch.isNoise} mod=${ch.isMod}  instDefs=${ch.instrumentDefs != null}`,
									);
								}
							} else {
								console.log("system clipboard: not a JukeBox copy");
							}
						} catch {
							console.log("system clipboard: not JSON");
						}
					})
					.catch(() => {
						console.log("system clipboard: read denied");
					});
			}
		},

		validate(): string[] {
			const issues: string[] = [];
			const s = doc.song;
			for (let ci = 0; ci < s.getChannelCount(); ci++) {
				const ch = s.channels[ci];
				const isNoise = s.getChannelIsNoise(ci);
				const isMod = s.getChannelIsMod(ci);
				for (let ii = 0; ii < ch.instruments.length; ii++) {
					const inst: any = ch.instruments[ii];
					if (isMod && inst.type !== 9)
						issues.push(`ch${ci} inst${ii}: mod channel has non-mod type ${inst.type}`);
					if (isNoise && inst.type === 0)
						issues.push(
							`ch${ci} inst${ii}: noise channel has chip — cross-type contamination`,
						);
				}
				for (let pi = 0; pi < ch.patterns.length; pi++) {
					const pat: any = ch.patterns[pi];
					for (const idx of pat.instruments) {
						if (idx >= ch.instruments.length)
							issues.push(
								`ch${ci} pat${pi + 1}: refs inst${idx} but only ${ch.instruments.length} exist`,
							);
					}
				}
			}
			if (issues.length === 0) console.log("✓ consistent");
			else {
				console.warn(`✗ ${issues.length} issues:`);
				issues.forEach((i) => {
					console.warn("  -", i);
				});
			}
			return issues;
		},

		record: {
			start(): void {
				ops.length = 0;
				recording = true;
				// Capture initial song state so replay can restore it
				ops.push({
					op: "load",
					args: { hash: window.location.hash.slice(1) || "" },
					ts: Date.now(),
				});
				console.log("🔴 recording — run __jukebox__.record.stop() to get replay script");
			},
			stop(): string {
				recording = false;
				console.log(`⏹ stopped — ${ops.length} ops`);
				const readable: string = genScript(true);
				const minified: string = genScript(false);
				console.log(readable);
				if (navigator.clipboard?.writeText) {
					navigator.clipboard
						.writeText(minified)
						.then(() => {
							console.log("📋 replay script copied to clipboard");
						})
						.catch(() => {
							/* clipboard write may fail in non-secure contexts */
						});
				}
				return readable;
			},
			ops(): ReplayOp[] {
				return [...ops];
			},
			dump(): void {
				console.log(`── recording (${ops.length} ops) ──`);
				ops.forEach((o) => {
					console.log(`  ${o.op}`, o.args ?? "");
				});
			},
		},

		audio(): { underrunRecoveries: number } {
			return { underrunRecoveries: doc.synth.audioUnderrunRecoveries };
		},

		pmd(hue?: number, isDark?: boolean): object {
			const colors = applyPMDTheme(hue ?? 260, isDark ?? true);
			console.log(
				`PMD theme applied: hue=${hue ?? 260}° ${(isDark ?? true) ? "dark" : "light"}`,
			);
			console.log(colors);
			return colors;
		},

		replay(recordedOps: ReplayOp[]): void {
			suppress = true;
			console.log(`replaying ${recordedOps.length} ops...`);
			let count = 0;
			for (const op of recordedOps) {
				try {
					switch (op.op) {
						case "load":
							if (op.args?.hash) doc.record(new ChangeSong(doc, op.args.hash));
							break;
						case "copy":
							if (op.args?.payload)
								window.localStorage.setItem("selectionCopy", op.args.payload);
							doc.selection.copy();
							break;
						case "pasteNotes":
							// Position cursor at recorded bar/ch before paste
							if (op.args?.bar !== undefined) doc.bar = op.args.bar;
							if (op.args?.ch !== undefined) doc.channel = op.args.ch;
							doc.selection.setTrackSelection(
								doc.bar,
								doc.bar,
								doc.channel,
								doc.channel,
							);
							if (op.args?.payload)
								window.localStorage.setItem("selectionCopy", op.args.payload);
							doc.selection.pasteNotes();
							break;
						case "insertChannel":
							doc.selection.insertChannel();
							break;
						case "deleteChannel":
							doc.selection.deleteChannel();
							break;
						case "cloneChannel":
							doc.selection.cloneChannel();
							break;
						case "navigate":
							if (op.args?.bar !== undefined) doc.bar = op.args.bar;
							if (op.args?.ch !== undefined) doc.channel = op.args.ch;
							doc.selection.setTrackSelection(
								doc.bar,
								doc.bar,
								doc.channel,
								doc.channel,
							);
							break;
						case "change":
							break; // side effects only
						default:
							console.warn("  unknown op:", op.op);
					}
					count++;
				} catch (e) {
					console.error(`  failed at op ${count} (${op.op}):`, e);
					break;
				}
			}
			console.log(`done — ${count}/${recordedOps.length} ops replayed.`);
			suppress = false;
		},
	};

	(window as any).__jukebox__ = api;

	// Startup probe — fires unconditionally so the user can see the
	// logger module is loaded. If the flag is off, this prints an
	// instructional message instead of the [jukebox:debug] banner.
	if (log.enabled()) {
		log.log("debug-log is active, scopes registered");
	} else {
		try {
			console.info(
				"%c[jukebox:debug] logging disabled",
				"background:#666;color:#fff;padding:2px 6px;border-radius:4px;font-weight:bold;",
				"enable with: localStorage.setItem('debugPrompts','1') then reload, or load with ?debugPrompts=1. For synth/worklet logging: localStorage.setItem('debugSynth','1')",
			);
		} catch {
			// ignore
		}
	}
}
