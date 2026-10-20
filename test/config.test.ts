import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_CONFIG, resolveConfig } from "../config.ts";

test("defaults apply without settings or environment", () => {
	assert.deepEqual(resolveConfig({}, {}), { config: DEFAULT_CONFIG, warnings: [] });
});

test("the awayStatus settings key overrides the defaults", () => {
	const { config, warnings } = resolveConfig(
		{ awayStatus: { idleSeconds: 300, slowCommandSeconds: 60, captureSilent: true } },
		{},
	);
	assert.deepEqual(config, { idleSeconds: 300, slowCommandSeconds: 60, captureSilent: true });
	assert.deepEqual(warnings, []);
});

test("environment variables override the settings", () => {
	const { config } = resolveConfig(
		{ awayStatus: { idleSeconds: 300, captureSilent: true } },
		{ PI_AWAY_STATUS_IDLE_SECONDS: "120", PI_AWAY_STATUS_CAPTURE_SILENT: "0" },
	);
	assert.equal(config.idleSeconds, 120);
	assert.equal(config.captureSilent, false);
});

test("an empty environment variable counts as unset", () => {
	const { config, warnings } = resolveConfig({ awayStatus: { idleSeconds: 300 } }, { PI_AWAY_STATUS_IDLE_SECONDS: " " });
	assert.equal(config.idleSeconds, 300);
	assert.deepEqual(warnings, []);
});

test("invalid values fall through to the next layer with a warning", () => {
	const { config, warnings } = resolveConfig(
		{ awayStatus: { idleSeconds: -5, slowCommandSeconds: 45 } },
		{ PI_AWAY_STATUS_SLOW_COMMAND_SECONDS: "fast" },
	);
	assert.equal(config.idleSeconds, DEFAULT_CONFIG.idleSeconds);
	assert.equal(config.slowCommandSeconds, 45);
	assert.equal(warnings.length, 2);
	assert.match(warnings[0], /awayStatus\.idleSeconds/);
	assert.match(warnings[1], /PI_AWAY_STATUS_SLOW_COMMAND_SECONDS="fast"/);
});

test("a non-object awayStatus value is reported and ignored", () => {
	const { config, warnings } = resolveConfig({ awayStatus: 300 }, {});
	assert.deepEqual(config, DEFAULT_CONFIG);
	assert.match(warnings[0], /must be an object/);
});
