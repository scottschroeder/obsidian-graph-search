use std::collections::{HashMap, HashSet};

use petgraph::{
    algo::dijkstra,
    graph::{Graph, NodeIndex},
    visit::EdgeRef,
    Undirected,
};
use serde::{Deserialize, Serialize};

use super::{
    algo::bfs_multi_source,
    model::{EdgeInput, NodeData, NodeInput},
};

#[derive(Debug, Serialize)]
pub(crate) struct GraphStats {
    pub(crate) node_count: usize,
    pub(crate) edge_count: usize,
}

use crate::models::CandidateInput;

#[derive(Debug, Serialize)]
pub(crate) struct ScoredCandidate {
    pub(crate) title: String,
    pub(crate) path: String,
    pub(crate) distance_sum: f32,
    pub(crate) distance_score: f32,
    pub(crate) title_score: f32,
    pub(crate) body_score: f32,
    pub(crate) total_score: f32,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ScoreWeights {
    pub(crate) distance_weight: f32,
    pub(crate) title_weight: f32,
    pub(crate) body_weight: f32,
    pub(crate) distance_falloff: f32,
    pub(crate) connection_strength: f32,
    pub(crate) distance_curve: String,
}

pub(crate) struct GraphStore {
    graph: Graph<NodeData, ()>,
    title_index: HashMap<String, NodeIndex>,
    path_index: HashMap<String, NodeIndex>,
}

impl GraphStore {
    pub(crate) fn new() -> Self {
        Self {
            graph: Graph::new(),
            title_index: HashMap::new(),
            path_index: HashMap::new(),
        }
    }

    pub(crate) fn clear(&mut self) {
        self.graph = Graph::new();
        self.title_index.clear();
        self.path_index.clear();
    }

