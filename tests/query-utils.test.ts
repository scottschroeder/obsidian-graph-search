import { describe, expect, it } from "vitest";

import type { QueryAtom } from "../src/ui/types";

import {
	buildEditableHtmlFromAtoms,
	buildRawFromAtoms,
	extractAtomsFromEditable,
	extractRawFromEditable,
	getCaretOffset,
	restoreCaretOffset,
	stripMdExtension,
} from "../src/ui/query-utils";

describe("query utils", () => {
	it("strips .md extension", () => {
		expect(stripMdExtension("note.md")).toBe("note");
		expect(stripMdExtension("folder/note.md")).toBe("folder/note");
	});

	it("builds editable html with chips", () => {
		const atoms: QueryAtom[] = [
			{ kind: "near", value: "My Note" },
			{ kind: "whitespace", value: " " },
			{ kind: "term", value: "budget" },
		];
		const html = buildEditableHtmlFromAtoms(atoms);
		expect(html).toContain("graph-search-chip");
		expect(html).toContain("My Note");
	});

	it("extracts atoms from editable chips", () => {
		const atoms: QueryAtom[] = [
			{ kind: "near", value: "My Note" },
			{ kind: "whitespace", value: " " },
			{ kind: "term", value: "and" },
			{ kind: "whitespace", value: " " },
			{ kind: "term", value: "more" },
		];
		const html = buildEditableHtmlFromAtoms(atoms);
		const div = document.createElement("div");
		div.innerHTML = html;
		expect(extractAtomsFromEditable(div)).toEqual(atoms);
	});

	it("restores caret offset inside chip", () => {
		const atoms: QueryAtom[] = [
			{ kind: "near", value: "My Note" },
			{ kind: "whitespace", value: " " },
			{ kind: "term", value: "and" },
		];
		const html = buildEditableHtmlFromAtoms(atoms);
		const div = document.createElement("div");
		div.setAttribute("contenteditable", "true");
		div.innerHTML = html;
		document.body.appendChild(div);
		const raw = buildRawFromAtoms(atoms);
		restoreCaretOffset(div, raw.length);
		const caret = getCaretOffset(div);
		expect(caret).toBe(raw.length);
		document.body.removeChild(div);
	});

	it("extracts raw text from editable chips", () => {
		const atoms: QueryAtom[] = [
			{ kind: "tag", value: "#meeting" },
			{ kind: "whitespace", value: " " },
			{ kind: "term", value: "notes" },
		];
		const html = buildEditableHtmlFromAtoms(atoms);
		const div = document.createElement("div");
		div.innerHTML = html;
		expect(extractRawFromEditable(div)).toBe("#meeting notes");
	});
});
