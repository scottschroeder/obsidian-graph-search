export type QueryAtomKind = "term" | "near" | "tag" | "path" | "whitespace";

export type QueryAtom = {
	kind: QueryAtomKind;
	value: string;
	display?: string;
};

export type ScoredCandidate = {
	title: string;
	path: string;
	distance_sum: number;
	distance_score: number;
	title_score: number;
	body_score: number;
	total_score: number;
};

export type GraphQueryResult = {
	results: ScoredCandidate[];
	candidate_count: number;
	near_titles: string[];
};

export type ScoreWeights = {
	distance_weight: number;
	title_weight: number;
	body_weight: number;
	distance_falloff: number;
	connection_strength: number;
	distance_curve: string;
};

export type SearchDocumentInput = {
	title: string;
	path: string;
	body: string;
	tags?: string[];
};

export type DistanceEntry = {
	title: string;
	path: string;
	distance: number | null;
};
