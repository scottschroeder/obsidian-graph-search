use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::models::CandidateInput;

use super::tokenize::tokenize;

#[derive(Debug, Deserialize)]
pub struct SearchDocumentInput {
    pub title: String,
    pub path: String,
    pub body: String,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Serialize)]
pub struct SearchStats {
    pub doc_count: usize,
    pub token_count: usize,
}

#[derive(Clone, Debug)]
struct SearchDocument {
    title: String,
    path: String,
    tokens: HashSet<String>,
    tags: HashSet<String>,
}

pub struct SearchStore {
    docs: Vec<SearchDocument>,
    index: HashMap<String, Vec<usize>>,
    token_count: usize,
}

impl SearchStore {
    pub fn new() -> Self {
        Self {
            docs: Vec::new(),
            index: HashMap::new(),
            token_count: 0,
        }
    }

    pub fn clear(&mut self) {
        self.docs.clear();
        self.index.clear();
        self.token_count = 0;
    }

    pub fn build(&mut self, docs: Vec<SearchDocumentInput>) -> SearchStats {
        self.clear();

        for (doc_id, doc) in docs.into_iter().enumerate() {
            let mut tokens = HashSet::new();
            let mut tags = HashSet::new();

            for token in tokenize(&doc.title) {
                tokens.insert(token);
            }
            for token in tokenize(&doc.body) {
                tokens.insert(token);
            }

            if let Some(input_tags) = doc.tags {
                for tag in input_tags {
                    if let Some(normalized) = normalize_tag(&tag) {
                        tags.insert(normalized);
                    }
                }
            }

            let document = SearchDocument {
                title: doc.title,
                path: doc.path,
                tokens,
                tags,
            };
            self.docs.push(document);

            let tokens_snapshot: Vec<String> = self.docs[doc_id].tokens.iter().cloned().collect();
            self.token_count += tokens_snapshot.len();
            for token in tokens_snapshot {
                self.index.entry(token).or_default().push(doc_id);
            }
        }

        self.stats()
    }

    pub fn stats(&self) -> SearchStats {
        SearchStats {
            doc_count: self.docs.len(),
            token_count: self.token_count,
        }
    }

    pub fn search(&self, query: &str) -> Vec<CandidateInput> {
        let terms = query
            .split_whitespace()
            .filter(|term| !term.is_empty())
            .collect::<Vec<_>>();

        if terms.is_empty() {
            return self
                .docs
                .iter()
                .map(|doc| CandidateInput {
                    title: doc.title.clone(),
                    path: doc.path.clone(),
                })
                .collect();
        }

        let mut candidate_ids: Option<HashSet<usize>> = None;

        for term in terms {
            let term_lower = term.to_ascii_lowercase();
            let filtered = if let Some(tag) = parse_tag_term(&term_lower) {
                self.filter_by_tag(&tag, candidate_ids.take())
            } else if let Some(path_term) = parse_path_term(&term_lower) {
                self.filter_by_path(&path_term, candidate_ids.take())
            } else {
                self.filter_by_token(&term_lower, candidate_ids.take())
            };

            if filtered.is_empty() {
                return Vec::new();
            }
            candidate_ids = Some(filtered);
        }

        let mut results: Vec<CandidateInput> = candidate_ids
            .unwrap_or_default()
            .into_iter()
            .filter_map(|id| self.docs.get(id))
            .map(|doc| CandidateInput {
                title: doc.title.clone(),
                path: doc.path.clone(),
            })
            .collect();

        results.sort_by(|a, b| a.title.cmp(&b.title));
        results
    }

    fn filter_by_token(&self, token: &str, current: Option<HashSet<usize>>) -> HashSet<usize> {
        let postings = self.index.get(token).cloned().unwrap_or_default();
        let postings_set: HashSet<usize> = postings.into_iter().collect();
        if !postings_set.is_empty() {
            return intersect_sets(current, postings_set);
        }

        let prefix_matches = self.prefix_postings(token);
        intersect_sets(current, prefix_matches)
    }

    fn filter_by_tag(&self, tag: &str, current: Option<HashSet<usize>>) -> HashSet<usize> {
        let base = current.unwrap_or_else(|| (0..self.docs.len()).collect());
        base.into_iter()
            .filter(|id| {
                self.docs
                    .get(*id)
                    .map(|doc| doc.tags.contains(tag))
                    .unwrap_or(false)
            })
            .collect()
    }

