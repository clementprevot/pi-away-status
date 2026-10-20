import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import awayStatus from "../index.ts";

type Handler = (event: any, ctx: any) => Promise<any> | any;

interface Harness {
	idleSeconds: number;
	settings: Record<string, unknown>;
	branch: any[];
	notifications: string[];
	sentMessages: string[];
	fire(event: string, payload?: any): Promise<any>;
	tool(name: string): any;
	command(name: string): any;
	ctx: any;
}

function setup(): Harness {
	const handlers = new Map<string, Handler[]>();
	const tools = new Map<string, any>();
	const commands = new Map<string, any>();
	const harness = {
		idleSeconds: 0,
		settings: {},
		branch: [] as any[],
		notifications: [] as string[],
		sentMessages: [] as string[],
	} as Harness;

	const pi = {
		on(event: string, handler: Handler) {
			handlers.set(event, [...(handlers.get(event) ?? []), handler]);
			return () => {};
		},
		registerTool(tool: any) {
			tools.set(tool.name, tool);
		},
		registerCommand(name: string, options: any) {
			commands.set(name, options);
		},
		async exec(command: string, args: string[]) {
			if (command === "ioreg" && args.includes("HIDIdleTime")) {
				return { stdout: `"HIDIdleTime" = ${harness.idleSeconds * 1e9}`, stderr: "", code: 0, killed: false };
			}
			if (command === "ioreg") return { stdout: "<plist/>", stderr: "", code: 0, killed: false };
			return { stdout: "", stderr: "", code: 1, killed: false };
		},
		appendEntry(customType: string, data: unknown) {
			harness.branch.push({ type: "custom", customType, data });
		},
		events: { emit() {} },
		getSettings: () => harness.settings,
		async sendUserMessage(text: string) {
			harness.sentMessages.push(text);
		},
	};

	harness.ctx = {
		hasUI: true,
		isIdle: () => true,
		ui: { setStatus() {}, notify: (message: string) => harness.notifications.push(message) },
		sessionManager: { getBranch: () => harness.branch },
	};
	harness.fire = async (event, payload = {}) => {
		let result;
		for (const handler of handlers.get(event) ?? []) result = (await handler(payload, harness.ctx)) ?? result;
		return result;
	};
	harness.tool = (name) => tools.get(name);
	harness.command = (name) => commands.get(name);

	awayStatus(pi as any);
	return harness;
}

async function logEntry(h: Harness, params: Record<string, unknown>) {
	const result = await h.tool("away_log").execute("call", params, undefined, undefined, h.ctx);
	h.branch.push({ type: "message", message: { role: "toolResult", toolName: "away_log", details: result.details } });
	return result;
}

// The sensor caches for a few seconds; re-entering a run starts from a fresh read.
async function startRun(h: Harness) {
	await h.fire("before_agent_start", {});
	await h.fire("agent_start", {});
}

let h: Harness;
beforeEach(() => {
	h = setup();
});

test("ask_user_question goes through when the user is present", async () => {
	h.idleSeconds = 5;
	assert.equal(await h.fire("tool_call", { toolName: "ask_user_question", toolCallId: "a" }), undefined);
});

test("ask_user_question is blocked with the away rules when the user is away", async () => {
	h.idleSeconds = 900;
	const result = await h.fire("tool_call", { toolName: "ask_user_question", toolCallId: "a" });
	assert.equal(result.block, true);
	assert.match(result.reason, /nobody can answer ask_user_question/);
	assert.match(result.reason, /cheap to reverse and stays inside the scope/);
});

test("other tools are never blocked, even when away", async () => {
	h.idleSeconds = 900;
	assert.equal(await h.fire("tool_call", { toolName: "bash", toolCallId: "b" }), undefined);
});

test("a tool result carries the away rules once when the user leaves mid-run", async () => {
	h.idleSeconds = 0;
	await startRun(h);
	const result = { toolName: "read", toolCallId: "r1", content: [{ type: "text", text: "file" }], isError: false };
	assert.equal(await h.fire("tool_result", result), undefined);

	h.idleSeconds = 900;
	await h.fire("before_agent_start", {});
	const noted = await h.fire("tool_result", { ...result, toolCallId: "r2" });
	assert.equal(noted.content.length, 2);
	assert.match(noted.content[1].text, /just went away/);

	assert.equal(await h.fire("tool_result", { ...result, toolCallId: "r3" }), undefined);
});

