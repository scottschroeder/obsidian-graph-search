use std::{cell::RefCell, collections::HashSet, rc::Rc};

use hashbrown::HashMap;
use petgraph::{
    algo::dijkstra,
    graph::{Graph, NodeIndex},
    visit::EdgeRef,
};
use serde::{Deserialize, Serialize};

use super::model::{EdgeInput, EdgeKind, NodeData, NodeInput};

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
    graph: Graph<NodeData, EdgeKind>,
    path_index: HashMap<String, NodeIndex>,
    degree_map: HashMap<NodeIndex, usize>,
    cached_distance_maps: RefCell<Option<CachedDistanceMap>>,
}

struct CachedDistanceMap {
    sources: Vec<NodeIndex>,
    connection_strength: Option<f32>,
    distance_maps: Rc<Vec<HashMap<NodeIndex, f32>>>,
}

impl GraphStore {
    pub(crate) fn new() -> Self {
        Self {
            graph: Graph::new(),
            path_index: HashMap::new(),
            degree_map: HashMap::new(),
            cached_distance_maps: RefCell::new(None),
        }
    }

    pub(crate) fn clear(&mut self) {
        self.graph = Graph::new();
        self.path_index.clear();
        self.degree_map.clear();
        self.cached_distance_maps.borrow_mut().take();
    }

