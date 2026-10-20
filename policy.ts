export const AWAY_RULES = [
	"Do not retry an operation that needs the user at the keyboard (1Password, SSO or device-code sign-in, Touch ID, sudo, permission prompts): each retry queues another prompt. Log it with away_log kind pending_command (exact command, cwd, what blocks it) and move on.",
	"No guardrail relaxes while the user is away: no --no-gpg-sign, no workaround for a blocked command, no commit, push, or publish.",
	"A question whose answer is cheap to reverse and stays inside the scope the user already approved: make the call, log it with away_log kind decision (choice, alternatives, why, how to revert), and continue.",
	"Anything else (new scope, destructive, outward-facing, costly to undo): log it with away_log kind question and keep working on what does not depend on it.",
	"Log meaningful progress with away_log kind progress. When nothing else can move, stop and end your turn with a short summary of what waits for the user.",
	"If a command hangs or runs much longer than expected, call screen_capture to check for a dialog waiting on the user (for example 1Password Access Requested).",
];

export function rulesBlock(): string {
	return AWAY_RULES.map((rule) => `- ${rule}`).join("\n");
}

export function blockedAskReason(statusLine: string): string {
	return [
		`The user is ${statusLine}: nobody can answer ask_user_question right now and the session would hang.`,
		"Away mode rules:",
		rulesBlock(),
	].join("\n");
}

export function wentAwayNote(statusLine: string): string {
	return [`[away-status] The user just went ${statusLine}. Away mode is on until they come back:`, rulesBlock()].join("\n");
}

export const CAME_BACK_NOTE =
	"[away-status] The user is back at the keyboard. Prompts and questions work again; if you logged away entries, mention that the away recap is ready (/back).";

export function leaveNote(): string {
	return [
		"[away-status] The user just said they are leaving: away mode is on until they say they are back (or type /back).",
		"Acknowledge it in one short line, then do what the message asks under the away mode rules:",
		rulesBlock(),
	].join("\n");
}

function clockTime(date: Date): string {
	return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function stillAwayNote(since: Date | undefined): string {
	const when = since ? ` since ${clockTime(since)}` : "";
	return [
		`[away-status] Away mode is still on${when}: the user said they were leaving and has not said they are back.`,
		"Start your answer with one short line pointing it out (they may just be adding a last instruction before leaving, which is fine), and remind them that \"je suis de retour\" or /back ends it.",
		"Keep following the away mode rules: ask_user_question stays blocked until they are back.",
	].join("\n");
}

export function slowCommandNote(statusLine: string, seconds: number): string {
	return `[away-status] This command took ${seconds}s while the user is ${statusLine}. If it waited on a prompt (1Password, SSO, Touch ID), do not retry it: log it with away_log kind pending_command. Use screen_capture to check for a leftover dialog.`;
}

export function resumeMessage(recap: string): string {
	return [
		"[away-status] The user is back. Here is the away journal for this session:",
		"",
		recap,
		"",
		"Present it first, in the user's language, in this order:",
		"1. The decisions, each with its choice and how to revert it, so the user can challenge them quickly.",
		"2. The commands, reproduced exactly as in the bash block above, in a single block the user can copy.",
		"3. The open questions, with your recommended answer for each.",
		"Then wait for the answers and the confirmation that the commands ran before you resume the blocked work.",
	].join("\n");
}
