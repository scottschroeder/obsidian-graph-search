use std::cell::RefCell;

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

#[wasm_bindgen]
pub fn graph_init(nodes: JsValue, edges: JsValue) -> Result<JsValue, JsValue> {
    let nodes: Vec<NodeInput> = swb::from_value(nodes)?;
    let edges: Vec<EdgeInput> = swb::from_value(edges)?;

    let stats = GRAPH.with(|store| store.borrow_mut().build(nodes, edges));
    swb::to_value(&stats).map_err(|err| err.into())
}

#[wasm_bindgen]
pub fn search_index(docs: JsValue) -> Result<JsValue, JsValue> {
    let docs: Vec<SearchDocumentInput> = swb::from_value(docs)?;
    let stats = SEARCH.with(|store| store.borrow_mut().build(docs));
    swb::to_value(&stats).map_err(|err| err.into())
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
    let candidate_count = candidates.len();
    let near_titles = parsed.near_titles.clone();
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