test("nested tool results are left alone", async () => {
	await startRun(h);
	h.idleSeconds = 900;
	await h.fire("before_agent_start", {});
	const nested = { toolName: "read", toolCallId: "p/1", parentToolCallId: "p", content: [], isError: false };
	assert.equal(await h.fire("tool_result", nested), undefined);
});

test("a slow command while away gets the do-not-retry note", async (t) => {
	h.idleSeconds = 900;
	await startRun(h);
	t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
	await h.fire("tool_execution_start", { toolName: "bash", toolCallId: "c1" });
	t.mock.timers.tick(45_000);
	const result = await h.fire("tool_result", { toolName: "bash", toolCallId: "c1", content: [], isError: false });
	assert.match(result.content.at(-1).text, /took 45s/);
	assert.match(result.content.at(-1).text, /do not retry it/);
});

test("away_log refuses a decision without a revert path and a command without the command", async () => {
	const execute = h.tool("away_log").execute;
	await assert.rejects(execute("c", { kind: "decision", title: "t", choice: "x" }, undefined, undefined, h.ctx), /revert/);
	await assert.rejects(execute("c", { kind: "pending_command", title: "t" }, undefined, undefined, h.ctx), /exact command/);
});

test("a blocking UI prompt while away lands in the journal", async () => {
	h.idleSeconds = 900;
	await h.fire("ui_prompt_start", { kind: "confirm", title: "Allow bash: git push?" });
	assert.equal(h.branch.at(-1).data.entry.kind, "blocked_prompt");
	assert.match(h.branch.at(-1).data.entry.title, /git push/);
});

test("saying you are back injects the recap once and clears the journal", async () => {
	await logEntry(h, { kind: "decision", title: "Reused the existing hook", choice: "reuse", revert: "inline it" });
	await logEntry(h, { kind: "pending_command", title: "Sign commits", command: "git commit --amend -S --no-edit", cwd: "/tmp/repo" });

	await h.fire("input", { text: "je suis de retour", source: "interactive" });
	const result = await h.fire("before_agent_start", {});
	assert.equal(result.message.customType, "away-status-resume");
	assert.match(result.message.content, /Reused the existing hook/);
	assert.match(result.message.content, /\(cd \/tmp\/repo && git commit --amend -S --no-edit\)/);
	assert.equal(h.branch.at(-1).data.type, "resume");

	await h.fire("input", { text: "je suis de retour", source: "interactive" });
	assert.equal(await h.fire("before_agent_start", {}), undefined);
});

test("an ordinary prompt does not trigger the recap", async () => {
	await logEntry(h, { kind: "progress", title: "Tests written" });
	await h.fire("input", { text: "rebase it on main", source: "interactive" });
	assert.equal(await h.fire("before_agent_start", {}), undefined);
});

test("/back resumes when the journal has entries and says so when it is empty", async () => {
	await h.command("back").handler("", h.ctx);
	assert.match(h.notifications.at(-1)!, /Nothing logged/);

	await logEntry(h, { kind: "question", title: "Ship behind a flag?" });
	await h.command("back").handler("", h.ctx);
	assert.deepEqual(h.sentMessages, ["I'm back."]);
	const result = await h.fire("before_agent_start", {});
	assert.match(result.message.content, /Ship behind a flag\?/);
});

