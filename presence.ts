export interface PresenceIntent {
	back: boolean;
	leave: boolean;
}

// Lowercase, no accents, straight apostrophes: "Je m’absente" and "je m'absente" match alike.
function normalize(text: string): string {
	return text
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.replaceAll("’", "'")
		.toLowerCase();
}

const BACK_PHRASE = /^\s*(?:je suis de retour|de retour|me revoila|i'?m back|i am back)(?:[\s,.!:;]|$)/;
// Short words only count on their own: "re-read this" or "back to the PR" are not a return.
const BACK_WORD = /^\s*(?:re|back|rebonjour)\s*[!.]*\s*$/;

// Matched anywhere in the message, since a departure often closes a longer instruction.
const LEAVE_PATTERNS = [
	/\bje (?:file|me casse|m'absente|m'en vais|decolle|vais y aller|y vais|vais manger|vais dejeuner|vais courir|vais faire (?:une|ma) pause|reviens plus tard|suis absent)\b/,
	/\bje reviens dans (?:\d|une?\b|quelques\b)/,
	// "je pars du principe", "je pars sur l'option A", "je pars pas" are not departures.
	/\bje par[st]\b(?!\s+(?:du|de|des|d'|sur|avec|pour|dans|pas)\b)/,
	/(?:^|\s)(?:j'y vais|j'y go|je go)\b/,
	/(?:^|[\s,.!])(?:a\+|@\+|a plus|a toute|a tout a l'heure|a tt)\s*[!.]*\s*$/,
	/\b(?:afk|brb|bbl)\b/,
	/\b(?:i'?m|i am) (?:off|leaving|heading out|stepping (?:away|out))\b/,
	/\b(?:gotta go|be right back|back in \d+)\b/,
	/\bpause (?:dej|dejeuner|cafe|repas|midi)\b/,
];

export function classifyPresence(text: string): PresenceIntent {
	const normalized = normalize(text);
	return {
		back: BACK_PHRASE.test(normalized) || BACK_WORD.test(normalized),
		leave: LEAVE_PATTERNS.some((pattern) => pattern.test(normalized)),
	};
}
