import type { TFile } from "obsidian";

import { stripMdExtension } from "../link-utils";

export function buildDisplayTitleMap(files: TFile[]): Map<string, string> {
	const counts = new Map<string, number>();
	files.forEach((file) => {
		counts.set(file.basename, (counts.get(file.basename) ?? 0) + 1);
	});
	const map = new Map<string, string>();
	files.forEach((file) => {
		const hasDuplicate = (counts.get(file.basename) ?? 0) > 1;
		const display = hasDuplicate
			? stripMdExtension(file.path)
			: file.basename;
		map.set(file.path, display);
	});
	return map;
}
