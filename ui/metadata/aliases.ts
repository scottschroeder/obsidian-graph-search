import type { App, TFile } from "obsidian";

function collectFrontmatterAliases(value: unknown): string[] {
	if (typeof value === "string") {
		return [value];
	}
	if (Array.isArray(value)) {
		return value.map((entry) => String(entry));
	}
	return [];
}

export function collectFileAliases(app: App, file: TFile): string[] {
	const cache = app.metadataCache.getFileCache(file);
	const aliases = [
		...collectFrontmatterAliases(cache?.frontmatter?.aliases),
		...collectFrontmatterAliases(cache?.frontmatter?.alias),
	]
		.map((alias) => alias.trim())
		.filter((alias) => alias.length > 0);
	return Array.from(new Set(aliases));
}
