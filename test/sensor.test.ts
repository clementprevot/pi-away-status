import assert from "node:assert/strict";
import { test } from "node:test";

import { buildStatus, CachedSensor, describeStatus, type Exec, parseIdleSeconds, parseScreenLocked } from "../sensor.ts";

const NOW = new Date("2026-10-20T10:00:00Z");

test("parseIdleSeconds reads HIDIdleTime nanoseconds as whole seconds", () => {
	assert.equal(parseIdleSeconds('  | "HIDIdleTime" = 754000000000\n'), 754);
	assert.equal(parseIdleSeconds("no counter here"), null);
});

test("parseScreenLocked only matches a true lock flag", () => {
	assert.equal(parseScreenLocked("<key>CGSSessionScreenIsLocked</key>\n\t\t\t<true/>"), true);
	assert.equal(parseScreenLocked("<key>CGSSessionScreenIsLocked</key>\n<false/>"), false);
	assert.equal(parseScreenLocked("<key>kCGSSessionOnConsoleKey</key><true/>"), false);
});

const base = { idleSeconds: 0, screenLocked: false, screensaverActive: false, threshold: 600, forced: undefined, now: NOW };

test("buildStatus is away when idle reaches the threshold, locked, or on screensaver", () => {
	assert.equal(buildStatus(base).away, false);
	assert.deepEqual(buildStatus({ ...base, idleSeconds: 600 }).reasons, ["idle"]);
	assert.deepEqual(buildStatus({ ...base, screenLocked: true, screensaverActive: true }).reasons, ["screensaver", "locked"]);
});

test("buildStatus treats a missing sensor as present and unavailable", () => {
	const status = buildStatus({ ...base, idleSeconds: null });
	assert.equal(status.away, false);
	assert.equal(status.source, "unavailable");
});

test("a forced mode overrides the sensor both ways", () => {
	assert.equal(buildStatus({ ...base, forced: "away" }).away, true);
	assert.equal(buildStatus({ ...base, screenLocked: true, forced: "present" }).away, false);
	assert.equal(buildStatus({ ...base, forced: "away" }).source, "forced");
});

test("describeStatus gives a short readable line", () => {
	assert.equal(describeStatus(buildStatus(base)), "present");
	assert.equal(describeStatus(buildStatus({ ...base, idleSeconds: 900 })), "away (idle, idle 15 min)");
});

function fakeExec(idleNs: number, calls: string[]): Exec {
	return async (command, args) => {
		calls.push(`${command} ${args.join(" ")}`);
		if (command === "ioreg" && args.includes("HIDIdleTime")) return { stdout: `"HIDIdleTime" = ${idleNs}`, code: 0 };
		if (command === "ioreg") return { stdout: "<plist/>", code: 0 };
		return { stdout: "", code: 1 };
	};
}

test("CachedSensor reuses a fresh reading and re-reads after invalidate or expiry", async () => {
	const calls: string[] = [];
	let clock = 0;
	const sensor = new CachedSensor(fakeExec(700e9, calls), 5_000, () => clock);

	assert.equal((await sensor.read()).away, true);
	await sensor.read();
	assert.equal(calls.length, 3);

	clock = 6_000;
	await sensor.read();
	assert.equal(calls.length, 6);

	sensor.invalidate();
	sensor.forced = "present";
	assert.equal((await sensor.read()).away, false);
});
