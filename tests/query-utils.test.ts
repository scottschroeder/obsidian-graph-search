import escapeHtml from "escape-html";
import { describe, expect, it } from "vitest";

import type { QueryAtom } from "../src/ui/types";

import {
	buildRawFromAtoms,
	displayLengthForAtom,
	displayLengthForAtoms,
	findTokenAtCursor,
	offsetForAtom,
	stripMdExtension,
} from "../src/ui/query-utils";
import {
	buildEditableHtmlFromAtoms,
	buildSnippet,
	escapeRegExp,
	highlightSnippet,
} from "../src/ui/html-utils";
import {
	extractAtomsFromEditable,
	extractRawFromEditable,
	getCaretOffset,
	restoreCaretOffset,
} from "../src/ui/editable-dom";

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

	it("clamps caret offset inside chip", () => {
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
		const insideChipOffset = 3;
		restoreCaretOffset(div, insideChipOffset);
		const caret = getCaretOffset(div);
		expect(caret).toBe(atoms[0].value.length);
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
		expect(snippet).toContain("graph-search-highlight");
	});

	it("handles match at start of body", () => {
		const snippet = buildSnippet("target is at the start", ["target"]);
		expect(snippet).toContain("target");
		expect(snippet).toContain("graph-search-highlight");
	});

	it("handles match at end of body", () => {
		const body = "prefix ".repeat(30) + "target";
		const snippet = buildSnippet(body, ["target"]);
		expect(snippet).toContain("target");
		expect(snippet).toContain("graph-search-highlight");
	});
});

describe("highlightSnippet", () => {
	it("wraps matching terms in highlight span", () => {
		const result = highlightSnippet("hello world", ["world"]);
		expect(result).toBe(
			'hello <span class="graph-search-highlight">world</span>',
		);
	});

	it("handles multiple term matches", () => {
		const result = highlightSnippet("hello world hello", ["hello"]);
		expect(result).toBe(
			'<span class="graph-search-highlight">hello</span> world <span class="graph-search-highlight">hello</span>',
		);
	});

	it("is case insensitive", () => {
		const result = highlightSnippet("Hello World", ["hello"]);
		expect(result).toBe(
			'<span class="graph-search-highlight">Hello</span> World',
		);
	});

	it("strips # prefix from tag terms", () => {
		const result = highlightSnippet("meeting notes", ["#meeting"]);
		expect(result).toBe(
			'<span class="graph-search-highlight">meeting</span> notes',
		);
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

describe("escapeHtml", () => {
	it("escapes < > & \" '", () => {
		expect(escapeHtml('<div class="test">&\'>')).toBe(
			"&lt;div class=&quot;test&quot;&gt;&amp;&#39;&gt;",
		);
	});

	it("handles empty string", () => {
		expect(escapeHtml("")).toBe("");
	});

	it("handles string with no special chars", () => {
		expect(escapeHtml("hello world")).toBe("hello world");
	});

	it("escapes HTML special characters", () => {
		expect(escapeHtml("<script>")).toBe("&lt;script&gt;");
		expect(escapeHtml('attr="val"')).toBe("attr=&quot;val&quot;");
		expect(escapeHtml("a & b")).toBe("a &amp; b");
		expect(escapeHtml("it's")).toBe("it&#39;s");
	});

	it("handles combined attack vectors", () => {
		expect(escapeHtml('<img onerror="alert(1)">')).toBe(
			"&lt;img onerror=&quot;alert(1)&quot;&gt;",
		);
	});

	it("preserves safe characters", () => {
		expect(escapeHtml("Hello World 123!@#$%")).toBe("Hello World 123!@#$%");
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
