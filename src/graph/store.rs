use std::collections::HashMap;

use petgraph::graph::{Graph, NodeIndex};
use petgraph::visit::EdgeRef;
use serde::{Deserialize, Serialize};
use serde_json;

use super::algo::bfs_multi_source;
use super::model::{EdgeInput, NodeData, NodeInput};

#[derive(Debug, Serialize)]
pub struct GraphStats {
    pub node_count: usize,
    pub edge_count: usize,
}

#[derive(Debug, Serialize)]
pub struct DistanceEntry {
    pub title: String,
    pub path: String,
    pub distance: Option<usize>,
}

use crate::models::CandidateInput;

#[derive(Debug, Serialize)]
pub struct ScoredCandidate {
    pub title: String,
    pub path: String,
    pub distance_sum: usize,
    pub distance_score: f32,
    pub title_score: f32,
    pub body_score: f32,
    pub total_score: f32,
}

#[derive(Debug, Deserialize)]
pub struct ScoreWeights {
    pub distance_weight: f32,
    pub title_weight: f32,
    pub body_weight: f32,
    pub distance_falloff: f32,
}

#[derive(Debug, Serialize)]
pub struct DebugEdge {
    pub from: String,
    pub to: String,
}

#[derive(Debug, Serialize)]
pub struct GraphDebugDump {
    pub stats: GraphStats,
    pub nodes: Vec<NodeData>,
    pub edges: Vec<DebugEdge>,
}

pub struct GraphStore {
    graph: Graph<NodeData, ()>,
    title_index: HashMap<String, NodeIndex>,
    path_index: HashMap<String, NodeIndex>,
}

impl GraphStore {
    pub fn new() -> Self {
        Self {
            graph: Graph::new(),
            title_index: HashMap::new(),
            path_index: HashMap::new(),
        }
    }

    pub fn clear(&mut self) {
        self.graph = Graph::new();
        self.title_index.clear();
        self.path_index.clear();
    }

    pub fn build(&mut self, nodes: Vec<NodeInput>, edges: Vec<EdgeInput>) -> GraphStats {
        self.clear();

        for node in nodes {
            let mut title = node.title;
            let mut title_key = normalize_title_key(&title);
            if self.title_index.contains_key(&title_key) {
                title = node.path.clone();
                title_key = normalize_title_key(&title);
            }

            let data = NodeData {
                title,
                path: node.path,
            };
            let index = self.graph.add_node(data.clone());

            self.path_index.insert(data.path.clone(), index);
            self.title_index.insert(title_key, index);
        }

        for edge in edges {
            let from = self.path_index.get(&edge.from).copied();
            let to = self.path_index.get(&edge.to).copied();
            if let (Some(from), Some(to)) = (from, to) {
                self.graph.add_edge(from, to, ());
            }
        }

        self.stats()
    }

    pub fn stats(&self) -> GraphStats {
        GraphStats {
            node_count: self.graph.node_count(),
            edge_count: self.graph.edge_count(),
        }
    }

    pub fn distances_from_title(&self, title: &str) -> Vec<DistanceEntry> {
        let title_key = normalize_title_key(title);
        let sources = if let Some(node) = self.title_index.get(&title_key).copied() {
            vec![node]
        } else if let Some(node) = self.path_index.get(title).copied() {
            vec![node]
        } else if let Some(node) = self.path_index.get(&path_with_md(title)).copied() {
            vec![node]
        } else {
            Vec::new()
        };

        let distances = if sources.is_empty() {
            HashMap::new()
        } else {
            bfs_multi_source(&self.graph, &sources)
        };

        let mut entries: Vec<DistanceEntry> = self
            .graph
            .node_indices()
            .map(|index| {
                let node = &self.graph[index];
                DistanceEntry {
                    title: node.title.clone(),
                    path: node.path.clone(),
                    distance: distances.get(&index).copied(),
                }
            })
            .collect();

        entries.sort_by_key(|entry| entry.distance.unwrap_or(usize::MAX));
        entries
    }

