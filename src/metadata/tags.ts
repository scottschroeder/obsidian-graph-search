import type { App, TFile } from "obsidian";

import { collectFrontmatterTags, splitTagString } from "../tag-utils";

export function collectFileTags(app: App, file: TFile): string[] {
	const cache = app.metadataCache.getFileCache(file);
	const inlineTags = cache?.tags?.map((tag) => tag.tag) ?? [];
	const frontmatter = cache?.frontmatter?.tags;
	const frontmatterTags = collectFrontmatterTags(frontmatter);
	const combined = [...inlineTags, ...frontmatterTags]
		.flatMap((tag) => splitTagString(tag))
		.map((tag) => tag.trim())
		.filter((tag) => tag.length > 0)
		.map((tag) => (tag.startsWith("#") ? tag : `#${tag}`));
	return Array.from(new Set(combined));
}
