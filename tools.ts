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
 */
export function readProjectAllowlist(cwd: string): Set<string> {
	const path = join(cwd, ".longhand.json");
	if (!existsSync(path)) return new Set();
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8"));
		const list = parsed?.allowTools;
		return Array.isArray(list) ? new Set(list.filter((n) => typeof n === "string")) : new Set();
	} catch {
		// A broken config must not silently widen the fence.
		return new Set();
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
