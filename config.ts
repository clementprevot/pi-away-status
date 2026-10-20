export const SETTINGS_KEY = "awayStatus";

export interface AwayConfig {
	idleSeconds: number;
	slowCommandSeconds: number;
	captureSilent: boolean;
}

export const DEFAULT_CONFIG: AwayConfig = {
	idleSeconds: 600,
	slowCommandSeconds: 30,
	captureSilent: false,
};

const ENV = {
	idleSeconds: "PI_AWAY_STATUS_IDLE_SECONDS",
	slowCommandSeconds: "PI_AWAY_STATUS_SLOW_COMMAND_SECONDS",
	captureSilent: "PI_AWAY_STATUS_CAPTURE_SILENT",
} as const;

function positiveNumber(value: unknown): number | undefined {
	const parsed = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
	return typeof parsed === "number" && Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function flag(value: unknown): boolean | undefined {
	if (typeof value === "boolean") return value;
	if (typeof value !== "string") return undefined;
	const normalized = value.trim().toLowerCase();
	if (["1", "true", "yes", "on"].includes(normalized)) return true;
	if (["0", "false", "no", "off"].includes(normalized)) return false;
	return undefined;
}

export interface ResolvedConfig {
	config: AwayConfig;
	warnings: string[];
}

// Precedence: environment variable, then the "awayStatus" key of the pi settings
// (global merged with project), then the default. An invalid value falls through.
export function resolveConfig(settings: Record<string, unknown>, env: NodeJS.ProcessEnv = process.env): ResolvedConfig {
	const raw = settings[SETTINGS_KEY];
	const section = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
	const warnings: string[] = [];
	if (raw !== undefined && section !== raw) warnings.push(`"${SETTINGS_KEY}" in settings.json must be an object; using defaults.`);

	const pick = <K extends keyof AwayConfig>(key: K, parse: (value: unknown) => AwayConfig[K] | undefined): AwayConfig[K] => {
		const fromEnv = env[ENV[key]]?.trim() || undefined;
		const envValue = fromEnv === undefined ? undefined : parse(fromEnv);
		if (fromEnv !== undefined && envValue === undefined) warnings.push(`${ENV[key]}="${fromEnv}" is not valid; ignored.`);
		if (envValue !== undefined) return envValue;

		const settingValue = section[key] === undefined ? undefined : parse(section[key]);
		if (section[key] !== undefined && settingValue === undefined) {
			warnings.push(`${SETTINGS_KEY}.${key} in settings.json is not valid; using ${DEFAULT_CONFIG[key]}.`);
		}
		return settingValue ?? DEFAULT_CONFIG[key];
	};

	return {
		config: {
			idleSeconds: pick("idleSeconds", positiveNumber),
			slowCommandSeconds: pick("slowCommandSeconds", positiveNumber),
			captureSilent: pick("captureSilent", flag),
		},
		warnings,
	};
}
