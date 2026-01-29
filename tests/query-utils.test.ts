import { describe, expect, it } from "vitest";

import {
	buildOverlayHtml,
	findNearTokenRange,
	findSpanAtCursor,
	removeRange,
	stripMdExtension,
} from "../src/ui/query-utils";

describe("query utils", () => {
	it("strips .md extension", () => {
		expect(stripMdExtension("note.md")).toBe("note");
		expect(stripMdExtension("folder/note.md")).toBe("folder/note");
	});

	it("builds overlay with chips", () => {
		const html = buildOverlayHtml("near:\"My Note\"", [
			{ start: 6, end: 13, text: "My Note" },
		]);
		expect(html).toContain("graph-search-chip");
		expect(html).toContain("My Note");
	});

	it("removes near token range", () => {
		const raw = "tag:#meeting near:Project status";
		const span = { start: 18, end: 25, text: "Project" };
		const range = findNearTokenRange(raw, span);
		expect(range).not.toBeNull();
		if (!range) return;
		const updated = removeRange(raw, range.start, range.end);
		expect(updated.value).toBe("tag:#meeting status");
	});

	it("finds span at cursor", () => {
		const span = { start: 5, end: 10, text: "alpha" };
		expect(findSpanAtCursor([span], 7)).toEqual(span);
		expect(findSpanAtCursor([span], 2)).toBeNull();
	});
});
