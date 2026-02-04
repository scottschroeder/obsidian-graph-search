import type { ScoredCandidate } from "../types";
import { buildSnippet, buildSnippetNodes } from "../snippet-utils";
import type { GraphSearchPluginApi } from "./plugin-api";

type ObsidianHTMLElement = HTMLElement & {
	empty(): void;
	setText(text: string): void;
	show(): void;
	hide(): void;
	createEl(
		tag: string,
		options?: { text?: string; cls?: string },
	): HTMLElement;
	createDiv(options?: { cls?: string; text?: string }): HTMLDivElement;
};

type ResultsRendererOptions = {
	resultsEl: ObsidianHTMLElement;
	statusEl: ObsidianHTMLElement;
	plugin: GraphSearchPluginApi;
	maxResults: number;
	onSelectIndex: (index: number) => void;
};

export class GraphResultsRenderer {
	private resultsEl: ObsidianHTMLElement;
	private statusEl: ObsidianHTMLElement;
	private plugin: GraphSearchPluginApi;
	private maxResults: number;
	private onSelectIndex: ResultsRendererOptions["onSelectIndex"];

	constructor(options: ResultsRendererOptions) {
		this.resultsEl = options.resultsEl;
		this.statusEl = options.statusEl;
		this.plugin = options.plugin;
		this.maxResults = options.maxResults;
		this.onSelectIndex = options.onSelectIndex;
	}

	render(
		results: ScoredCandidate[],
		candidateCount: number,
		nearTitles: string[],
		selectedIndex: number,
		searchTerms: string[],
	) {
		this.resultsEl.empty();
		const showDebug = this.plugin.isDebugMode();
		if (showDebug) {
			this.statusEl.setText(
				`Candidates: ${candidateCount}, Near: ${nearTitles.length}, Results: ${results.length}`,
			);
			this.statusEl.show();
		} else {
			this.statusEl.setText("");
			this.statusEl.hide();
		}

		if (results.length === 0) {
			this.resultsEl.createEl("div", { text: "No results." });
			return;
		}

		const list = this.resultsEl.createDiv();
		const weights = showDebug ? this.plugin.getScoreWeights() : null;
		results.slice(0, this.maxResults).forEach((entry, index) => {
			const item = list.createDiv({ cls: "suggestion-item" });
			item.addClass("graph-search-result");
			if (index === selectedIndex) {
				item.addClass("is-selected");
			}
			const titleRow = item.createDiv({ cls: "graph-search-title" });
			titleRow.setText(this.plugin.getDisplayTitle(entry.path));
			const pathRow = item.createDiv({ cls: "graph-search-path" });
			pathRow.setText(entry.path);

			const body = this.plugin.getSearchContent(entry.path);
			const snippet = buildSnippet(body, searchTerms);
			if (snippet) {
				const snippetEl = item.createDiv({
					cls: "graph-search-snippet",
				});
				snippetEl.appendChild(buildSnippetNodes(snippet, searchTerms));
			}
			if (showDebug && weights) {
				const weightedDistance =
					entry.distance_score * weights.distance_weight;
				const weightedTitle = entry.title_score * weights.title_weight;
				const weightedBody = entry.body_score * weights.body_weight;
				const debugRow = item.createDiv({
					cls: "graph-search-snippet",
				});
				debugRow.setText(
					`distance ${entry.distance_score.toFixed(2)} (${weightedDistance.toFixed(2)}), title ${entry.title_score.toFixed(2)} (${weightedTitle.toFixed(2)}), body ${entry.body_score.toFixed(2)} (${weightedBody.toFixed(2)}), total ${entry.total_score.toFixed(2)}`,
				);
			}

			const scoreBadge = item.createDiv({
				cls: "graph-search-score-badge",
			});
			scoreBadge.setText(entry.total_score.toFixed(2));

			item.addEventListener("click", () => {
				this.onSelectIndex(index);
			});
		});
		const selected = list.querySelector(".is-selected");
		if (selected instanceof HTMLElement) {
			selected.scrollIntoView({ block: "nearest" });
		}
	}
}