test("/away on forces away mode until /away auto", async () => {
	h.idleSeconds = 0;
	await h.command("away").handler("on", h.ctx);
	assert.match(h.notifications.at(-1)!, /away \(forced/);
	assert.equal((await h.fire("tool_call", { toolName: "ask_user_question", toolCallId: "a" })).block, true);

	await h.command("away").handler("auto", h.ctx);
	assert.equal(await h.fire("tool_call", { toolName: "ask_user_question", toolCallId: "b" }), undefined);
});

const ask = (id: string) => h.fire("tool_call", { toolName: "ask_user_question", toolCallId: id });

test("saying you leave forces away mode and tells the agent, even at the keyboard", async () => {
	h.idleSeconds = 0;
	await h.fire("input", { text: "ok lance les tests, je file", source: "interactive" });
	assert.match(h.notifications.at(-1)!, /Away mode on/);

	const result = await h.fire("before_agent_start", {});
	assert.equal(result.message.customType, "away-status-note");
	assert.equal(result.message.display, false);
	assert.match(result.message.content, /just said they are leaving/);
	assert.equal((await ask("a")).block, true);
});

test("writing while away mode is on keeps it on and asks the agent to point it out", async () => {
	await h.fire("input", { text: "je file", source: "interactive" });
	await h.fire("before_agent_start", {});

	await h.fire("input", { text: "ah, et pense à rebaser sur main", source: "interactive" });
	const result = await h.fire("before_agent_start", {});
	assert.match(result.message.content, /Away mode is still on since \d{2}:\d{2}/);
	assert.match(result.message.content, /one short line pointing it out/);
	assert.equal((await ask("a")).block, true);
});

test("saying you are back ends a forced away mode, recap or not", async () => {
	await h.fire("input", { text: "je pars manger", source: "interactive" });
	await h.fire("before_agent_start", {});

	await h.fire("input", { text: "re", source: "interactive" });
	assert.equal(await h.fire("before_agent_start", {}), undefined);
	assert.equal(await ask("a"), undefined);

	await h.fire("input", { text: "rebase it", source: "interactive" });
	assert.equal(await h.fire("before_agent_start", {}), undefined);
});

test("/back ends a forced away mode even with an empty journal", async () => {
	await h.fire("input", { text: "afk", source: "interactive" });
	await h.command("back").handler("", h.ctx);
	assert.match(h.notifications.at(-1)!, /Away mode off/);
	assert.equal(await ask("a"), undefined);
});

test("leaving mid-run turns away mode on through the next tool result, without leaking a note into the next run", async () => {
	h.idleSeconds = 0;
	await startRun(h);
	await h.fire("input", { text: "je m'absente un moment", source: "interactive", streamingBehavior: "steer" });

	const noted = await h.fire("tool_result", { toolName: "read", toolCallId: "r1", content: [], isError: false });
	assert.match(noted.content.at(-1).text, /just went away \(forced/);
	await h.fire("agent_settled", {});

	await h.fire("input", { text: "me revoilà", source: "interactive" });
	assert.equal(await h.fire("before_agent_start", {}), undefined);
	assert.equal(await ask("a"), undefined);
});

test("coming back mid-run does not queue the recap for the next run", async () => {
	await logEntry(h, { kind: "progress", title: "Tests written" });
	await h.fire("input", { text: "je file", source: "interactive" });
	await startRun(h);
	await h.fire("input", { text: "re", source: "interactive", streamingBehavior: "steer" });

	const noted = await h.fire("tool_result", { toolName: "read", toolCallId: "r1", content: [], isError: false });
	assert.match(noted.content.at(-1).text, /back at the keyboard/);
	await h.fire("agent_settled", {});

	await h.fire("input", { text: "rebase it", source: "interactive" });
	assert.equal(await h.fire("before_agent_start", {}), undefined);
});

test("away_log answers with the entry only, no running count", async () => {
	const result = await logEntry(h, { kind: "progress", title: "Tests written" });
	assert.equal(result.content[0].text, "Logged progress: Tests written");
});

test("the idle threshold comes from the awayStatus settings once the session starts", async () => {
	h.idleSeconds = 900;
	h.settings = { awayStatus: { idleSeconds: 1200 } };
	await h.fire("session_start", { reason: "startup" });
	assert.equal(await ask("a"), undefined);

	h.idleSeconds = 1300;
	await h.fire("before_agent_start", {});
	assert.equal((await ask("b")).block, true);
});

test("invalid settings are reported once at session start", async () => {
	h.settings = { awayStatus: { idleSeconds: "soon" } };
	await h.fire("session_start", { reason: "startup" });
	assert.match(h.notifications.at(-1)!, /awayStatus\.idleSeconds in settings\.json is not valid; using 600/);
});
