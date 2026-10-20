export const ENTRY_KINDS = ["decision", "pending_command", "question", "progress", "blocked_prompt"] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];

export interface AwayEntry {
	kind: EntryKind;
	title: string;
	at: string;
	choice?: string;
	alternatives?: string;
	rationale?: string;
	revert?: string;
	command?: string;
	cwd?: string;
	blockedBy?: string;
	options?: string;
}

export const LOG_TOOL = "away_log";
export const CUSTOM_TYPE = "away-status";

export type CustomData = { type: "entry"; entry: AwayEntry } | { type: "resume"; at: string };

// Structural subset of pi's SessionEntry, enough to rebuild the journal.
export type BranchEntry =
	| { type: "message"; message: { role: string; toolName?: string; details?: unknown; isError?: boolean } }
	| { type: "custom"; customType: string; data?: unknown }
	| { type: string };

// Entries since the last resume marker on the current branch: the journal
// follows /tree navigation like the rest of the conversation.
export function openEntries(branch: readonly BranchEntry[]): AwayEntry[] {
	let open: AwayEntry[] = [];
	for (const item of branch) {
		if (item.type === "message" && "message" in item) {
			const { role, toolName, details, isError } = item.message;
			if (role !== "toolResult" || toolName !== LOG_TOOL || isError) continue;
			const entry = (details as { entry?: AwayEntry } | undefined)?.entry;
			if (entry) open.push(entry);
		} else if (item.type === "custom" && "customType" in item && item.customType === CUSTOM_TYPE) {
			const data = item.data as CustomData | undefined;
			if (data?.type === "entry") open.push(data.entry);
			if (data?.type === "resume") open = [];
		}
	}
	return open;
}

export function plural(count: number, word: string): string {
	return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export function countsLabel(entries: readonly AwayEntry[]): string {
	const count = (kind: EntryKind) => entries.filter((entry) => entry.kind === kind).length;
	const parts = [
		[count("decision"), "decision"],
		[count("pending_command"), "command"],
		[count("question") + count("blocked_prompt"), "question"],
	] as const;
	return parts
		.filter(([n]) => n > 0)
		.map(([n, label]) => plural(n, label))
		.join(", ");
}

function shellLine(entry: AwayEntry): string {
	const command = entry.command ?? entry.title;
	return entry.cwd ? `(cd ${shellQuote(entry.cwd)} && ${command})` : command;
}

function shellQuote(value: string): string {
	return /^[\w@%+=:,./~-]+$/.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;
}

function field(label: string, value: string | undefined): string[] {
	return value ? [`   - ${label}: ${value}`] : [];
}

export function renderRecap(entries: readonly AwayEntry[]): string {
	const byKind = (kind: EntryKind) => entries.filter((entry) => entry.kind === kind);
	const lines: string[] = [];

	const decisions = byKind("decision");
	if (decisions.length > 0) {
		lines.push("### Decisions taken while you were away", "");
		decisions.forEach((entry, index) => {
			lines.push(`${index + 1}. ${entry.title}`);
			lines.push(
				...field("choice", entry.choice),
				...field("alternatives", entry.alternatives),
				...field("why", entry.rationale),
				...field("to revert", entry.revert),
			);
		});
		lines.push("");
	}

	const commands = byKind("pending_command");
	if (commands.length > 0) {
		lines.push("### Commands waiting for you, in order", "");
		commands.forEach((entry, index) => {
			const blocked = entry.blockedBy ? ` (blocked by ${entry.blockedBy})` : "";
			lines.push(`${index + 1}. ${entry.title}${blocked}`);
		});
		lines.push("", "```bash", ...commands.map(shellLine), "```", "");
	}

	const questions = [...byKind("question"), ...byKind("blocked_prompt")];
	if (questions.length > 0) {
		lines.push("### Questions waiting for you", "");
		questions.forEach((entry, index) => {
			const prefix = entry.kind === "blocked_prompt" ? "Prompt left on screen: " : "";
			lines.push(`${index + 1}. ${prefix}${entry.title}`, ...field("options", entry.options));
		});
		lines.push("");
	}

	const progress = byKind("progress");
	if (progress.length > 0) {
		lines.push("### Progress while you were away", "", ...progress.map((entry) => `- ${entry.title}`), "");
	}

	return lines.join("\n").trimEnd();
}
