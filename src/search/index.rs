use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use super::tokenize::{extract_composite_tokens, tokenize};
use crate::models::CandidateInput;

#[derive(Debug, Deserialize)]
pub(crate) struct SearchDocumentInput {
    pub(crate) title: String,
    pub(crate) path: String,
    pub(crate) body: String,
    #[serde(default)]
    pub(crate) tags: Option<Vec<String>>,
}

#[derive(Debug, Serialize)]
pub(crate) struct SearchStats {
    pub(crate) doc_count: usize,
    pub(crate) token_count: usize,
}

#[derive(Clone, Debug)]
struct SearchDocument {
    title: String,
    path: String,
    tokens: HashSet<String>,
    title_tokens: HashSet<String>,
    body_tokens: HashSet<String>,
    tags: HashSet<String>,
}

pub(crate) struct SearchStore {
    docs: Vec<SearchDocument>,
    index: HashMap<String, Vec<usize>>,
    sorted_tokens: Vec<String>,
    token_count: usize,
}

impl SearchStore {
    pub(crate) fn new() -> Self {
        Self {
            docs: Vec::new(),
            index: HashMap::new(),
            sorted_tokens: Vec::new(),
            token_count: 0,
        }
    }

    pub(crate) fn clear(&mut self) {
        self.docs.clear();
        self.index.clear();
        self.sorted_tokens.clear();
        self.token_count = 0;
    }

    pub(crate) fn build(&mut self, docs: Vec<SearchDocumentInput>) -> SearchStats {
        self.clear();

        for (doc_id, doc) in docs.into_iter().enumerate() {
            let mut tokens = HashSet::new();
            let mut title_tokens = HashSet::new();
            let mut body_tokens = HashSet::new();
            let mut tags = HashSet::new();

            let title_terms = tokenize(&doc.title);
            tokens.extend(title_terms.iter().cloned());
            title_tokens.extend(title_terms);

            let title_composites = extract_composite_tokens(&doc.title);
            tokens.extend(title_composites.iter().cloned());
            title_tokens.extend(title_composites);

            let body_terms = tokenize(&doc.body);
            tokens.extend(body_terms.iter().cloned());
            body_tokens.extend(body_terms);

            let body_composites = extract_composite_tokens(&doc.body);
            tokens.extend(body_composites.iter().cloned());
            body_tokens.extend(body_composites);

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
                title_tokens,
                body_tokens,
                tags,
            };
            self.docs.push(document);

            self.token_count += self.docs[doc_id].tokens.len();
            for token in self.docs[doc_id].tokens.iter().cloned() {
                self.index.entry(token).or_default().push(doc_id);
            }
        }

        self.sorted_tokens = self.index.keys().cloned().collect();
        self.sorted_tokens.sort();

