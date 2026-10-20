import { DEFAULT_CONFIG } from "./config.ts";

export type Exec = (command: string, args: string[]) => Promise<{ stdout: string; code: number }>;

export type AwayReason = "idle" | "locked" | "screensaver" | "forced";

export interface AwayStatus {
	checkedAt: string;
	idleSeconds: number | null;
	idleThresholdSeconds: number;
	screenLocked: boolean;
	screensaverActive: boolean;
	away: boolean;
	reasons: AwayReason[];
	source: "sensor" | "forced" | "unavailable";
}

export type ForcedMode = "away" | "present" | undefined;

// HIDIdleTime is the counter behind the screensaver: keyboard, mouse and
// trackpad reset it, agent activity does not. Reading it needs no permission.
export function parseIdleSeconds(ioregOutput: string): number | null {
	const match = /"HIDIdleTime" = (\d+)/.exec(ioregOutput);
	return match ? Math.floor(Number(match[1]) / 1e9) : null;
}

export function parseScreenLocked(rootPlist: string): boolean {
	return /<key>CGSSessionScreenIsLocked<\/key>\s*<true\/>/.test(rootPlist);
}

export function buildStatus(input: {
	idleSeconds: number | null;
	screenLocked: boolean;
	screensaverActive: boolean;
	threshold: number;
	forced: ForcedMode;
	now: Date;
}): AwayStatus {
	const reasons: AwayReason[] = [];
	if (input.screensaverActive) reasons.push("screensaver");
	if (input.screenLocked) reasons.push("locked");
	if (input.idleSeconds !== null && input.idleSeconds >= input.threshold) reasons.push("idle");

	let away = reasons.length > 0;
	let source: AwayStatus["source"] = input.idleSeconds === null ? "unavailable" : "sensor";
	if (input.forced) {
		away = input.forced === "away";
		source = "forced";
		if (away) reasons.push("forced");
	}

	return {
		checkedAt: input.now.toISOString(),
		idleSeconds: input.idleSeconds,
		idleThresholdSeconds: input.threshold,
		screenLocked: input.screenLocked,
		screensaverActive: input.screensaverActive,
		away,
		reasons,
		source,
	};
}

export async function readAwayStatus(exec: Exec, forced: ForcedMode, threshold: number, now = new Date()): Promise<AwayStatus> {
	const [hid, root, screensaver] = await Promise.all([
		exec("ioreg", ["-r", "-k", "HIDIdleTime", "-d", "1"]).catch(() => undefined),
		exec("ioreg", ["-n", "Root", "-d", "1", "-a"]).catch(() => undefined),
		exec("pgrep", ["-qx", "ScreenSaverEngine"]).catch(() => undefined),
	]);
	return buildStatus({
		idleSeconds: hid?.code === 0 ? parseIdleSeconds(hid.stdout) : null,
		screenLocked: root?.code === 0 ? parseScreenLocked(root.stdout) : false,
		screensaverActive: screensaver?.code === 0,
		threshold,
		forced,
		now,
	});
}

// Tool results can arrive in bursts; three process spawns per result would add up.
export class CachedSensor {
	private cached: { at: number; status: AwayStatus } | undefined;
	private readonly exec: Exec;
	private readonly ttlMs: number;
	private readonly clock: () => number;
	forced: ForcedMode;
	idleThresholdSeconds = DEFAULT_CONFIG.idleSeconds;

	constructor(exec: Exec, ttlMs = 5_000, clock: () => number = Date.now) {
		this.exec = exec;
		this.ttlMs = ttlMs;
		this.clock = clock;
	}

	async read(): Promise<AwayStatus> {
		const now = this.clock();
		if (this.cached && now - this.cached.at < this.ttlMs) return this.cached.status;
		const status = await readAwayStatus(this.exec, this.forced, this.idleThresholdSeconds, new Date(now));
		this.cached = { at: now, status };
		return status;
	}

	invalidate(): void {
		this.cached = undefined;
	}
}

export function describeStatus(status: AwayStatus): string {
	if (status.source === "unavailable") return "unknown (sensor unavailable, assume present)";
	if (!status.away) return "present";
	const idle = status.idleSeconds === null ? "" : `, idle ${Math.round(status.idleSeconds / 60)} min`;
	return `away (${status.reasons.join(", ")}${idle})`;
}