    pub fn rank_candidates(
        &self,
        near_titles: Vec<String>,
        candidates: Vec<CandidateInput>,
        weights: ScoreWeights,
    ) -> Vec<ScoredCandidate> {
        if near_titles.is_empty() {
            let mut results: Vec<ScoredCandidate> = candidates
                .into_iter()
                .map(|candidate| {
                    let total_score = weights.title_weight * candidate.title_score
                        + weights.body_weight * candidate.body_score;
                    ScoredCandidate {
                        title: candidate.title,
                        path: candidate.path,
                        distance_sum: 0,
                        distance_score: 0.0,
                        title_score: candidate.title_score,
                        body_score: candidate.body_score,
                        total_score,
                    }
                })
                .collect();
            results.sort_by(|a, b| {
                b.total_score
                    .partial_cmp(&a.total_score)
                    .unwrap_or(std::cmp::Ordering::Equal)
            });
            return results;
        }

        let mut sources = Vec::new();
        for near in near_titles {
            if let Some(source) = self.resolve_near(&near) {
                sources.push(source);
            } else {
                return Vec::new();
            }
        }

        let distance_maps: Vec<_> = sources
            .iter()
            .map(|source| bfs_multi_source(&self.graph, &[*source]))
            .collect();

        let mut results = Vec::new();
        for candidate in candidates {
            let Some(node) = self.path_index.get(&candidate.path).copied() else {
                continue;
            };

            let mut total = 0usize;
            let mut missing = false;
            for map in &distance_maps {
                if let Some(distance) = map.get(&node) {
                    total += distance;
                } else {
                    missing = true;
                    break;
                }
            }

            if !missing {
                let effective_distance = if total <= 1 { 0 } else { total - 1 };
                let distance_score =
                    1.0 / (1.0 + weights.distance_falloff * effective_distance as f32);
                let total_score = weights.distance_weight * distance_score
                    + weights.title_weight * candidate.title_score
                    + weights.body_weight * candidate.body_score;
                results.push(ScoredCandidate {
                    title: candidate.title,
                    path: candidate.path,
                    distance_sum: total,
                    distance_score,
                    title_score: candidate.title_score,
                    body_score: candidate.body_score,
                    total_score,
                });
            }
        }

        results.sort_by(|a, b| {
            b.total_score
                .partial_cmp(&a.total_score)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        results
    }

    pub fn debug_dump(&self, node_limit: usize, edge_limit: usize) -> String {
        let nodes = self
            .graph
            .node_indices()
            .take(node_limit)
            .map(|index| self.graph[index].clone())
            .collect();

        let edges = self
            .graph
            .edge_references()
            .take(edge_limit)
            .map(|edge| {
                let from = self.graph[edge.source()].path.clone();
                let to = self.graph[edge.target()].path.clone();
                DebugEdge { from, to }
            })
            .collect();

        let dump = GraphDebugDump {
            stats: self.stats(),
            nodes,
            edges,
        };

        serde_json::to_string_pretty(&dump).unwrap_or_else(|_| "{}".to_string())
    }
}

fn normalize_title_key(value: &str) -> String {
    value.trim().to_ascii_lowercase()
}

impl GraphStore {
    fn resolve_near(&self, value: &str) -> Option<NodeIndex> {
        if let Some(node) = self.path_index.get(value).copied() {
            return Some(node);
        }
        if let Some(node) = self.path_index.get(&path_with_md(value)).copied() {
            return Some(node);
        }
        let key = normalize_title_key(value);
        self.title_index.get(&key).copied()
    }
}

fn path_with_md(value: &str) -> String {
    if value.contains('/') && !value.ends_with(".md") {
        format!("{}.md", value)
    } else {
        value.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_populates_indices() {
        let mut store = GraphStore::new();
        let nodes = vec![
            NodeInput {
                title: "alpha".to_string(),
                path: "alpha.md".to_string(),
            },
            NodeInput {
                title: "beta".to_string(),
                path: "beta.md".to_string(),
            },
        ];
        let edges = vec![EdgeInput {
            from: "alpha.md".to_string(),
            to: "beta.md".to_string(),
        }];

        let stats = store.build(nodes, edges);

        assert_eq!(stats.node_count, 2);
        assert_eq!(stats.edge_count, 1);
        assert!(store.title_index.contains_key("alpha"));
        assert!(store.path_index.contains_key("beta.md"));
    }

    #[test]
    fn distances_from_title_returns_sorted_entries() {
        let mut store = GraphStore::new();
        let nodes = vec![
            NodeInput {
                title: "alpha".to_string(),
                path: "alpha.md".to_string(),
            },
            NodeInput {
                title: "beta".to_string(),
                path: "beta.md".to_string(),
            },
            NodeInput {
                title: "gamma".to_string(),
                path: "gamma.md".to_string(),
            },
        ];
        let edges = vec![
            EdgeInput {
                from: "alpha.md".to_string(),
                to: "beta.md".to_string(),
            },
            EdgeInput {
                from: "beta.md".to_string(),
                to: "gamma.md".to_string(),
            },
        ];

        store.build(nodes, edges);
        let entries = store.distances_from_title("alpha");

        assert_eq!(
            entries.first().map(|entry| entry.title.as_str()),
            Some("alpha")
        );
        assert_eq!(
            entries.get(1).map(|entry| entry.title.as_str()),
            Some("beta")
        );
    }

    #[test]
    fn duplicate_titles_use_path_key() {
        let mut store = GraphStore::new();
        let nodes = vec![
            NodeInput {
                title: "alpha".to_string(),
                path: "alpha.md".to_string(),
            },
            NodeInput {
                title: "alpha".to_string(),
                path: "folder/alpha.md".to_string(),
            },
        ];

        store.build(nodes, Vec::new());

        let entries = store.distances_from_title("folder/alpha.md");
        assert_eq!(
            entries.first().map(|entry| entry.path.as_str()),
            Some("folder/alpha.md")
        );
    }
}