    fn filter_by_path(&self, term: &str, current: Option<HashSet<usize>>) -> HashSet<usize> {
        let base = current.unwrap_or_else(|| (0..self.docs.len()).collect());
        base.into_iter()
            .filter(|id| {
                self.docs
                    .get(*id)
                    .map(|doc| doc.path.to_ascii_lowercase().contains(term))
                    .unwrap_or(false)
            })
            .collect()
    }

    fn prefix_postings(&self, prefix: &str) -> HashSet<usize> {
        if prefix.len() < 2 {
            return HashSet::new();
        }
        let mut results = HashSet::new();
        for (token, postings) in &self.index {
            if token.starts_with(prefix) {
                results.extend(postings.iter().copied());
            }
        }
        results
    }
}

fn intersect_sets(current: Option<HashSet<usize>>, next: HashSet<usize>) -> HashSet<usize> {
    if let Some(existing) = current {
        existing.intersection(&next).copied().collect()
    } else {
        next
    }
}

fn parse_tag_term(term: &str) -> Option<String> {
    if term.starts_with("tag:") {
        let value = term.trim_start_matches("tag:");
        return normalize_tag(value);
    }
    if term.starts_with('#') && term.len() > 1 {
        return normalize_tag(term);
    }
    None
}

fn normalize_tag(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    let normalized = if trimmed.starts_with('#') {
        trimmed.to_string()
    } else {
        format!("#{}", trimmed)
    };
    let lowered = normalized.to_ascii_lowercase();
    if lowered.len() <= 1 {
        None
    } else {
        Some(lowered)
    }
}

fn parse_path_term(term: &str) -> Option<String> {
    if term.starts_with("path:") {
        return Some(term.trim_start_matches("path:").to_string());
    }
    if term.starts_with("file:") {
        return Some(term.trim_start_matches("file:").to_string());
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn build_store() -> SearchStore {
        let mut store = SearchStore::new();
        store.build(vec![
            SearchDocumentInput {
                title: "Budget Meeting".to_string(),
                path: "meetings/budget.md".to_string(),
                body: "Agenda for #meeting budget review".to_string(),
                tags: Some(vec!["#meeting".to_string()]),
            },
            SearchDocumentInput {
                title: "Project Plan".to_string(),
                path: "projects/plan.md".to_string(),
                body: "#project plan scope".to_string(),
                tags: Some(vec!["#project".to_string()]),
            },
        ]);
        store
    }

    #[test]
    fn search_by_token() {
        let store = build_store();
        let results = store.search("budget");
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].path, "meetings/budget.md");
    }

    #[test]
    fn search_by_tag() {
        let store = build_store();
        let results = store.search("tag:meeting");
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].path, "meetings/budget.md");
    }

    #[test]
    fn search_by_path_term() {
        let store = build_store();
        let results = store.search("path:projects");
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].path, "projects/plan.md");
    }

    #[test]
    fn search_prefix_matches_tokens() {
        let mut store = SearchStore::new();
        store.build(vec![
            SearchDocumentInput {
                title: "Iterate".to_string(),
                path: "notes/iterate.md".to_string(),
                body: "".to_string(),
                tags: Some(vec![]),
            },
            SearchDocumentInput {
                title: "Iterator".to_string(),
                path: "notes/iterator.md".to_string(),
                body: "".to_string(),
                tags: Some(vec![]),
            },
        ]);

        let results = store.search("iterat");
        let paths: Vec<String> = results.into_iter().map(|r| r.path).collect();
        assert!(paths.contains(&"notes/iterate.md".to_string()));
        assert!(paths.contains(&"notes/iterator.md".to_string()));
    }

    #[test]
    fn tag_search_ignores_plain_text() {
        let mut store = SearchStore::new();
        store.build(vec![
            SearchDocumentInput {
                title: "Log Note".to_string(),
                path: "logs/note.md".to_string(),
                body: "log/incident timeline".to_string(),
                tags: Some(vec![]),
            },
            SearchDocumentInput {
                title: "Tagged Note".to_string(),
                path: "logs/tagged.md".to_string(),
                body: "".to_string(),
                tags: Some(vec!["log/incident".to_string()]),
            },
        ]);

        let results = store.search("tag:log/incident");
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].path, "logs/tagged.md");
    }
}
