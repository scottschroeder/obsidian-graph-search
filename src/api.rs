use std::cell::RefCell;

use serde_wasm_bindgen as swb;
use wasm_bindgen::prelude::*;

use crate::{
    graph::{
        model::{EdgeInput, NodeInput},
        store::{GraphStore, ScoreWeights, ScoredCandidate},
    },
    models::CandidateInput,
    query,
    search::{SearchDocumentInput, SearchStore},
};

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
pub fn parse_query_atoms(atoms: JsValue) -> Result<JsValue, JsValue> {
    let atoms: Vec<query::QueryAtom> = swb::from_value(atoms)?;
    let parsed = query::parse_query_atoms(&atoms);
    swb::to_value(&parsed).map_err(|err| err.into())
}

#[wasm_bindgen]
pub fn graph_rank_candidates(
    near_titles: JsValue,
    candidates: JsValue,
    weights: JsValue,
) -> Result<JsValue, JsValue> {
    let near_titles: Vec<String> = swb::from_value(near_titles)?;
    let candidates: Vec<CandidateInput> = swb::from_value(candidates)?;
    let weights: ScoreWeights = swb::from_value(weights)?;
    let ranked: Vec<ScoredCandidate> = GRAPH.with(|store| {
        store
            .borrow()
            .rank_candidates(near_titles, candidates, weights)
    });
    swb::to_value(&ranked).map_err(|err| err.into())
}

#[wasm_bindgen]
pub fn search_index(docs: JsValue) -> Result<JsValue, JsValue> {
    let docs: Vec<SearchDocumentInput> = swb::from_value(docs)?;
    let stats = SEARCH.with(|store| store.borrow_mut().build(docs));
    swb::to_value(&stats).map_err(|err| err.into())
}

#[wasm_bindgen]
pub fn search_candidates(base_query: String) -> Result<JsValue, JsValue> {
    let results: Vec<CandidateInput> = SEARCH.with(|store| store.borrow().search(&base_query));
    swb::to_value(&results).map_err(|err| err.into())
}

#[wasm_bindgen]
pub fn cleanup_all() -> Result<JsValue, JsValue> {
    GRAPH.with(|store| store.borrow_mut().clear());
    SEARCH.with(|store| store.borrow_mut().clear());
    Ok(JsValue::NULL)
}
