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
