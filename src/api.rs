use std::cell::RefCell;

use serde_wasm_bindgen as swb;
use wasm_bindgen::prelude::*;

use crate::graph::model::{EdgeInput, NodeInput};
use crate::graph::store::{DistanceEntry, GraphStore, ScoreWeights, ScoredCandidate};
use crate::models::CandidateInput;
use crate::query;
use crate::search::{SearchDocumentInput, SearchStore};

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
pub fn graph_stats() -> Result<JsValue, JsValue> {
    let stats = GRAPH.with(|store| store.borrow().stats());
    swb::to_value(&stats).map_err(|err| err.into())
}

#[wasm_bindgen]
pub fn graph_distances_from_title(title: String) -> Result<JsValue, JsValue> {
    let entries: Vec<DistanceEntry> =
        GRAPH.with(|store| store.borrow().distances_from_title(&title));
    swb::to_value(&entries).map_err(|err| err.into())
}

#[wasm_bindgen]
pub fn parse_query(raw: String) -> Result<JsValue, JsValue> {
    let parsed = query::parse_query(&raw);
    swb::to_value(&parsed).map_err(|err| err.into())
}

#[wasm_bindgen]
pub fn parse_query_layout(raw: String) -> Result<JsValue, JsValue> {
    let layout = query::parse_query_layout(&raw);
    swb::to_value(&layout).map_err(|err| err.into())
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
pub fn graph_debug_dump() -> Result<JsValue, JsValue> {
    let dump = GRAPH.with(|store| store.borrow().debug_dump(200, 200));
    Ok(JsValue::from_str(&dump))
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
