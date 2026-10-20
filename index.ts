/**
 * Switches the agent to away mode when the user steps away from the Mac (idle
 * input, screen lock, screensaver) or says they are leaving: ask_user_question
 * is blocked instead of hanging, tool results carry the away rules, and the
 * agent logs its decisions, blocked commands and questions with away_log.
 * "/back" (or a message like "I'm back") ends away mode and injects that
 * journal so the agent walks the user through it before resuming.
 */
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { captureScreens, purgeOldCaptures } from "./capture.ts";
import { type AwayConfig, DEFAULT_CONFIG, resolveConfig } from "./config.ts";
import {
	type AwayEntry,
	type BranchEntry,
	countsLabel,
	CUSTOM_TYPE,
	plural,
	type CustomData,
	ENTRY_KINDS,
	LOG_TOOL,
	openEntries,
	renderRecap,
} from "./journal.ts";
import {
	blockedAskReason,
	CAME_BACK_NOTE,
	leaveNote,
	resumeMessage,
	rulesBlock,
	slowCommandNote,
	stillAwayNote,
	wentAwayNote,
} from "./policy.ts";
import { classifyPresence } from "./presence.ts";
import { CachedSensor, describeStatus, type Exec } from "./sensor.ts";

const STATUS_KEY = "away-status";
const RETURN_POLL_MS = 30_000;
const LOGGABLE_KINDS = ENTRY_KINDS.filter((kind) => kind !== "blocked_prompt");

