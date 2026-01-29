import { describe, expect, it } from "vitest";

import {
	buildEditableHtml,
	extractRawFromEditable,
	findNearTokenRange,
	getCaretOffset,
	findSpanAtCursor,
	removeRange,
	restoreCaretOffset,
	stripMdExtension,
} from "../src/ui/query-utils";

describe("query utils", () => {
	it("strips .md extension", () => {
		expect(stripMdExtension("note.md")).toBe("note");
		expect(stripMdExtension("folder/note.md")).toBe("folder/note");
	});

	it("builds editable html with chips", () => {
		const html = buildEditableHtml("near:\"My Note\"", [
			{ start: 6, end: 13, text: "My Note" },
		]);
		expect(html).toContain("graph-search-chip");
		expect(html).toContain("My Note");
	});

	it("extracts raw text from editable chips", () => {
		const raw = 'near:"My Note" and more';
		const html = buildEditableHtml(raw, [
			{ start: 6, end: 13, text: "My Note" },
		]);
		const div = document.createElement("div");
		div.innerHTML = html;
		expect(extractRawFromEditable(div)).toBe(raw);
	});

	it("restores caret offset inside chip", () => {
		const raw = 'near:"My Note" and more';
		const html = buildEditableHtml(raw, [
			{ start: 6, end: 13, text: "My Note" },
		]);
		const div = document.createElement("div");
		div.setAttribute("contenteditable", "true");
		div.innerHTML = html;
		document.body.appendChild(div);
		restoreCaretOffset(div, 8);
		const caret = getCaretOffset(div);
		expect(caret).toBe("near:\"My Note\"".length);
		document.body.removeChild(div);
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
