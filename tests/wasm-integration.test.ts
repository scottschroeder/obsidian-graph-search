import { readFileSync } from "node:fs";
import * as path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { initSync } from "../pkg/obsidian_rust_plugin.js";
import * as wasm from "../pkg/obsidian_rust_plugin.js";

beforeAll(() => {
	const wasmPath = path.resolve(
		process.cwd(),
		"pkg/obsidian_rust_plugin_bg.wasm",
	);
	const bytes = readFileSync(wasmPath);
	initSync({ module: bytes });
});

describe("wasm integration", () => {
	it("queries and ranks from atoms", () => {
		const stats = wasm.search_index([
			{
				title: "Budget Meeting",
				path: "meetings/budget.md",
				body: "Agenda for #meeting budget review",
				tags: ["#meeting"],
			},
			{
				title: "Project Plan",
				path: "projects/plan.md",
				body: "#project plan scope",
				tags: ["#project"],
			},
		]);
		expect(stats).toBeNull();
		const graphStats = wasm.graph_init(
			[{ path: "meetings/budget.md" }, { path: "projects/plan.md" }],
			[{ from: "meetings/budget.md", to: "projects/plan.md" }],
		);
		expect(graphStats).toBeNull();

		const result = wasm.graph_query_from_atoms(
			[
				{ kind: "term", value: "budget" },
				{ kind: "whitespace", value: " " },
				{ kind: "near", value: "meetings/budget.md" },
				{ kind: "tag", value: "#meeting" },
			],
			{
				distance_weight: 1,
				title_weight: 1,
				body_weight: 1,
				distance_falloff: 0.5,
				connection_strength: 0,
				distance_curve: "exponential",
			},
		);
		expect(result.candidate_count).toBe(1);
		expect(result.near_titles).toEqual(["meetings/budget.md"]);
		expect(result.results.length).toBe(1);
		expect(result.results[0].path).toBe("meetings/budget.md");
	});

	it("uses graph proximity when near atoms are provided", () => {
		wasm.search_index([
			{
				title: "alpha",
				path: "alpha.md",
				body: "alpha body",
			},
			{
				title: "beta",
				path: "beta.md",
				body: "beta body",
			},
		]);
		const graphStats = wasm.graph_init(
			[{ path: "alpha.md" }, { path: "beta.md" }],
			[{ from: "alpha.md", to: "beta.md" }],
		);
		expect(graphStats).toBeNull();
		const result = wasm.graph_query_from_atoms(
			[{ kind: "near", value: "alpha.md" }],
			{
				distance_weight: 1,
				title_weight: 1,
				body_weight: 1,
				distance_falloff: 0.5,
				connection_strength: 0,
				distance_curve: "exponential",
			},
		);
		const distances = new Map(
			result.results.map(
				(entry: { path: string; distance_sum: number }) => [
					entry.path,
					entry.distance_sum,
				],
			),
		);
		expect(distances.get("alpha.md")).toBeCloseTo(0, 5);
		expect(distances.get("beta.md")).toBeCloseTo(1, 5);
	});
});
