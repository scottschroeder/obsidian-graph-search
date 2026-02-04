import { describe, expect, it } from "vitest";

import type { QueryAtom } from "../src/ui/types";

import {
	buildRawFromAtoms,
	displayLengthForAtom,
	displayLengthForAtoms,
	findTokenAtCursor,
	offsetForAtom,
	snapCaretBeforeChip,
	stripMdExtension,
} from "../src/ui/query-utils";
import {
	buildSnippet,
	buildSnippetNodes,
	escapeRegExp,
} from "../src/ui/html-utils";
import { buildEditableDomFromAtoms } from "../src/ui/query-input/html-utils";
import {
	extractAtomsFromEditable,
	extractRawFromEditable,
	getCaretOffset,
	restoreCaretOffset,
} from "../src/ui/query-input/editable-dom";

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
		const div = document.createElement("div");
		div.appendChild(buildEditableDomFromAtoms(atoms));
		const chip = div.querySelector(".graph-search-chip");
		expect(chip).not.toBeNull();
		expect(chip?.textContent).toContain("My Note");
	});

	it("extracts atoms from editable chips", () => {
		const atoms: QueryAtom[] = [
			{ kind: "near", value: "My Note" },
			{ kind: "whitespace", value: " " },
			{ kind: "term", value: "and" },
			{ kind: "whitespace", value: " " },
			{ kind: "term", value: "more" },
		];
		const div = document.createElement("div");
		div.appendChild(buildEditableDomFromAtoms(atoms));
		expect(extractAtomsFromEditable(div)).toEqual(atoms);
	});

	it("clamps caret offset inside chip", () => {
		const atoms: QueryAtom[] = [
			{ kind: "near", value: "My Note" },
			{ kind: "whitespace", value: " " },
			{ kind: "term", value: "and" },
		];
		const div = document.createElement("div");
		div.setAttribute("contenteditable", "true");
		div.appendChild(buildEditableDomFromAtoms(atoms));
		document.body.appendChild(div);
		const insideChipOffset = 3;
		restoreCaretOffset(div, insideChipOffset);
		const caret = getCaretOffset(div);
		expect(caret).toBe(atoms[0].value.length);
		document.body.removeChild(div);
	});

	it("restores caret before chip when preferred", () => {
		const atoms: QueryAtom[] = [
			{ kind: "term", value: "a" },
			{ kind: "whitespace", value: " " },
			{ kind: "near", value: "My Note" },
			{ kind: "whitespace", value: " " },
			{ kind: "term", value: "and" },
		];
		const div = document.createElement("div");
		div.setAttribute("contenteditable", "true");
		div.appendChild(buildEditableDomFromAtoms(atoms));
		document.body.appendChild(div);
		const insideChipOffset = 4;
		restoreCaretOffset(div, insideChipOffset, { preferBeforeChip: true });
		const caret = getCaretOffset(div);
		expect(caret).toBe(2);
		document.body.removeChild(div);
	});

	it("computes caret offset when selection is on root", () => {
		const atoms: QueryAtom[] = [
			{ kind: "near", value: "One" },
			{ kind: "whitespace", value: " " },
			{ kind: "near", value: "Two" },
		];
		const div = document.createElement("div");
		div.setAttribute("contenteditable", "true");
		div.appendChild(buildEditableDomFromAtoms(atoms));
		document.body.appendChild(div);
		const selection = window.getSelection();
		const range = document.createRange();
		range.setStart(div, 0);
		range.collapse(true);
		selection?.removeAllRanges();
		selection?.addRange(range);
		expect(getCaretOffset(div)).toBe(0);
		const chipLength = atoms[0].value.length;
		range.setStart(div, 1);
		range.collapse(true);
		selection?.removeAllRanges();
		selection?.addRange(range);
		expect(getCaretOffset(div)).toBe(chipLength);
		document.body.removeChild(div);
	});

	it("extracts raw text from editable chips", () => {
		const atoms: QueryAtom[] = [
			{ kind: "tag", value: "#meeting" },
			{ kind: "whitespace", value: " " },
			{ kind: "term", value: "notes" },
		];
		const div = document.createElement("div");
		div.appendChild(buildEditableDomFromAtoms(atoms));
		expect(extractRawFromEditable(div)).toBe("#meeting notes");
	});

	it("uses display length for chip offsets", () => {
		const atoms: QueryAtom[] = [
			{ kind: "near", value: "notes/alpha.md", display: "alpha" },
			{ kind: "whitespace", value: " " },
			{ kind: "term", value: "tag" },
		];
		expect(displayLengthForAtom(atoms[0])).toBe(5);
		expect(displayLengthForAtoms(atoms)).toBe(9);
		expect(offsetForAtom(atoms, 2)).toBe(6);
	});

	it("snaps caret before chip when inside", () => {
		const atoms: QueryAtom[] = [
			{ kind: "term", value: "foo" },
			{ kind: "whitespace", value: " " },
			{ kind: "near", value: "note", display: "Note.md" },
			{ kind: "whitespace", value: " " },
			{ kind: "term", value: "bar" },
		];
		expect(snapCaretBeforeChip(atoms, 6)).toBe(4);
	});

	it("keeps caret outside chip bounds", () => {
		const atoms: QueryAtom[] = [
			{ kind: "term", value: "foo" },
			{ kind: "whitespace", value: " " },
			{ kind: "near", value: "note", display: "Note.md" },
			{ kind: "whitespace", value: " " },
			{ kind: "term", value: "bar" },
		];
		expect(snapCaretBeforeChip(atoms, 0)).toBe(0);
		expect(snapCaretBeforeChip(atoms, 4)).toBe(4);
		expect(snapCaretBeforeChip(atoms, 11)).toBe(11);
	});
});

