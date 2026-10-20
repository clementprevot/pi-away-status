import { mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Exec } from "./sensor.ts";

const RETENTION_MS = 24 * 60 * 60 * 1000;
// Full-resolution captures of a 5K screen weigh several MB once base64 encoded.
const MAX_EDGE_PX = 1800;
const MIN_VALID_BYTES = 1024;

export function captureRoot(): string {
	return join(tmpdir(), "pi-away-status-captures");
}

export function countDisplays(profilerJson: string): number {
	try {
		const data = JSON.parse(profilerJson) as {
			SPDisplaysDataType?: { spdisplays_ndrvs?: { spdisplays_online?: string; spdisplays_mirror?: string }[] }[];
		};
		const displays = (data.SPDisplaysDataType ?? []).flatMap((gpu) => gpu.spdisplays_ndrvs ?? []);
		const shown = displays.filter((d) => d.spdisplays_online !== "spdisplays_no" && d.spdisplays_mirror !== "spdisplays_on");
		return Math.max(1, shown.length);
	} catch {
		return 1;
	}
}

export function purgeOldCaptures(root = captureRoot(), now = Date.now()): void {
	let names: string[];
	try {
		names = readdirSync(root);
	} catch {
		return;
	}
	for (const name of names) {
		const path = join(root, name);
		try {
			if (now - statSync(path).mtimeMs > RETENTION_MS) rmSync(path, { recursive: true, force: true });
		} catch {
			// Already gone or unreadable: nothing worth failing a capture for.
		}
	}
}

export interface Capture {
	paths: string[];
	images: { data: string; mimeType: string }[];
}

export async function captureScreens(exec: Exec, options: { silent: boolean; now?: Date }): Promise<Capture> {
	const root = captureRoot();
	purgeOldCaptures(root);
	const stamp = (options.now ?? new Date()).toISOString().replaceAll(":", "-").replace(/\.\d+Z$/, "Z");
	const dir = join(root, stamp);
	mkdirSync(dir, { recursive: true });

	const profiler = await exec("system_profiler", ["SPDisplaysDataType", "-json"]).catch(() => undefined);
	const count = countDisplays(profiler?.stdout ?? "");
	const paths = Array.from({ length: count }, (_, index) => join(dir, `screen-${index + 1}.jpg`));

	const flags = options.silent ? ["-x"] : [];
	const shot = await exec("screencapture", [...flags, "-t", "jpg", ...paths]);
	if (shot.code !== 0) {
		throw new Error(
			"screencapture failed. The terminal running pi probably lacks the Screen Recording permission (System Settings > Privacy & Security > Screen Recording).",
		);
	}

	const images: Capture["images"] = [];
	for (const path of paths) {
		let size = 0;
		try {
			size = statSync(path).size;
		} catch {}
		if (size < MIN_VALID_BYTES) {
			throw new Error(
				`screencapture produced no usable image at ${path}. Check the Screen Recording permission for the terminal running pi; a locked screen also yields empty frames.`,
			);
		}
		await exec("sips", ["-Z", String(MAX_EDGE_PX), "-s", "formatOptions", "70", path]);
		images.push({ data: readFileSync(path).toString("base64"), mimeType: "image/jpeg" });
	}
	return { paths, images };
}
