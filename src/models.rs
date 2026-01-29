use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, Serialize)]
pub struct CandidateInput {
    pub title: String,
    pub path: String,
    pub title_score: f32,
    pub body_score: f32,
}
