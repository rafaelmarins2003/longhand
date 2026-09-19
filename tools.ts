/**
 * longhand — which tools survive the mode.
 *
 * The plugin cannot know what you have installed. Obsidian, an MCP for Jira,
 * one for Postgres, something published next month. So it does not try to
 * guess what to block: it keeps what it knows cannot write into your code,
 * and turns off everything else.
 *
 * Safe by default, and it works with tools that do not exist yet. The cost is
 * that a read-only third-party tool gets turned off too — which is why the
 * mode shows you the list and lets you hand one back.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Built-ins that cannot put bytes into your project.
 *
 * `bash` is here because guard.ts fences it, not because it is harmless.
 * `powershell` is not: there is no guard for it yet, so it stays off.
 */
const KEPT = new Set(["read", "grep", "find", "ls", "bash"]);

export interface Inventory {
	/** Tools that stay active in longhand. */
	kept: string[];
	/** Tools the mode turned off, in the order pi reported them. */
	removed: string[];
}

/** Split the active tool list into what survives and what does not. */
export function takeInventory(active: string[], allowed: ReadonlySet<string>): Inventory {
	const kept: string[] = [];
	const removed: string[] = [];
	for (const name of active) {
		(KEPT.has(name) || allowed.has(name) ? kept : removed).push(name);
	}
	return { kept, removed };
}

/**
 * Tools this project hands back, from `.longhand.json` in the working
 * directory. Project-local and versioned on purpose: a concession that lives
 * in the repo shows up in the diff and in the blame.
 *
 * { "allowTools": ["obsidian_read", "obsidian_search"] }
 *
 * A broken file must not widen the fence, so it hands nothing back. But it
 * says why, instead of leaving you wondering where your tool went.
 */
export function readProjectAllowlist(cwd: string): { names: Set<string>; error?: string } {
	const path = join(cwd, ".longhand.json");
	if (!existsSync(path)) return { names: new Set() };
	try {
		const list = JSON.parse(readFileSync(path, "utf8"))?.allowTools;
		if (list === undefined) return { names: new Set() };
		if (!Array.isArray(list)) return { names: new Set(), error: "allowTools deve ser uma lista de nomes" };
		return { names: new Set(list.filter((n) => typeof n === "string")) };
	} catch (err) {
		return { names: new Set(), error: err instanceof Error ? err.message : String(err) };
	}
}

/** Wrap a list of names to a column width, indenting continuation lines. */
export function wrapNames(names: string[], width: number, indent: string): string[] {
	const lines: string[] = [];
	let line = "";
	for (const name of names) {
		if (line && line.length + name.length + 2 > width) {
			lines.push(line);
			line = "";
		}
		line += (line ? "  " : "") + name;
	}
	if (line) lines.push(line);
	return lines.map((l, n) => (n === 0 ? l : indent + l));
}