        self.stats()
    }

    pub(crate) fn stats(&self) -> SearchStats {
        SearchStats {
            doc_count: self.docs.len(),
            token_count: self.token_count,
        }
    }

    pub(crate) fn search(&self, query: &str) -> Vec<CandidateInput> {
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
                    title_score: 0.0,
                    body_score: 0.0,
                })
                .collect();
        }

        let mut candidate_ids: Option<HashSet<usize>> = None;
        let mut score_terms: HashSet<String> = HashSet::new();

        for term in terms {
            let cleaned = term.trim_matches('"');
            if cleaned.is_empty() {
                continue;
            }
            let term_lower = cleaned.to_ascii_lowercase();
            let filtered = if let Some(tag) = parse_tag_term(&term_lower) {
                self.filter_by_tag(&tag, candidate_ids.take())
            } else if let Some(path_term) = parse_path_term(&term_lower) {
                self.filter_by_path(&path_term, candidate_ids.take())
            } else {
                score_terms.insert(term_lower.clone());
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
            .map(|doc| {
                let mut title_score = 0.0;
                let mut body_score = 0.0;
                for term in &score_terms {
                    if Self::matches_tokens(&doc.title_tokens, term) {
                        title_score += 1.0;
                    }
                    if Self::matches_tokens(&doc.body_tokens, term) {
                        body_score += 1.0;
                    }
                }
                CandidateInput {
                    title: doc.title.clone(),
                    path: doc.path.clone(),
                    title_score,
                    body_score,
                }
            })
            .collect();

        results.sort_by(|a, b| a.title.cmp(&b.title));
        results
    }

    fn matches_tokens(tokens: &HashSet<String>, term: &str) -> bool {
        if term.is_empty() {
            return false;
        }
        if tokens.contains(term) {
            return true;
        }
        if term.len() < 2 {
            return false;
        }
        tokens.iter().any(|token| token.starts_with(term))
    }

    fn filter_by_token(&self, token: &str, current: Option<HashSet<usize>>) -> HashSet<usize> {
        let postings = self.index.get(token).cloned().unwrap_or_default();
        let postings_set: HashSet<usize> = postings.into_iter().collect();

        let prefix_matches = self.prefix_postings(token);
        let mut matches = postings_set;
        matches.extend(prefix_matches);

        intersect_sets(current, matches)
    }

    fn filter_by_tag(&self, tag: &str, current: Option<HashSet<usize>>) -> HashSet<usize> {
        if let Some(current) = current {
            self.filter_options_by_tag(tag, current.into_iter())
        } else {
            self.filter_options_by_tag(tag, 0..self.docs.len())
        }
    }

    fn filter_options_by_tag(
        &self,
        tag: &str,
        nodes: impl Iterator<Item = usize>,
    ) -> HashSet<usize> {
        nodes
            .into_iter()
            .filter(|id| {
                self.docs
                    .get(*id)
                    .map(|doc| doc.tags.contains(tag))
                    .unwrap_or(false)
            })
            .collect()
    }

    fn filter_by_path(&self, term: &str, current: Option<HashSet<usize>>) -> HashSet<usize> {
        if let Some(current) = current {
            self.filter_options_by_path(term, current.into_iter())
        } else {
            self.filter_options_by_path(term, 0..self.docs.len())
        }
    }

    fn filter_options_by_path(
        &self,
        term: &str,
        nodes: impl Iterator<Item = usize>,
    ) -> HashSet<usize> {
        nodes
            .into_iter()
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
        let start = match self
            .sorted_tokens
            .binary_search_by(|token| token.as_str().cmp(prefix))
        {
            Ok(index) | Err(index) => index,
        };
        for token in self.sorted_tokens.iter().skip(start) {
            if !token.starts_with(prefix) {
                break;
            }
            if let Some(postings) = self.index.get(token) {
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
    if term.starts_with(":tag") {
        let value = term.trim_start_matches(":tag");
        if !value.is_empty() {
            return normalize_tag(value);
        }
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
    if term.starts_with(":path") {
        let value = term.trim_start_matches(":path");
        if !value.is_empty() {
            return Some(value.to_string());
        }
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
    fn search_matches_title_word() {
        let mut store = SearchStore::new();
        store.build(vec![SearchDocumentInput {
            title: "Project Plan".to_string(),
            path: "projects/plan.md".to_string(),
            body: "Body content".to_string(),
            tags: Some(vec![]),
        }]);

        let results = store.search("project");
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].path, "projects/plan.md");
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
    fn search_with_exact_and_prefix_tokens() {
        let mut store = SearchStore::new();
        store.build(vec![
            SearchDocumentInput {
                title: "Iterators".to_string(),
                path: "notes/iterators.md".to_string(),
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

        let results = store.search("iterator");
        let paths: Vec<String> = results.into_iter().map(|r| r.path).collect();
        assert!(paths.contains(&"notes/iterator.md".to_string()));
        assert!(paths.contains(&"notes/iterators.md".to_string()));
    }

    #[test]
    fn search_preserves_prior_term_filtering_with_prefix_matches() {
        let mut store = SearchStore::new();
        store.build(vec![
            SearchDocumentInput {
                title: "Alpha Iterator".to_string(),
                path: "notes/alpha-iterator.md".to_string(),
                body: "".to_string(),
                tags: Some(vec![]),
            },
            SearchDocumentInput {
                title: "Iterators".to_string(),
                path: "notes/iterators.md".to_string(),
                body: "".to_string(),
                tags: Some(vec![]),
            },
        ]);

        let results = store.search("alpha iterator");
        let paths: Vec<String> = results.into_iter().map(|r| r.path).collect();
        assert_eq!(paths, vec!["notes/alpha-iterator.md".to_string()]);
    }

    #[test]
    fn search_matches_composite_tokens() {
        let mut store = SearchStore::new();
        store.build(vec![
            SearchDocumentInput {
                title: "App Host".to_string(),
                path: "notes/app.md".to_string(),
                body: "Visit app.mysite.com for details.".to_string(),
                tags: Some(vec![]),
            },
            SearchDocumentInput {
                title: "Other".to_string(),
                path: "notes/other.md".to_string(),
                body: "No urls here".to_string(),
                tags: Some(vec![]),
            },
        ]);

        let results = store.search("app.mysite.com");
        let paths: Vec<String> = results.into_iter().map(|r| r.path).collect();
        assert_eq!(paths, vec!["notes/app.md".to_string()]);
    }

    #[test]
    fn search_matches_dollar_variable() {
        let mut store = SearchStore::new();
        store.build(vec![SearchDocumentInput {
            title: "Shell Notes".to_string(),
            path: "notes/shell.md".to_string(),
            body: "Export $PATH for scripts.".to_string(),
            tags: Some(vec![]),
        }]);

        let results = store.search("$PATH");
        let paths: Vec<String> = results.into_iter().map(|r| r.path).collect();
        assert_eq!(paths, vec!["notes/shell.md".to_string()]);
    }

    #[test]
    fn search_matches_composite_suffix() {
        let mut store = SearchStore::new();
        store.build(vec![SearchDocumentInput {
            title: "Health Check".to_string(),
            path: "notes/health.md".to_string(),
            body: "See /v1/health:check for the endpoint.".to_string(),
            tags: Some(vec![]),
        }]);

        let results = store.search("health:check");
        let paths: Vec<String> = results.into_iter().map(|r| r.path).collect();
        assert_eq!(paths, vec!["notes/health.md".to_string()]);
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

    #[test]
    fn search_empty_query_returns_all_docs() {
        let store = build_store();
        let results = store.search("");
        assert_eq!(results.len(), 2);
        assert!(results
            .iter()
            .all(|r| r.title_score == 0.0 && r.body_score == 0.0));
    }

    #[test]
    fn search_by_colon_tag_prefix() {
        let store = build_store();
        let results = store.search(":tag#meeting");
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].path, "meetings/budget.md");
    }

    #[test]
    fn search_handles_only_whitespace_query() {
        let store = build_store();
        let results = store.search("   ");
        assert_eq!(results.len(), 2);
        assert!(results
            .iter()
            .all(|r| r.title_score == 0.0 && r.body_score == 0.0));
    }
}