    pub(crate) fn build(&mut self, nodes: Vec<NodeInput>, edges: Vec<EdgeInput>) -> GraphStats {
        self.clear();

        for node in nodes {
            let mut title = node.title;
            let mut title_key = normalize_title_key(&title);
            if self.title_index.contains_key(&title_key) {
                title = node.path.clone();
                title_key = normalize_title_key(&title);
            }

            let path_key = node.path.clone();
            let data = NodeData {
                title,
                path: node.path,
            };
            let index = self.graph.add_node(data);

            self.path_index.insert(path_key, index);
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

    pub(crate) fn stats(&self) -> GraphStats {
        GraphStats {
            node_count: self.graph.node_count(),
            edge_count: self.graph.edge_count(),
        }
    }

    pub(crate) fn rank_candidates(
        &self,
        near_titles: Vec<String>,
        candidates: Vec<CandidateInput>,
        weights: ScoreWeights,
    ) -> Vec<ScoredCandidate> {
        if near_titles.is_empty() {
            let mut results = self.score_without_near(candidates);
            self.normalize_scores(&mut results, &weights);
            results.sort_by(|a, b| {
                b.total_score
                    .partial_cmp(&a.total_score)
                    .unwrap_or(std::cmp::Ordering::Equal)
            });
            return results;
        }

        let Some(sources) = self.resolve_sources(near_titles) else {
            return Vec::new();
        };

        let distance_maps = self.compute_distance_maps(&sources, &weights);
        let mut results =
            self.score_candidates_with_distances(candidates, &distance_maps, &weights);
        self.normalize_scores(&mut results, &weights);
        results.sort_by(|a, b| {
            b.total_score
                .partial_cmp(&a.total_score)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        results
    }
}

fn score_distance(distance: f32, falloff: f32, curve: &str) -> f32 {
    match curve {
        "reciprocal" => 1.0 / (1.0 + falloff * distance),
        "power" => {
            let exponent = if falloff <= 0.0 { 1.0 } else { falloff };
            1.0 / (1.0 + distance).powf(exponent)
        }
        // Default to exponential decay (includes "exponential" and unknown curves)
        _ => (-falloff * distance).exp(),
    }
}

fn normalize_title_key(value: &str) -> String {
    value.trim().to_lowercase()
}

impl GraphStore {
    fn score_without_near(&self, candidates: Vec<CandidateInput>) -> Vec<ScoredCandidate> {
        candidates
            .into_iter()
            .map(|candidate| ScoredCandidate {
                title: candidate.title,
                path: candidate.path,
                distance_sum: 0.0,
                distance_score: 0.0,
                title_score: candidate.title_score,
                body_score: candidate.body_score,
                total_score: 0.0,
            })
            .collect()
    }

    fn resolve_sources(&self, near_titles: Vec<String>) -> Option<Vec<NodeIndex>> {
        let mut sources = Vec::new();
        for near in near_titles {
            if let Some(source) = self.resolve_near(&near) {
                sources.push(source);
            } else {
                return None;
            }
        }
        Some(sources)
    }

    fn compute_distance_maps(
        &self,
        sources: &[NodeIndex],
        weights: &ScoreWeights,
    ) -> Vec<HashMap<NodeIndex, f32>> {
        let degrees = self.degree_map();
        let use_weighted = weights.connection_strength.abs() >= f32::EPSILON;
        let undirected = if use_weighted {
            Some(self.graph.clone().into_edge_type::<Undirected>())
        } else {
            None
        };

        sources
            .iter()
            .map(|source| {
                if let Some(graph) = undirected.as_ref() {
                    dijkstra(graph, *source, None, |edge| {
                        let deg_a = *degrees.get(&edge.source()).unwrap_or(&0);
                        let deg_b = *degrees.get(&edge.target()).unwrap_or(&0);
                        let degree_sum = (deg_a + deg_b) as f32;
                        let base = if degree_sum > 0.0 {
                            degree_sum / 2.0
                        } else {
                            1.0
                        };
                        base.powf(weights.connection_strength)
                    })
                    .into_iter()
                    .collect()
                } else {
                    bfs_multi_source(&self.graph, &[*source])
                        .into_iter()
                        .map(|(node, distance)| (node, distance as f32))
                        .collect()
                }
            })
            .collect()
    }

    fn score_candidates_with_distances(
        &self,
        candidates: Vec<CandidateInput>,
        distance_maps: &[HashMap<NodeIndex, f32>],
        weights: &ScoreWeights,
    ) -> Vec<ScoredCandidate> {
        let mut results = Vec::new();
        for candidate in candidates {
            let Some(node) = self.path_index.get(&candidate.path).copied() else {
                continue;
            };

            let Some(total) = distance_sum(distance_maps, node) else {
                continue;
            };

            // Subtracting 1 treats direct neighbors (distance=1) the same as
            // the source node itself (distance=0), since both represent immediate context.
            let effective_distance = (total - 1.0).max(0.0);
            let distance_score = score_distance(
                effective_distance,
                weights.distance_falloff,
                &weights.distance_curve,
            );
            results.push(ScoredCandidate {
                title: candidate.title,
                path: candidate.path,
                distance_sum: total,
                distance_score,
                title_score: candidate.title_score,
                body_score: candidate.body_score,
                total_score: 0.0,
            });
        }
        results
    }
    fn normalize_scores(&self, results: &mut [ScoredCandidate], weights: &ScoreWeights) {
        if results.is_empty() {
            return;
        }

        let mut max_distance: f32 = 0.0;
        let mut max_title: f32 = 0.0;
        let mut max_body: f32 = 0.0;

        for entry in results.iter() {
            max_distance = max_distance.max(entry.distance_score);
            max_title = max_title.max(entry.title_score);
            max_body = max_body.max(entry.body_score);
        }

        for entry in results.iter_mut() {
            entry.distance_score = if max_distance.abs() < f32::EPSILON {
                1.0
            } else {
                entry.distance_score / max_distance
            };
            entry.title_score = if max_title.abs() < f32::EPSILON {
                1.0
            } else {
                entry.title_score / max_title
            };
            entry.body_score = if max_body.abs() < f32::EPSILON {
                1.0
            } else {
                entry.body_score / max_body
            };
            entry.total_score = weights.distance_weight * entry.distance_score
                + weights.title_weight * entry.title_score
                + weights.body_weight * entry.body_score;
        }
    }

    fn degree_map(&self) -> HashMap<NodeIndex, usize> {
        let mut neighbors: HashMap<NodeIndex, HashSet<NodeIndex>> = HashMap::new();
        for edge in self.graph.edge_references() {
            let from = edge.source();
            let to = edge.target();
            neighbors.entry(from).or_default().insert(to);
            neighbors.entry(to).or_default().insert(from);
        }
        for node in self.graph.node_indices() {
            neighbors.entry(node).or_default();
        }

        neighbors
            .into_iter()
            .map(|(node, entries)| (node, entries.len()))
            .collect()
    }

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

fn distance_sum(distance_maps: &[HashMap<NodeIndex, f32>], node: NodeIndex) -> Option<f32> {
    let mut total = 0.0f32;
    for map in distance_maps {
        if let Some(distance) = map.get(&node) {
            total += distance;
        } else {
            return None;
        }
    }
    Some(total)
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
    fn distance_score_equal_for_zero_and_one() {
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

        let weights = ScoreWeights {
            distance_weight: 1.0,
            title_weight: 0.0,
            body_weight: 0.0,
            distance_falloff: 0.5,
            connection_strength: 0.0,
            distance_curve: "exponential".to_string(),
        };
        let candidates = vec![
            CandidateInput {
                title: "alpha".to_string(),
                path: "alpha.md".to_string(),
                title_score: 0.0,
                body_score: 0.0,
            },
            CandidateInput {
                title: "beta".to_string(),
                path: "beta.md".to_string(),
                title_score: 0.0,
                body_score: 0.0,
            },
            CandidateInput {
                title: "gamma".to_string(),
                path: "gamma.md".to_string(),
                title_score: 0.0,
                body_score: 0.0,
            },
        ];

        let results = store.rank_candidates(vec!["alpha".to_string()], candidates, weights);
        let by_path: HashMap<_, _> = results
            .into_iter()
            .map(|entry| (entry.path.clone(), entry))
            .collect();

        let alpha = by_path.get("alpha.md").unwrap();
        let beta = by_path.get("beta.md").unwrap();
        let gamma = by_path.get("gamma.md").unwrap();

        assert!((alpha.distance_score - 1.0).abs() < 1e-6);
        assert!((beta.distance_score - 1.0).abs() < 1e-6);
        assert!(gamma.distance_score < 1.0);
    }

    #[test]
    fn degree_map_returns_correct_degrees() {
        let mut store = GraphStore::new();
        let nodes = vec![
            NodeInput {
                title: "hub".to_string(),
                path: "hub.md".to_string(),
            },
            NodeInput {
                title: "spoke1".to_string(),
                path: "spoke1.md".to_string(),
            },
            NodeInput {
                title: "spoke2".to_string(),
                path: "spoke2.md".to_string(),
            },
            NodeInput {
                title: "isolated".to_string(),
                path: "isolated.md".to_string(),
            },
        ];
        let edges = vec![
            EdgeInput {
                from: "hub.md".to_string(),
                to: "spoke1.md".to_string(),
            },
            EdgeInput {
                from: "hub.md".to_string(),
                to: "spoke2.md".to_string(),
            },
            EdgeInput {
                from: "spoke1.md".to_string(),
                to: "hub.md".to_string(),
            },
        ];
        store.build(nodes, edges);

        let degrees = store.degree_map();
        let hub_index = store.path_index.get("hub.md").unwrap();
        let spoke1_index = store.path_index.get("spoke1.md").unwrap();
        let spoke2_index = store.path_index.get("spoke2.md").unwrap();
        let isolated_index = store.path_index.get("isolated.md").unwrap();

        assert_eq!(degrees.get(hub_index).copied().unwrap_or(0), 2);
        assert_eq!(degrees.get(spoke1_index).copied().unwrap_or(0), 1);
        assert_eq!(degrees.get(spoke2_index).copied().unwrap_or(0), 1);
        assert_eq!(degrees.get(isolated_index).copied().unwrap_or(0), 0);
    }

    #[test]
    fn rank_candidates_with_weighted_dijkstra() {
        let mut store = GraphStore::new();
        let nodes = vec![
            NodeInput {
                title: "start".to_string(),
                path: "start.md".to_string(),
            },
            NodeInput {
                title: "hub".to_string(),
                path: "hub.md".to_string(),
            },
            NodeInput {
                title: "end".to_string(),
                path: "end.md".to_string(),
            },
        ];
        let edges = vec![
            EdgeInput {
                from: "start.md".to_string(),
                to: "hub.md".to_string(),
            },
            EdgeInput {
                from: "hub.md".to_string(),
                to: "end.md".to_string(),
            },
        ];
        store.build(nodes, edges);

        let weights = ScoreWeights {
            distance_weight: 1.0,
            title_weight: 0.0,
            body_weight: 0.0,
            distance_falloff: 0.5,
            connection_strength: 1.0,
            distance_curve: "exponential".to_string(),
        };
        let candidates = vec![
            CandidateInput {
                title: "hub".to_string(),
                path: "hub.md".to_string(),
                title_score: 0.0,
                body_score: 0.0,
            },
            CandidateInput {
                title: "end".to_string(),
                path: "end.md".to_string(),
                title_score: 0.0,
                body_score: 0.0,
            },
        ];

        let results = store.rank_candidates(vec!["start".to_string()], candidates, weights);
        assert_eq!(results.len(), 2);
        let by_path: HashMap<_, _> = results
            .into_iter()
            .map(|entry| (entry.path.clone(), entry))
            .collect();

        let hub = by_path.get("hub.md").unwrap();
        let end = by_path.get("end.md").unwrap();
        assert!(hub.distance_score >= end.distance_score);
    }

    #[test]
    fn resolve_near_appends_md_extension() {
        let mut store = GraphStore::new();
        let nodes = vec![NodeInput {
            title: "note".to_string(),
            path: "folder/note.md".to_string(),
        }];
        store.build(nodes, Vec::new());

        let resolved = store.resolve_near("folder/note");
        assert!(resolved.is_some());

        let node = resolved.unwrap();
        assert_eq!(store.graph[node].path, "folder/note.md");
    }

    #[test]
    fn rank_candidates_disconnected_returns_empty() {
        let mut store = GraphStore::new();
        let nodes = vec![
            NodeInput {
                title: "island1".to_string(),
                path: "island1.md".to_string(),
            },
            NodeInput {
                title: "island2".to_string(),
                path: "island2.md".to_string(),
            },
        ];
        store.build(nodes, Vec::new());

        let weights = ScoreWeights {
            distance_weight: 1.0,
            title_weight: 0.0,
            body_weight: 0.0,
            distance_falloff: 0.5,
            connection_strength: 0.0,
            distance_curve: "exponential".to_string(),
        };
        let candidates = vec![CandidateInput {
            title: "island2".to_string(),
            path: "island2.md".to_string(),
            title_score: 0.0,
            body_score: 0.0,
        }];

        let results = store.rank_candidates(vec!["island1".to_string()], candidates, weights);
        assert!(results.is_empty());
    }
}
