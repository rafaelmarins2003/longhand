/**
 * longhand — the agent investigates, you type.
 *
 * A toggleable mode. Keeps only the tools that cannot write into your code,
 * fences the shell, and gives the model a role that makes sense of the fence.
 * Leave it with the same key you entered it.
 *
 *   /longhand [on|off]        toggle
 *   /longhand tools           show the inventory again
 *   /longhand allow <nome>    hand one tool back
 *   ctrl+alt+l                toggle
 *   --no-longhand             start a session outside it
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";
import { classify } from "./guard.ts";
import { LONGHAND_PROMPT } from "./prompt.ts";
import { readProjectAllowlist, takeInventory, wrapNames, type Inventory } from "./tools.ts";

/** Sessions open in longhand. ctrl+alt+l is how you leave. */
const START_ON = true;

const HANDOFF =
	"Longhand is on: you do not write files. Explain the cause, then give a " +
	"paste-ready block and where it goes. Do not look for another way to apply it.";

export default function longhand(pi: ExtensionAPI): void {
	let on = false;
	/** Tools active before the mode took them away, so exit restores exactly. */
	let toolsBefore: string[] | undefined;
	/** What survives right now — the gate consults this, not a name list. */
	let kept = new Set<string>();
	/** Tools handed back: from .longhand.json, plus /longhand allow this session. */
	let allowed = new Set<string>();

	pi.registerFlag("longhand", {
		description: "Force longhand mode on for this session",
		type: "boolean",
		default: false,
	});

	pi.registerFlag("no-longhand", {
		description: "Start this session outside longhand mode",
		type: "boolean",
		default: false,
	});

	pi.registerEntryRenderer("longhand-inventory", (entry, _state, theme) => {
		const inv = entry.data as Inventory;
		const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));

		box.addChild(
			new Text(
				theme.fg("accent", "✍ longhand") +
					theme.fg("dim", `  ${inv.kept.length} ativas, ${inv.removed.length} desligadas`),
			),
		);
		box.addChild(new Text(""));
		box.addChild(new Text(theme.fg("accent", "  ativas   ") + inv.kept.join("  ")));

		if (inv.removed.length > 0) {
			box.addChild(new Text(""));
			const rows = wrapNames(inv.removed, 54, " ".repeat(11));
			box.addChild(new Text(theme.fg("warning", "  off      ") + rows[0]));
			for (const row of rows.slice(1)) box.addChild(new Text(row));
		}

		box.addChild(new Text(""));
		box.addChild(new Text(theme.fg("dim", "  /longhand allow <nome>   devolve uma")));
		box.addChild(new Text(theme.fg("dim", "  /longhand                sai do modo")));
		return box;
	});

	/** Apply the inventory to the live session and show what it did. */
	function applyInventory(announce: boolean): Inventory {
		const inv = takeInventory(toolsBefore ?? pi.getActiveTools(), allowed);
		kept = new Set(inv.kept);
		pi.setActiveTools(inv.kept);
		if (announce) pi.appendEntry("longhand-inventory", inv);
		return inv;
	}

	function paint(ctx: ExtensionContext): void {
		ctx.ui.setStatus("longhand", on ? ctx.ui.theme.fg("accent", "✍ longhand") : undefined);
	}

	function enter(ctx: ExtensionContext): void {
		if (on) return;
		toolsBefore = pi.getActiveTools();
		allowed = new Set([...allowed, ...readProjectAllowlist(ctx.cwd)]);
		on = true;
		applyInventory(true);
		paint(ctx);
	}

	function leave(ctx: ExtensionContext): void {
		if (!on) return;
		pi.setActiveTools(toolsBefore ?? pi.getActiveTools());
		toolsBefore = undefined;
		kept = new Set();
		on = false;
		paint(ctx);
		ctx.ui.notify("longhand off — o agente pode escrever de novo", "info");
	}

	pi.registerCommand("longhand", {
		description: "Alterna o modo longhand (o agente investiga, você escreve)",
		getArgumentCompletions: (prefix: string) =>
			["on", "off", "tools", "allow"]
				.filter((v) => v.startsWith(prefix))
				.map((v) => ({ value: v, label: v })),
		handler: async (args, ctx) => {
			const [verb, ...rest] = args.trim().split(/\s+/).filter(Boolean);

			if (verb === "on") return void enter(ctx);
			if (verb === "off") return void leave(ctx);

			if (verb === "tools") {
				if (!on) return void ctx.ui.notify("longhand está desligado", "info");
				pi.appendEntry("longhand-inventory", takeInventory(toolsBefore ?? [], allowed));
				return;
			}

			if (verb === "allow") {
				const name = rest[0];
				if (!name) return void ctx.ui.notify("uso: /longhand allow <nome>", "warning");
				allowed.add(name);
				if (on) applyInventory(true);
				else ctx.ui.notify(`${name} entra na lista ao ligar o modo`, "info");
				return;
			}

			on ? leave(ctx) : enter(ctx);
		},
	});

	pi.registerShortcut("ctrl+alt+l", {
		description: "Alterna o modo longhand",
		handler: async (ctx) => (on ? leave(ctx) : enter(ctx)),
	});

	pi.on("session_start", async (_event, ctx) => {
		const start = pi.getFlag("no-longhand") ? false : pi.getFlag("longhand") || START_ON;
		if (start) enter(ctx);
		else paint(ctx);
	});

	pi.on("tool_call", async (event, ctx) => {
		if (!on) return;

		// Anything that did not survive the inventory. Covers tools registered
		// after startup, which never passed through setActiveTools.
		if (!kept.has(event.toolName)) {
			return {
				block: true,
				reason: `${event.toolName} está desligado no longhand. ${HANDOFF}`,
			};
		}

		if (isToolCallEventType("bash", event)) {
			const verdict = classify(event.input.command);

			if (verdict.kind === "block") {
				return { block: true, reason: `Bloqueado no longhand — ${verdict.reason}. ${HANDOFF}` };
			}

			if (verdict.kind === "ask") {
				const allowedOnce = ctx.hasUI
					? await ctx.ui.confirm("longhand", `${verdict.reason}.\n\n${event.input.command}\n\nRodar uma vez?`)
					: false;
				if (!allowedOnce) {
					return { block: true, reason: `Recusado no longhand — ${verdict.reason}. ${HANDOFF}` };
				}
			}
		}
	});

	pi.on("before_agent_start", async (event) => {
		if (!on) return;
		return { systemPrompt: `${event.systemPrompt}\n\n${LONGHAND_PROMPT}` };
	});
}