export default function awayStatus(pi: ExtensionAPI) {
	const exec: Exec = async (command, args) => {
		const result = await pi.exec(command, args, { timeout: 20_000 });
		return { stdout: result.stdout, code: result.code };
	};
	const sensor = new CachedSensor(exec);
	let config: AwayConfig = DEFAULT_CONFIG;
	const commandStarts = new Map<string, number>();
	let latestCtx: ExtensionContext | undefined;
	let runActive = false;
	// Away state last reported to the model during the current run.
	let reportedAway: boolean | undefined;
	let pendingResume = false;
	// Agent-facing note for the next run: the user just left, or wrote while away mode was on.
	let pendingNote: string | undefined;
	let forcedAwaySince: Date | undefined;
	let polledAway: boolean | undefined;
	let poll: NodeJS.Timeout | undefined;

	const journal = (ctx: ExtensionContext): AwayEntry[] =>
		openEntries(ctx.sessionManager.getBranch() as unknown as BranchEntry[]);

	const refreshFooter = (ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;
		const mode = sensor.forced === "away" ? "away mode on" : sensor.forced === "present" ? "away mode off (forced)" : "";
		const label = countsLabel(journal(ctx));
		const parts = [mode, label ? `log: ${label}` : ""].filter(Boolean);
		ctx.ui.setStatus(STATUS_KEY, parts.length > 0 ? parts.join(" | ") : undefined);
	};

	const appendCustom = (data: CustomData) => pi.appendEntry<CustomData>(CUSTOM_TYPE, data);

	const forceAway = () => {
		sensor.forced = "away";
		forcedAwaySince = new Date();
		sensor.invalidate();
	};

	const clearForcedAway = () => {
		if (sensor.forced === "away") sensor.forced = undefined;
		forcedAwaySince = undefined;
		sensor.invalidate();
	};

	const checkForReturn = async () => {
		const ctx = latestCtx;
		if (!ctx) return;
		try {
			const status = await sensor.read();
			const wasAway = polledAway;
			polledAway = status.away;
			if (wasAway !== true || status.away) return;
			const label = countsLabel(journal(ctx));
			if (!label || !ctx.hasUI) return;
			ctx.ui.notify(`Welcome back: ${label} waiting. Type /back for the recap.`, "info");
			pi.events.emit("notifications:send", { title: "Pi: away recap ready", message: `${label} waiting. Type /back.` });
		} catch {
			// A stale context after a session switch; the next session_start replaces it.
		}
	};

	pi.on("session_start", async (_event, ctx) => {
		latestCtx = ctx;
		const resolved = resolveConfig(pi.getSettings() as unknown as Record<string, unknown>);
		config = resolved.config;
		sensor.idleThresholdSeconds = config.idleSeconds;
		sensor.invalidate();
		if (ctx.hasUI) for (const warning of resolved.warnings) ctx.ui.notify(`away-status: ${warning}`, "warning");
		purgeOldCaptures();
		refreshFooter(ctx);
		poll ??= setInterval(() => void checkForReturn(), RETURN_POLL_MS);
		poll.unref?.();
	});

	pi.on("session_tree", async (_event, ctx) => refreshFooter(ctx));

	pi.on("session_shutdown", async () => {
		if (poll) clearInterval(poll);
		poll = undefined;
		latestCtx = undefined;
	});

	pi.on("input", async (event, ctx) => {
		const presence = classifyPresence(event.text);
		// Mid-run messages (steer or follow-up) reach the agent through the tool_result
		// transition notes; a note queued here would leak into the next, unrelated run.
		const idle = event.streamingBehavior === undefined;
		pendingNote = undefined;
		if (presence.back) {
			clearForcedAway();
			if (idle && journal(ctx).length > 0) pendingResume = true;
		}
		if (presence.leave) {
			forceAway();
			if (idle) pendingNote = leaveNote();
			if (ctx.hasUI) ctx.ui.notify("Away mode on. Say \"je suis de retour\" or type /back to end it.", "info");
		} else if (idle && !presence.back && sensor.forced === "away") {
			pendingNote = stillAwayNote(forcedAwaySince);
		}
		refreshFooter(ctx);
		return { action: "continue" };
	});

	pi.on("before_agent_start", async (_event, ctx) => {
		// The user just typed, so any cached "away" is stale.
		sensor.invalidate();
		const note = pendingNote;
		pendingNote = undefined;
		const entries = pendingResume ? journal(ctx) : [];
		pendingResume = false;
		if (entries.length > 0) {
			appendCustom({ type: "resume", at: new Date().toISOString() });
			refreshFooter(ctx);
		}
		const parts = [entries.length > 0 ? resumeMessage(renderRecap(entries)) : "", note ?? ""].filter(Boolean);
		if (parts.length === 0) return;
		return {
			message: {
				customType: entries.length > 0 ? "away-status-resume" : "away-status-note",
				content: parts.join("\n\n"),
				// The recap is for the user to read; the presence notes only steer the agent.
				display: entries.length > 0,
				details: { entries },
			},
		};
	});

	pi.on("agent_start", async (_event, ctx) => {
		latestCtx = ctx;
		runActive = true;
		reportedAway = (await sensor.read()).away;
	});

	pi.on("agent_settled", async (_event, ctx) => {
		runActive = false;
		reportedAway = undefined;
		commandStarts.clear();
		refreshFooter(ctx);
	});

	pi.on("tool_execution_start", async (event) => {
		if (event.toolName === "bash") commandStarts.set(event.toolCallId, Date.now());
	});

	pi.on("tool_call", async (event) => {
		if (event.toolName !== "ask_user_question") return;
		const status = await sensor.read();
		if (!status.away) return;
		return { block: true, reason: blockedAskReason(describeStatus(status)) };
	});

	pi.on("tool_result", async (event) => {
		const startedAt = commandStarts.get(event.toolCallId);
		commandStarts.delete(event.toolCallId);
		if (event.parentToolCallId || !runActive) return;

		const status = await sensor.read();
		const statusLine = describeStatus(status);
		const notes: string[] = [];
		if (reportedAway !== undefined && status.away !== reportedAway) {
			notes.push(status.away ? wentAwayNote(statusLine) : CAME_BACK_NOTE);
			reportedAway = status.away;
		}
		const seconds = startedAt === undefined ? 0 : Math.round((Date.now() - startedAt) / 1000);
		if (status.away && seconds >= config.slowCommandSeconds) notes.push(slowCommandNote(statusLine, seconds));
		if (notes.length === 0) return;
		return {
			content: [...event.content, { type: "text", text: notes.join("\n\n") }],
			structuredContent: event.structuredContent,
		};
	});

	pi.on("ui_prompt_start", async (event, ctx) => {
		const status = await sensor.read();
		if (!status.away) return;
		const title = event.title ? `${event.kind} prompt: ${event.title}` : `${event.kind} prompt`;
		appendCustom({ type: "entry", entry: { kind: "blocked_prompt", title, at: new Date().toISOString() } });
		refreshFooter(ctx);
	});

	pi.registerTool({
		name: "away_status",
		label: "Away status",
		description:
			"Check whether the user is at the keyboard: idle time since the last keyboard or mouse input, screen lock, and screensaver. Returns the status and, when the user is away, the away mode rules.",
		promptSnippet: "Check whether the user is at the keyboard before a step that needs them",
		promptGuidelines: [
			"Call away_status before a step that needs the user to answer a prompt (1Password, SSO, Touch ID, sudo, a question) when they have not written for a while.",
			"Messages starting with [away-status] inside tool results come from the away-status extension: follow them.",
		],
		parameters: Type.Object({}),
		async execute() {
			sensor.invalidate();
			const status = await sensor.read();
			const lines = [`User is ${describeStatus(status)}.`, JSON.stringify(status)];
			if (status.away) lines.push("", "Away mode rules:", rulesBlock());
			return { content: [{ type: "text", text: lines.join("\n") }], details: status };
		},
	});

	pi.registerTool({
		name: LOG_TOOL,
		label: "Away log",
		description: [
			"Record, while the user is away, something they must see when they come back. Kinds:",
			"decision (a reversible call you made: set choice, alternatives, rationale, revert),",
			"pending_command (a command that needs the user at the keyboard: set the exact command, cwd, blocked_by),",
			"question (needs the user's answer: set options),",
			"progress (what moved forward).",
			"The title is one plain sentence the user understands without context.",
		].join(" "),
		promptGuidelines: [
			"Use away_log only while the user is away (away_status says so, or an [away-status] note told you), never as a general todo list.",
		],
		parameters: Type.Object({
			kind: StringEnum(LOGGABLE_KINDS),
			title: Type.String({ description: "One sentence the user understands without context" }),
			choice: Type.Optional(Type.String({ description: "decision: what you chose" })),
			alternatives: Type.Optional(Type.String({ description: "decision: the options you did not take" })),
			rationale: Type.Optional(Type.String({ description: "decision: why this one" })),
			revert: Type.Optional(Type.String({ description: "decision: how to undo it" })),
			command: Type.Optional(Type.String({ description: "pending_command: the exact command to run, copy-pastable" })),
			cwd: Type.Optional(Type.String({ description: "pending_command: absolute directory to run it from" })),
			blocked_by: Type.Optional(Type.String({ description: "pending_command: what needs the user (1Password, SSO, permission prompt...)" })),
			options: Type.Optional(Type.String({ description: "question: the possible answers, your recommendation first" })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (params.kind === "decision" && (!params.choice || !params.revert)) {
				throw new Error("A decision needs choice and revert, so the user can challenge and undo it.");
			}
			if (params.kind === "pending_command" && !params.command) {
				throw new Error("A pending_command needs the exact command to run.");
			}
			const entry: AwayEntry = {
				kind: params.kind,
				title: params.title,
				at: new Date().toISOString(),
				choice: params.choice,
				alternatives: params.alternatives,
				rationale: params.rationale,
				revert: params.revert,
				command: params.command,
				cwd: params.cwd,
				blockedBy: params.blocked_by,
				options: params.options,
			};
			return {
				content: [{ type: "text", text: `Logged ${params.kind}: ${params.title}` }],
				details: { entry },
			};
		},
	});

	pi.registerTool({
		name: "screen_capture",
		label: "Screen capture",
		description:
			"Capture every display of the user's Mac and return the images. Use it to check for a dialog waiting on the user (1Password, SSO, macOS permission) when a command hangs, or when the user asks you to look at their screen.",
		parameters: Type.Object({
			reason: Type.Optional(Type.String({ description: "Why you are looking, shown to the user" })),
		}),
		async execute() {
			const capture = await captureScreens(exec, { silent: config.captureSilent });
			return {
				content: [
					{ type: "text", text: `Captured ${plural(capture.paths.length, "display")}:\n${capture.paths.join("\n")}` },
					...capture.images.map((image) => ({ type: "image" as const, ...image })),
				],
				details: { paths: capture.paths },
			};
		},
	});

	pi.registerCommand("away", {
		description: "Away status: /away [status|on|off|auto]. on forces away mode (like saying \"je file\"), off forces present, auto follows the sensor",
		handler: async (args, ctx) => {
			const arg = args.trim().toLowerCase();
			if (arg === "on") {
				forceAway();
			} else if (arg === "off" || arg === "auto") {
				clearForcedAway();
				sensor.forced = arg === "off" ? "present" : undefined;
			} else if (arg && arg !== "status") {
				ctx.ui.notify("Usage: /away [status|on|off|auto]", "warning");
				return;
			}
			const status = await sensor.read();
			const label = countsLabel(journal(ctx));
			ctx.ui.notify(`You are ${describeStatus(status)}.${label ? ` Away log: ${label}.` : ""}`, "info");
			refreshFooter(ctx);
		},
	});

	pi.registerCommand("back", {
		description: "End away mode, show what the agent logged while you were away, and resume with it",
		handler: async (_args, ctx) => {
			clearForcedAway();
			refreshFooter(ctx);
			if (journal(ctx).length === 0) {
				ctx.ui.notify("Away mode off. Nothing logged while you were away.", "info");
				return;
			}
			if (!ctx.isIdle()) {
				ctx.ui.notify("The agent is still running; type /back once it stops.", "warning");
				return;
			}
			pendingResume = true;
			await pi.sendUserMessage("I'm back.");
		},
	});
}
