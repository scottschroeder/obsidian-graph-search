use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize)]
pub(crate) struct NodeData {
    pub(crate) title: String, // REVIEW: do we need this `title here?
    pub(crate) path: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct NodeInput {
    pub(crate) title: String, // REVIEW: do we need the `title` here at all?
    pub(crate) path: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct EdgeInput {
    pub(crate) from: String,
    pub(crate) to: String,
}
