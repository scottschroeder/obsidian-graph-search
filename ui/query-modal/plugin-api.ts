import type { ScoreWeights } from "../types";

export type GraphSearchPluginApi = {
	buildGraphIndex(): Promise<void>;
	buildSearchIndex(): Promise<void>;
	clearIndexes(): void;
	clearActiveModal(): void;
	getSearchContent(path: string): string;
	getDisplayTitle(path: string): string;
	getScoreWeights(): ScoreWeights;
	isDebugMode(): boolean;
};
