use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize)]
pub(crate) struct NodeData {
    pub(crate) path: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct NodeInput {
    pub(crate) path: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct EdgeInput {
    pub(crate) from: String,
    pub(crate) to: String,
}

/// Edge type stored in the in-memory graph.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum EdgeKind {
    /// Explicit forward edge from the Obsidian link graph.
    Explicit,
    /// Implicit reverse edge added for traversal convenience.
    Implicit,
}
