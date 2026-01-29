use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize)]
pub struct NodeData {
    pub title: String,
    pub path: String,
}

#[derive(Debug, Deserialize)]
pub struct NodeInput {
    pub title: String,
    pub path: String,
}

#[derive(Debug, Deserialize)]
pub struct EdgeInput {
    pub from: String,
    pub to: String,
}