    pub(crate) fn build(&mut self, nodes: Vec<NodeInput>, edges: Vec<EdgeInput>) {
        self.clear();

        for node in nodes {
            let path_key = node.path.clone();
            let data = NodeData { path: node.path };
            let index = self.graph.add_node(data);

            self.path_index.insert(path_key, index);
        }

        let mut edge_map: HashMap<(NodeIndex, NodeIndex), EdgeKind> = HashMap::new();
        for edge in edges {
            let from = self.path_index.get(&edge.from).copied();
            let to = self.path_index.get(&edge.to).copied();
            if let (Some(from), Some(to)) = (from, to) {
                // Insert Explicit connection, overwriting any possible Implicit edge
                edge_map.insert((from, to), EdgeKind::Explicit);
                // if there is no explicit edge connecting these nodes, create an implicit
                // connection
                edge_map.entry((to, from)).or_insert(EdgeKind::Implicit);
            }
        }

        // Send our edge_map into the graph
        for ((from, to), kind) in edge_map {
            self.graph.add_edge(from, to, kind);
        }

        self.degree_map = self.compute_degree_map();
        self.cached_distance_maps.borrow_mut().take();
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
            self.score_candidates_with_distances(candidates, distance_maps.as_ref(), &weights);
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
    ) -> Rc<Vec<HashMap<NodeIndex, f32>>> {
        let use_weighted = weights.connection_strength.abs() >= f32::EPSILON;
        let connection_strength = if use_weighted {
            Some(weights.connection_strength)
        } else {
            None
        };
        if let Some(cache) = self.cached_distance_maps.borrow().as_ref() {
            if cache.sources == sources && cache.connection_strength == connection_strength {
                return Rc::clone(&cache.distance_maps);
            }
        }
        let degrees = if use_weighted {
            Some(&self.degree_map)
        } else {
            None
        };
        let distance_maps: Vec<HashMap<NodeIndex, f32>> = sources
            .iter()
            .map(|source| {
                dijkstra(&self.graph, *source, None, |edge| {
                    if let Some(degrees) = degrees.as_ref() {
                        let deg_a = *degrees.get(&edge.source()).unwrap_or(&0);
                        let deg_b = *degrees.get(&edge.target()).unwrap_or(&0);
                        let degree_sum = (deg_a + deg_b) as f32;
                        let base = if degree_sum > 0.0 {
                            degree_sum / 2.0
                        } else {
                            1.0
                        };
                        base.powf(weights.connection_strength)
                    } else {
                        1.0
                    }
                })
            })
            .collect();

        let distance_maps = Rc::new(distance_maps);

        *self.cached_distance_maps.borrow_mut() = Some(CachedDistanceMap {
            sources: sources.to_vec(),
            connection_strength,
            distance_maps: Rc::clone(&distance_maps),
        });

        distance_maps
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

        let mut max_distance: Option<f32> = None;
        let mut max_title: Option<f32> = None;
        let mut max_body: Option<f32> = None;

        for entry in results.iter() {
            max_distance = max_distance
                .map(|current| current.max(entry.distance_score))
                .or(Some(entry.distance_score));
            max_title = max_title
                .map(|current| current.max(entry.title_score))
                .or(Some(entry.title_score));
            max_body = max_body
                .map(|current| current.max(entry.body_score))
                .or(Some(entry.body_score));
        }

        let max_distance = max_distance.unwrap_or(0.0);
        let max_title = max_title.unwrap_or(0.0);
        let max_body = max_body.unwrap_or(0.0);

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

    fn compute_degree_map(&self) -> HashMap<NodeIndex, usize> {
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
        self.path_index.get(value).copied()
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_populates_indices() {
        let mut store = GraphStore::new();
        let nodes = vec![
            NodeInput {
                path: "alpha.md".to_string(),
            },
            NodeInput {
                path: "folder/beta.md".to_string(),
            },
        ];
        let edges = vec![EdgeInput {
            from: "alpha.md".to_string(),
            to: "folder/beta.md".to_string(),
        }];

        store.build(nodes, edges);

        assert_eq!(store.graph.node_count(), 2);
        assert_eq!(store.graph.edge_count(), 2);
        assert!(store.path_index.contains_key("alpha.md"));
        assert!(store.path_index.contains_key("folder/beta.md"));
    }

    #[test]
    fn distance_score_equal_for_zero_and_one() {
        let mut store = GraphStore::new();
        let nodes = vec![
            NodeInput {
                path: "alpha.md".to_string(),
            },
            NodeInput {
                path: "beta.md".to_string(),
            },
            NodeInput {
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

        let results = store.rank_candidates(vec!["alpha.md".to_string()], candidates, weights);
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
                path: "hub.md".to_string(),
            },
            NodeInput {
                path: "spoke1.md".to_string(),
            },
            NodeInput {
                path: "spoke2.md".to_string(),
            },
            NodeInput {
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

        let degrees = store.degree_map;
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
    fn distance_maps_recompute_for_new_sources() {
        let mut store = GraphStore::new();
        let nodes = vec![
            NodeInput {
                path: "a.md".to_string(),
            },
            NodeInput {
                path: "b.md".to_string(),
            },
            NodeInput {
                path: "c.md".to_string(),
            },
        ];
        let edges = vec![
            EdgeInput {
                from: "a.md".to_string(),
                to: "b.md".to_string(),
            },
            EdgeInput {
                from: "b.md".to_string(),
                to: "c.md".to_string(),
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

        let candidates_from_a = vec![CandidateInput {
            title: "c".to_string(),
            path: "c.md".to_string(),
            title_score: 0.0,
            body_score: 0.0,
        }];

        let candidates_from_b = vec![CandidateInput {
            title: "c".to_string(),
            path: "c.md".to_string(),
            title_score: 0.0,
            body_score: 0.0,
        }];

        let results_from_a =
            store.rank_candidates(vec!["a.md".to_string()], candidates_from_a, weights);
        let results_from_b = store.rank_candidates(
            vec!["b.md".to_string()],
            candidates_from_b,
            ScoreWeights {
                distance_weight: 1.0,
                title_weight: 0.0,
                body_weight: 0.0,
                distance_falloff: 0.5,
                connection_strength: 0.0,
                distance_curve: "exponential".to_string(),
            },
        );

        assert_eq!(results_from_a.len(), 1);
        assert_eq!(results_from_b.len(), 1);
        assert!(
            (results_from_a[0].distance_sum - 2.0).abs() < 1e-6,
            "expected distance 2 from a to c"
        );
        assert!(
            (results_from_b[0].distance_sum - 1.0).abs() < 1e-6,
            "expected distance 1 from b to c"
        );
    }

    #[test]
    fn rank_candidates_with_weighted_dijkstra() {
        let mut store = GraphStore::new();
        let nodes = vec![
            NodeInput {
                path: "start.md".to_string(),
            },
            NodeInput {
                path: "hub.md".to_string(),
            },
            NodeInput {
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

        let results = store.rank_candidates(vec!["start.md".to_string()], candidates, weights);
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
    fn normalize_scores_scales_and_defaults() {
        let store = GraphStore::new();
        let weights = ScoreWeights {
            distance_weight: 1.0,
            title_weight: 1.0,
            body_weight: 1.0,
            distance_falloff: 0.0,
            connection_strength: 0.0,
            distance_curve: "exponential".to_string(),
        };
        let mut results = vec![
            ScoredCandidate {
                title: "alpha".to_string(),
                path: "alpha.md".to_string(),
                distance_sum: 0.0,
                distance_score: 2.0,
                title_score: 4.0,
                body_score: 0.0,
                total_score: 0.0,
            },
            ScoredCandidate {
                title: "beta".to_string(),
                path: "beta.md".to_string(),
                distance_sum: 0.0,
                distance_score: 1.0,
                title_score: 2.0,
                body_score: 0.0,
                total_score: 0.0,
            },
        ];

        store.normalize_scores(&mut results, &weights);

        let alpha = &results[0];
        let beta = &results[1];

        assert!((alpha.distance_score - 1.0).abs() < 1e-6);
        assert!((alpha.title_score - 1.0).abs() < 1e-6);
        assert!((alpha.body_score - 1.0).abs() < 1e-6);
        assert!((alpha.total_score - 3.0).abs() < 1e-6);

        assert!((beta.distance_score - 0.5).abs() < 1e-6);
        assert!((beta.title_score - 0.5).abs() < 1e-6);
        assert!((beta.body_score - 1.0).abs() < 1e-6);
        assert!((beta.total_score - 2.0).abs() < 1e-6);
    }

    #[test]
    fn resolve_near_matches_path() {
        let mut store = GraphStore::new();
        let nodes = vec![NodeInput {
            path: "folder/note.md".to_string(),
        }];
        store.build(nodes, Vec::new());

        let resolved = store.resolve_near("folder/note.md");
        assert!(resolved.is_some());

        let node = resolved.unwrap();
        assert_eq!(store.graph[node].path, "folder/note.md");
    }

    #[test]
    fn rank_candidates_disconnected_returns_empty() {
        let mut store = GraphStore::new();
        let nodes = vec![
            NodeInput {
                path: "island1.md".to_string(),
            },
            NodeInput {
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
