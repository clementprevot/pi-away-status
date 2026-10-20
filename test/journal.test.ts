import assert from "node:assert/strict";
import { test } from "node:test";

import { type AwayEntry, type BranchEntry, countsLabel, openEntries, plural, renderRecap } from "../journal.ts";

const AT = "2026-10-20T10:00:00Z";
const decision: AwayEntry = {
	kind: "decision",
	title: "Kept the existing hook instead of a new one",
	at: AT,
	choice: "reuse useFetchJson",
	alternatives: "a new useRemoteData hook",
	rationale: "same data, one less hook",
	revert: "inline the logic back into the component",
};
const command: AwayEntry = {
	kind: "pending_command",
	title: "Sign the rebased commits",
	at: AT,
	command: "git rebase --keep-base --gpg-sign @{u}",
	cwd: "/Users/me/worktrees/my-app/my branch",
	blockedBy: "1Password",
};

const logResult = (entry: AwayEntry, isError = false): BranchEntry => ({
	type: "message",
	message: { role: "toolResult", toolName: "away_log", details: { entry }, isError },
});
const custom = (data: unknown): BranchEntry => ({ type: "custom", customType: "away-status", data });

test("openEntries collects away_log results and custom entries since the last resume", () => {
	const prompt: AwayEntry = { kind: "blocked_prompt", title: "confirm prompt: Allow bash?", at: AT };
	const branch: BranchEntry[] = [
		logResult({ ...decision, title: "old" }),
		custom({ type: "resume", at: AT }),
		logResult(decision),
		logResult(command, true),
		{ type: "message", message: { role: "toolResult", toolName: "bash", details: { entry: decision } } },
		custom({ type: "entry", entry: prompt }),
		{ type: "custom", customType: "other-extension", data: { type: "resume" } },
		logResult(command),
	];
	assert.deepEqual(openEntries(branch), [decision, prompt, command]);
});

test("a resume marker clears the journal", () => {
	assert.deepEqual(openEntries([logResult(decision), custom({ type: "resume", at: AT })]), []);
});

test("countsLabel pluralizes and folds blocked prompts into questions", () => {
	const prompt: AwayEntry = { kind: "blocked_prompt", title: "p", at: AT };
	assert.equal(countsLabel([decision, decision, command, prompt]), "2 decisions, 1 command, 1 question");
	assert.equal(countsLabel([{ kind: "progress", title: "p", at: AT }]), "");
});

test("plural only drops the s for exactly one", () => {
	assert.equal(plural(0, "display"), "0 displays");
	assert.equal(plural(1, "display"), "1 display");
	assert.equal(plural(3, "display"), "3 displays");
});

test("renderRecap lists decisions with their revert path and commands as one copyable block", () => {
	const recap = renderRecap([command, decision, { kind: "question", title: "Ship behind a flag?", at: AT, options: "yes (recommended), no" }]);
	assert.match(recap, /### Decisions taken while you were away\n\n1\. Kept the existing hook/);
	assert.match(recap, /- to revert: inline the logic back/);
	assert.match(recap, /1\. Sign the rebased commits \(blocked by 1Password\)/);
	assert.match(recap, /```bash\n\(cd '\/Users\/me\/worktrees\/my-app\/my branch' && git rebase --keep-base --gpg-sign @\{u\}\)\n```/);
	assert.match(recap, /### Questions waiting for you\n\n1\. Ship behind a flag\?\n {3}- options: yes \(recommended\), no/);
	assert.ok(recap.indexOf("Decisions") < recap.indexOf("Commands"));
});

test("renderRecap leaves out empty sections and keeps simple paths unquoted", () => {
	const recap = renderRecap([{ ...command, cwd: "/tmp/repo" }]);
	assert.doesNotMatch(recap, /Decisions|Questions|Progress/);
	assert.match(recap, /\(cd \/tmp\/repo && git rebase/);
});

