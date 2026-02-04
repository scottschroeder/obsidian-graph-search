import { describe, expect, it } from "vitest";

import { collectFrontmatterTags, splitTagString } from "../ui/tag-utils";

describe("splitTagString", () => {
	it("splits on comma", () => {
		expect(splitTagString("tag1,tag2,tag3")).toEqual([
			"tag1",
			"tag2",
			"tag3",
		]);
	});

	it("splits on whitespace when no comma", () => {
		expect(splitTagString("tag1 tag2 tag3")).toEqual([
			"tag1",
			"tag2",
			"tag3",
		]);
	});

	it("handles mixed comma and whitespace", () => {
		expect(splitTagString("tag1,tag2 still part,tag3")).toEqual([
			"tag1",
			"tag2 still part",
			"tag3",
		]);
	});
});

describe("collectFrontmatterTags", () => {
	it("returns array from string", () => {
		expect(collectFrontmatterTags("single-tag")).toEqual(["single-tag"]);
	});

	it("returns array from array", () => {
		expect(collectFrontmatterTags(["tag1", "tag2"])).toEqual([
			"tag1",
			"tag2",
		]);
	});

	it("returns empty for other types", () => {
		expect(collectFrontmatterTags(undefined)).toEqual([]);
		expect(collectFrontmatterTags(null)).toEqual([]);
		expect(collectFrontmatterTags(123)).toEqual([]);
		expect(collectFrontmatterTags({ key: "value" })).toEqual([]);
	});
});
