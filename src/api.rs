use std::{cell::RefCell, collections::HashSet};

use serde::Serialize;
use serde_wasm_bindgen as swb;
use wasm_bindgen::prelude::*;

use crate::{
    graph::{
        model::{EdgeInput, NodeInput},
        store::{GraphStore, ScoreWeights, ScoredCandidate},
    },
    query,
    search::{SearchDocumentInput, SearchStore},
};

#[derive(Debug, Serialize)]
struct GraphQueryResult {
    results: Vec<ScoredCandidate>,
    candidate_count: usize,
    near_titles: Vec<String>,
}

// Global WASM-side singletons to avoid re-allocating stores per call.
// In the JS/WASM environment, these thread-local stores live for the lifetime
// of the WASM module instance. That means the data persists across multiple
// JS invocations within the same plugin session, and is reset only when the
// module is reloaded (plugin reload, page refresh, or explicit cleanup).
thread_local! {
    static GRAPH: RefCell<GraphStore> = RefCell::new(GraphStore::new());
    static SEARCH: RefCell<SearchStore> = RefCell::new(SearchStore::new());
}

fn filter_out_near_candidates(
    candidates: Vec<crate::models::CandidateInput>,
    near_titles: &[String],
) -> Vec<crate::models::CandidateInput> {
    if near_titles.is_empty() {
        return candidates;
    }

    let excluded: HashSet<&str> = near_titles.iter().map(String::as_str).collect();
    candidates
        .into_iter()
        .filter(|candidate| !excluded.contains(candidate.path.as_str()))
        .collect()
}

#[wasm_bindgen]
pub fn graph_init(nodes: JsValue, edges: JsValue) -> Result<JsValue, JsValue> {
    let nodes: Vec<NodeInput> = swb::from_value(nodes)?;
    let edges: Vec<EdgeInput> = swb::from_value(edges)?;

    GRAPH.with(|store| store.borrow_mut().build(nodes, edges));
    Ok(JsValue::NULL)
}

#[wasm_bindgen]
pub fn search_index(docs: JsValue) -> Result<JsValue, JsValue> {
    let docs: Vec<SearchDocumentInput> = swb::from_value(docs)?;
    SEARCH.with(|store| store.borrow_mut().build(docs));
    Ok(JsValue::NULL)
}

#[wasm_bindgen]
pub fn graph_query_from_atoms(atoms: JsValue, weights: JsValue) -> Result<JsValue, JsValue> {
    let atoms: Vec<query::QueryAtom> = swb::from_value(atoms)?;
    let weights: ScoreWeights = swb::from_value(weights)?;
    let parsed = query::partition_atoms(&atoms);

    let candidates = SEARCH.with(|store| {
        store
            .borrow()
            .search_structured(&parsed.terms, &parsed.tags, &parsed.paths)
    });
    let near_titles = parsed.near_titles.clone();
    let candidates = filter_out_near_candidates(candidates, &near_titles);
    let candidate_count = candidates.len();
    let ranked: Vec<ScoredCandidate> = GRAPH.with(|store| {
        store
            .borrow()
            .rank_candidates(parsed.near_titles, candidates, weights)
    });

    let result = GraphQueryResult {
        results: ranked,
        candidate_count,
        near_titles,
    };
    swb::to_value(&result).map_err(|err| err.into())
}

#[wasm_bindgen]
pub fn cleanup_all() -> Result<JsValue, JsValue> {
    GRAPH.with(|store| store.borrow_mut().clear());
    SEARCH.with(|store| store.borrow_mut().clear());
    Ok(JsValue::NULL)
}

#[cfg(test)]
mod tests {
    use super::filter_out_near_candidates;
    use crate::models::CandidateInput;

    #[test]
    fn filter_out_near_candidates_excludes_matching_paths() {
        let candidates = vec![
            CandidateInput {
                title: "alpha".to_string(),
                path: "alpha.md".to_string(),
                title_score: 1.0,
                body_score: 0.0,
            },
            CandidateInput {
                title: "beta".to_string(),
                path: "beta.md".to_string(),
                title_score: 0.5,
                body_score: 0.5,
            },
        ];

        let filtered = filter_out_near_candidates(candidates, &["alpha.md".to_string()]);

        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].path, "beta.md");
    }

    #[test]
    fn filter_out_near_candidates_keeps_candidates_without_matches() {
        let candidates = vec![CandidateInput {
            title: "alpha".to_string(),
            path: "alpha.md".to_string(),
            title_score: 1.0,
            body_score: 0.0,
        }];

        let filtered = filter_out_near_candidates(candidates, &["beta.md".to_string()]);

        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].path, "alpha.md");
    }
}
