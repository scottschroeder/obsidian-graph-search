use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, Serialize)]
pub struct CandidateInput {
    pub title: String,
    pub path: String,
}
