export type GraphStats = {
	node_count: number;
	edge_count: number;
};

export type ParsedQuery = {
	near_titles: string[];
	base_query: string;
};

export type CandidateInput = {
	title: string;
	path: string;
	title_score: number;
	body_score: number;
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

export type ScoreWeights = {
	distance_weight: number;
	title_weight: number;
	body_weight: number;
	distance_falloff: number;
};

export type SearchDocumentInput = {
	title: string;
	path: string;
	body: string;
	tags?: string[];
};

export type SearchStats = {
	doc_count: number;
	token_count: number;
};

export type DistanceEntry = {
	title: string;
	path: string;
	distance: number | null;
};
