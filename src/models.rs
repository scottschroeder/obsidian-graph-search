use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, Serialize)]
pub(crate) struct CandidateInput {
    pub(crate) title: String,
    pub(crate) path: String,
    pub(crate) title_score: f32,
    pub(crate) body_score: f32,
}
