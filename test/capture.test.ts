import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { countDisplays, purgeOldCaptures } from "../capture.ts";

test("countDisplays counts online, non-mirrored displays across GPUs", () => {
	const json = JSON.stringify({
		SPDisplaysDataType: [
			{
				spdisplays_ndrvs: [
					{ spdisplays_online: "spdisplays_yes" },
					{ spdisplays_online: "spdisplays_yes", spdisplays_mirror: "spdisplays_on" },
					{ spdisplays_online: "spdisplays_no" },
				],
			},
			{ spdisplays_ndrvs: [{ spdisplays_online: "spdisplays_yes", spdisplays_mirror: "spdisplays_off" }] },
		],
	});
	assert.equal(countDisplays(json), 2);
});

test("countDisplays falls back to one display on unreadable output", () => {
	assert.equal(countDisplays("not json"), 1);
	assert.equal(countDisplays("{}"), 1);
});

test("purgeOldCaptures removes capture folders older than a day only", () => {
	const root = mkdtempSync(join(tmpdir(), "away-status-test-"));
	const old = join(root, "old");
	const fresh = join(root, "fresh");
	for (const dir of [old, fresh]) {
		mkdirSync(dir);
		writeFileSync(join(dir, "screen-1.jpg"), "x");
	}
	const twoDaysAgo = (Date.now() - 2 * 24 * 60 * 60 * 1000) / 1000;
	utimesSync(old, twoDaysAgo, twoDaysAgo);

	purgeOldCaptures(root);
	assert.equal(existsSync(old), false);
	assert.equal(existsSync(fresh), true);
});

test("purgeOldCaptures ignores a missing root", () => {
	assert.doesNotThrow(() => purgeOldCaptures(join(tmpdir(), "away-status-missing-root")));
});