describe("buildSnippet", () => {
	it("returns empty for empty body", () => {
		expect(buildSnippet("", ["term"])).toBe("");
	});

	it("returns empty for no terms", () => {
		expect(buildSnippet("some body text", [])).toBe("");
	});

	it("returns empty when no terms match", () => {
		expect(buildSnippet("hello world", ["missing"])).toBe("");
	});

	it("centers snippet around first match", () => {
		const body = "prefix ".repeat(20) + "TARGET " + "suffix ".repeat(20);
		const snippet = buildSnippet(body, ["target"]);
		expect(snippet).toContain("TARGET");
	});

	it("handles match at start of body", () => {
		const snippet = buildSnippet("target is at the start", ["target"]);
		expect(snippet).toContain("target");
	});

	it("handles match at end of body", () => {
		const body = "prefix ".repeat(30) + "target";
		const snippet = buildSnippet(body, ["target"]);
		expect(snippet).toContain("target");
	});
});

describe("buildSnippetNodes", () => {
	it("wraps matching terms in highlight span", () => {
		const fragment = buildSnippetNodes("hello world", ["world"]);
		const div = document.createElement("div");
		div.appendChild(fragment);
		const highlights = div.querySelectorAll(".graph-search-highlight");
		expect(highlights.length).toBe(1);
		expect(highlights[0].textContent).toBe("world");
		expect(div.textContent).toBe("hello world");
	});

	it("handles multiple term matches", () => {
		const fragment = buildSnippetNodes("hello world hello", ["hello"]);
		const div = document.createElement("div");
		div.appendChild(fragment);
		const highlights = div.querySelectorAll(".graph-search-highlight");
		expect(highlights.length).toBe(2);
		expect(highlights[0].textContent).toBe("hello");
		expect(highlights[1].textContent).toBe("hello");
		expect(div.textContent).toBe("hello world hello");
	});

	it("is case insensitive", () => {
		const fragment = buildSnippetNodes("Hello World", ["hello"]);
		const div = document.createElement("div");
		div.appendChild(fragment);
		const highlight = div.querySelector(".graph-search-highlight");
		expect(highlight?.textContent).toBe("Hello");
		expect(div.textContent).toBe("Hello World");
	});

	it("strips # prefix from tag terms", () => {
		const fragment = buildSnippetNodes("meeting notes", ["#meeting"]);
		const div = document.createElement("div");
		div.appendChild(fragment);
		const highlight = div.querySelector(".graph-search-highlight");
		expect(highlight?.textContent).toBe("meeting");
		expect(div.textContent).toBe("meeting notes");
	});
});

describe("findTokenAtCursor", () => {
	it("returns null for empty string", () => {
		expect(findTokenAtCursor("", 0)).toBeNull();
	});

	it("finds token at cursor position", () => {
		const result = findTokenAtCursor("hello world", 7);
		expect(result).toEqual({ start: 6, end: 11, token: "world" });
	});

	it("handles cursor at word boundary", () => {
		const result = findTokenAtCursor("hello world", 5);
		expect(result).toEqual({ start: 0, end: 5, token: "hello" });
	});
});

describe("escapeRegExp", () => {
	it("escapes regex special characters", () => {
		expect(escapeRegExp("a.b*c?d+e[f]g")).toBe("a\\.b\\*c\\?d\\+e\\[f\\]g");
	});

	it("handles string with no special chars", () => {
		expect(escapeRegExp("hello")).toBe("hello");
	});
});
