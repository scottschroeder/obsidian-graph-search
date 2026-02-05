use std::collections::{HashMap, HashSet};

use serde::Deserialize;

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

#[derive(Clone, Debug)]
struct SearchDocument {
    title: String,
    path: String,
    title_tokens: HashSet<String>,
    body_tokens: HashSet<String>,
    tags: HashSet<String>,
}

pub(crate) struct SearchStore {
    docs: Vec<SearchDocument>,
    index: HashMap<String, Vec<usize>>,
    sorted_tokens: Vec<String>,
}

impl SearchStore {
    pub(crate) fn new() -> Self {
        Self {
            docs: Vec::new(),
            index: HashMap::new(),
            sorted_tokens: Vec::new(),
        }
    }

    pub(crate) fn clear(&mut self) {
        self.docs.clear();
        self.index.clear();
        self.sorted_tokens.clear();
    }

    pub(crate) fn build(&mut self, docs: Vec<SearchDocumentInput>) {
        self.clear();

        for (doc_id, doc) in docs.into_iter().enumerate() {
            let mut title_tokens = HashSet::new();
            let mut body_tokens = HashSet::new();
            let mut tags = HashSet::new();

            title_tokens.extend(tokenize(&doc.title));
            title_tokens.extend(extract_composite_tokens(&doc.title));
            body_tokens.extend(tokenize(&doc.body));
            body_tokens.extend(extract_composite_tokens(&doc.body));

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
                title_tokens,
                body_tokens,
                tags,
            };
            self.docs.push(document);

            for token in self.docs[doc_id].title_tokens.iter().cloned() {
                let postings = self.index.entry(token).or_default();
                if postings.last().copied() != Some(doc_id) {
                    postings.push(doc_id);
                }
            }

            for token in self.docs[doc_id].body_tokens.iter().cloned() {
                let postings = self.index.entry(token).or_default();
                if postings.last().copied() != Some(doc_id) {
                    postings.push(doc_id);
                }
            }
        }

        self.sorted_tokens = self.index.keys().cloned().collect();
        self.sorted_tokens.sort();
    }

    pub(crate) fn search_structured(
        &self,
        terms: &[String],
        tags: &[String],
        paths: &[String],
    ) -> Vec<CandidateInput> {
        if terms.is_empty() && tags.is_empty() && paths.is_empty() {
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

        for tag in tags {
            let cleaned = tag.trim().trim_matches('"');
            if cleaned.is_empty() {
                continue;
            }
            let Some(normalized) = normalize_tag(cleaned) else {
                continue;
            };
            let filtered = self.filter_by_tag(&normalized, candidate_ids.take());
            if filtered.is_empty() {
                return Vec::new();
            }
            candidate_ids = Some(filtered);
        }

        for path in paths {
            let cleaned = path.trim().trim_matches('"');
            if cleaned.is_empty() {
                continue;
            }
            let term_lower = cleaned.to_ascii_lowercase();
            let filtered = self.filter_by_path(&term_lower, candidate_ids.take());
            if filtered.is_empty() {
                return Vec::new();
            }
            candidate_ids = Some(filtered);
        }

        for term in terms {
            let cleaned = term.trim().trim_matches('"');
            if cleaned.is_empty() {
                continue;
            }
            let term_lower = cleaned.to_ascii_lowercase();
            score_terms.insert(term_lower.clone());
            let filtered = self.filter_by_token(&term_lower, candidate_ids.take());
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

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

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
        let results = store.search_structured(&["budget".to_string()], &[], &[]);
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

        let results = store.search_structured(&["project".to_string()], &[], &[]);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].path, "projects/plan.md");
    }

    #[test]
    fn search_by_tag() {
        let store = build_store();
        let results = store.search_structured(&[], &["meeting".to_string()], &[]);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].path, "meetings/budget.md");
    }

    #[test]
    fn search_by_path_term() {
        let store = build_store();
        let results = store.search_structured(&[], &[], &["projects".to_string()]);
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

        let results = store.search_structured(&["iterat".to_string()], &[], &[]);
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

        let results = store.search_structured(&["iterator".to_string()], &[], &[]);
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

        let results =
            store.search_structured(&["alpha".to_string(), "iterator".to_string()], &[], &[]);
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

        let results = store.search_structured(&["app.mysite.com".to_string()], &[], &[]);
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

        let results = store.search_structured(&["$PATH".to_string()], &[], &[]);
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

        let results = store.search_structured(&["health:check".to_string()], &[], &[]);
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

        let results = store.search_structured(&[], &["log/incident".to_string()], &[]);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].path, "logs/tagged.md");
    }

    #[test]
    fn search_empty_query_returns_all_docs() {
        let store = build_store();
        let results = store.search_structured(&[], &[], &[]);
        assert_eq!(results.len(), 2);
        assert!(results
            .iter()
            .all(|r| r.title_score == 0.0 && r.body_score == 0.0));
    }

    #[test]
    fn search_by_hash_tag() {
        let store = build_store();
        let results = store.search_structured(&[], &["#meeting".to_string()], &[]);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].path, "meetings/budget.md");
    }

    #[test]
    fn search_handles_only_whitespace_query() {
        let store = build_store();
        let results = store.search_structured(&[], &[], &[]);
        assert_eq!(results.len(), 2);
        assert!(results
            .iter()
            .all(|r| r.title_score == 0.0 && r.body_score == 0.0));
    }

    #[test]
    fn filter_by_tag_with_current_candidates() {
        let store = build_store();
        let current: HashSet<usize> = std::iter::once(0usize).collect();

        let matches = store.filter_by_tag("#meeting", Some(current));
        let expected: HashSet<usize> = std::iter::once(0usize).collect();
        assert_eq!(matches, expected);
    }

    #[test]
    fn filter_by_path_with_current_candidates() {
        let store = build_store();
        let current: HashSet<usize> = std::iter::once(0usize).collect();

        let matches = store.filter_by_path("projects", Some(current));
        assert!(matches.is_empty());

        let matches = store.filter_by_path("projects", None);
        let expected: HashSet<usize> = std::iter::once(1usize).collect();
        assert_eq!(matches, expected);
    }

    #[test]
    fn index_dedupes_title_and_body_tokens() {
        let mut store = SearchStore::new();
        store.build(vec![SearchDocumentInput {
            title: "Shared Token".to_string(),
            path: "notes/shared.md".to_string(),
            body: "Shared token appears in body".to_string(),
            tags: Some(vec![]),
        }]);

        let postings = store.index.get("shared").cloned().unwrap_or_default();
        assert_eq!(postings, vec![0]);
    }
}
