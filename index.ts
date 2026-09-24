/**
 * longhand — the agent investigates, you type.
 *
 * A toggleable mode. Keeps only the tools that cannot write into your code,
 * fences the shell, and gives the model a role that makes sense of the fence.
 * Leave it with the same key you entered it.
 *
 *   /longhand [on|off]        toggle
 *   /longhand tools           show the inventory again
 *   /longhand allow <name>    hand one tool back
 *   ctrl+alt+l                toggle
 *   --no-longhand             start a session outside it
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { classify } from "./guard.ts";
import { DeliveryServer } from "./delivery.ts";
import { LONGHAND_GUIDELINES } from "./prompt.ts";
import { readProjectAllowlist, takeInventory, wrapNames, type Inventory } from "./tools.ts";

/** Sessions open in longhand. ctrl+alt+l is how you leave. */
const START_ON = true;
const PUBLISH = "longhand_publish";

const HANDOFF =
	"Longhand is on: you do not write files. Explain the cause and publish the " +
	"paste-ready change with longhand_publish. Do not look for another way to apply it.";

export default function longhand(pi: ExtensionAPI): void {
	let on = false;
	/** Tools active before the mode took them away, so exit restores exactly. */
	let toolsBefore: string[] | undefined;
	/** What survives right now — the gate consults this, not a name list. */
	let kept = new Set<string>();
	/** Tools handed back: from .longhand.json, plus /longhand allow this session. */
	let allowed = new Set<string>();
	const delivery = new DeliveryServer(({ kind, comment, title }) => {
		const message = kind === "adjust"
			? `About the longhand proposal “${title}”: please adjust it as follows: ${comment}`
			: `The longhand proposal “${title}” makes sense.${comment ? ` Note: ${comment}` : ""} I have not confirmed that I applied the code.`;
		pi.sendUserMessage(message, { deliverAs: "followUp" });
	});

	pi.registerTool({
		name: PUBLISH,
		label: "Publish longhand proposal",
		description: "Publish a code proposal on a local page for the user to review and copy. Does not modify project files.",
		promptGuidelines: LONGHAND_GUIDELINES,
		parameters: Type.Object({
			title: Type.String(),
			diagnosis: Type.String(),
			path: Type.String(),
			location: Type.String(),
			code: Type.String(),
			verification: Type.String(),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (!on) throw new Error("Longhand is off");
			const url = await delivery.publish(params);
			return {
				content: [{ type: "text", text: `Proposal published: ${url}. ${ctx.mode === "tui" ? "The link in this tool result is the final answer." : "Reply with only the link."}` }],
				details: { url },
				terminate: ctx.mode === "tui",
			};
		},
		renderCall(args) {
			return new Text(`Publishing proposal: ${args.title}`, 0, 0);
		},
		renderResult(result) {
			return new Text((result.details as { url?: string } | undefined)?.url ?? "Could not publish the proposal", 0, 0);
		},
	});

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
					theme.fg("dim", `  ${inv.kept.length} active, ${inv.removed.length} disabled`),
			),
		);
		box.addChild(new Text(""));
		box.addChild(new Text(theme.fg("accent", "  active   ") + inv.kept.join("  ")));

		if (inv.removed.length > 0) {
			box.addChild(new Text(""));
			const rows = wrapNames(inv.removed, 54, " ".repeat(11));
			box.addChild(new Text(theme.fg("warning", "  off      ") + rows[0]));
			for (const row of rows.slice(1)) box.addChild(new Text(row));
		}

		box.addChild(new Text(""));
		box.addChild(new Text(theme.fg("dim", "  /longhand allow <name>   restore a tool")));
		box.addChild(new Text(theme.fg("dim", "  /longhand                leave the mode")));
		return box;
	});

	/** Apply the inventory to the live session and show what it did. */
	function applyInventory(announce: boolean): Inventory {
		const inv = takeInventory([...(toolsBefore ?? pi.getActiveTools()), PUBLISH], allowed);
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
		toolsBefore = pi.getActiveTools().filter((name) => name !== PUBLISH);
		const file = readProjectAllowlist(ctx.cwd);
		if (file.error) ctx.ui.notify(`Ignoring .longhand.json: ${file.error}`, "warning");
		allowed = new Set([...allowed, ...file.names]);
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
		ctx.ui.notify("Longhand off — the agent can write files again", "info");
	}

	pi.registerCommand("longhand", {
		description: "Toggle longhand mode (the agent investigates, you apply code)",
		getArgumentCompletions: (prefix: string) =>
			["on", "off", "tools", "allow"]
				.filter((v) => v.startsWith(prefix))
				.map((v) => ({ value: v, label: v })),
		handler: async (args, ctx) => {
			const [verb, ...rest] = args.trim().split(/\s+/).filter(Boolean);

			if (verb === "on") return void enter(ctx);
			if (verb === "off") return void leave(ctx);

			if (verb === "tools") {
				if (!on) return void ctx.ui.notify("Longhand is off", "info");
				pi.appendEntry("longhand-inventory", takeInventory([...(toolsBefore ?? []), PUBLISH], allowed));
				return;
			}

			if (verb === "allow") {
				const name = rest[0];
				if (!name) return void ctx.ui.notify("Usage: /longhand allow <name>", "warning");
				// Kept even if unknown, since a tool can register later, but a typo should not pass in silence.
				if (!(toolsBefore ?? pi.getActiveTools()).includes(name)) {
					ctx.ui.notify(`${name} is not among the current tools`, "warning");
				}
				allowed.add(name);
				if (on) applyInventory(true);
				else ctx.ui.notify(`${name} will be available when longhand is on`, "info");
				return;
			}

			on ? leave(ctx) : enter(ctx);
		},
	});

	pi.registerShortcut("ctrl+alt+l", {
		description: "Toggle longhand mode",
		handler: async (ctx) => (on ? leave(ctx) : enter(ctx)),
	});

	pi.on("session_start", async (_event, ctx) => {
		const start = pi.getFlag("no-longhand") ? false : pi.getFlag("longhand") || START_ON;
		if (start) enter(ctx);
		else {
			pi.setActiveTools(pi.getActiveTools().filter((name) => name !== PUBLISH));
			paint(ctx);
		}
	});

	pi.on("session_shutdown", async () => {
		await delivery.close();
	});

	pi.on("tool_call", async (event, ctx) => {
		if (!on) return;

		// Anything that did not survive the inventory. Covers tools registered
		// after startup, which never passed through setActiveTools.
		if (!kept.has(event.toolName)) {
			return {
				block: true,
				reason: `${event.toolName} is disabled in longhand. ${HANDOFF}`,
			};
		}

		if (isToolCallEventType("bash", event)) {
			const verdict = classify(event.input.command);

			if (verdict.kind === "block") {
				return { block: true, reason: `Blocked in longhand — ${verdict.reason}. ${HANDOFF}` };
			}

			if (verdict.kind === "ask") {
				const allowedOnce = ctx.hasUI
						? await ctx.ui.confirm("longhand", `${verdict.reason}.\n\n${event.input.command}\n\nRun once?`)
					: false;
				if (!allowedOnce) {
						return { block: true, reason: `Declined in longhand — ${verdict.reason}. ${HANDOFF}` };
				}
			}
		}
	});

}
