import { describe, expect, it } from "vitest";
import { App, TFile } from "obsidian";

import { buildNoteTitleItems } from "../ui/title-suggest";

function makeFile(path: string, basename: string): TFile {
	const file = new TFile();
	file.path = path;
	file.basename = basename;
	return file;
}

describe("buildNoteTitleItems", () => {
	it("adds alias entries that resolve to the canonical note path", () => {
		const app = new App();
		const alpha = makeFile("notes/alpha.md", "alpha");
		app.vault.getMarkdownFiles = () => [alpha];
		app.metadataCache.getFileCache = (file: TFile) => {
			if (file.path === alpha.path) {
				return {
					frontmatter: {
						aliases: ["First Note", "A"],
					},
				};
			}
			return null;
		};

		const items = buildNoteTitleItems(app);
		const labels = items.map((item) => item.label);

		expect(labels).toContain("alpha");
		expect(labels).toContain("First Note -> alpha");
		expect(labels).toContain("A -> alpha");
		expect(items).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					label: "First Note -> alpha",
					value: "notes/alpha.md",
					display: "First Note",
				}),
			]),
		);
	});

	it("supports both alias and aliases frontmatter fields", () => {
		const app = new App();
		const alpha = makeFile("notes/alpha.md", "alpha");
		app.vault.getMarkdownFiles = () => [alpha];
		app.metadataCache.getFileCache = () => ({
			frontmatter: {
				alias: "Primary Alias",
				aliases: ["Secondary Alias", "Primary Alias", "  "],
			},
		});

		const items = buildNoteTitleItems(app);
		const aliasLabels = items
			.map((item) => item.label)
			.filter((label) => label.includes("->"));

		expect(aliasLabels).toEqual([
			"Secondary Alias -> alpha",
			"Primary Alias -> alpha",
		]);
	});

	it("uses the canonical display title for duplicate basenames", () => {
		const app = new App();
		const alpha = makeFile("notes/alpha.md", "alpha");
		const duplicate = makeFile("projects/alpha.md", "alpha");
		app.vault.getMarkdownFiles = () => [alpha, duplicate];
		app.metadataCache.getFileCache = (file: TFile) => {
			if (file.path === duplicate.path) {
				return {
					frontmatter: {
						aliases: ["Project Alpha"],
					},
				};
			}
			return null;
		};

		const items = buildNoteTitleItems(app);

		expect(items).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					label: "Project Alpha -> projects/alpha",
					value: "projects/alpha.md",
					display: "Project Alpha",
				}),
			]),
		);
	});

	it("keeps the selected alias as chip display text", () => {
		const app = new App();
		const alpha = makeFile("notes/alpha.md", "alpha");
		app.vault.getMarkdownFiles = () => [alpha];
		app.metadataCache.getFileCache = () => ({
			frontmatter: {
				aliases: ["Chosen Alias"],
			},
		});

		const items = buildNoteTitleItems(app);
		const aliasItem = items.find(
			(item) => item.label === "Chosen Alias -> alpha",
		);

		expect(aliasItem).toMatchObject({
			value: "notes/alpha.md",
			display: "Chosen Alias",
		});
	});
});
