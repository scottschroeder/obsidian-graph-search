use std::collections::{HashMap, VecDeque};

use petgraph::{
    graph::{Graph, NodeIndex},
    visit::EdgeRef,
};

use super::model::NodeData;

pub fn bfs_multi_source(
    graph: &Graph<NodeData, ()>,
    sources: &[NodeIndex],
) -> HashMap<NodeIndex, usize> {
    let mut distances = HashMap::new();
    let mut queue = VecDeque::new();

    for source in sources {
        if distances.insert(*source, 0).is_none() {
            queue.push_back(*source);
        }
    }

    while let Some(current) = queue.pop_front() {
        let next_distance = distances[&current] + 1;
        for edge in graph.edges(current) {
            let neighbor = edge.target();
            if let std::collections::hash_map::Entry::Vacant(e) = distances.entry(neighbor) {
                e.insert(next_distance);
                queue.push_back(neighbor);
            }
        }

        for edge in graph.edges_directed(current, petgraph::Direction::Incoming) {
            let neighbor = edge.source();
            if let std::collections::hash_map::Entry::Vacant(e) = distances.entry(neighbor) {
                e.insert(next_distance);
                queue.push_back(neighbor);
            }
        }
    }

    distances
}

#[cfg(test)]
mod tests {
    use petgraph::graph::Graph;

    use super::*;

    fn node(title: &str) -> NodeData {
        NodeData {
            title: title.to_string(),
            path: format!("{}.md", title),
        }
    }

    #[test]
    fn bfs_multi_source_reaches_neighbors() {
        let mut graph = Graph::<NodeData, ()>::new();
        let a = graph.add_node(node("a"));
        let b = graph.add_node(node("b"));
        let c = graph.add_node(node("c"));
        let d = graph.add_node(node("d"));

        graph.add_edge(a, b, ());
        graph.add_edge(b, c, ());
        graph.add_edge(c, d, ());

        let distances = bfs_multi_source(&graph, &[a]);
        assert_eq!(distances.get(&a), Some(&0));
        assert_eq!(distances.get(&b), Some(&1));
        assert_eq!(distances.get(&c), Some(&2));
        assert_eq!(distances.get(&d), Some(&3));
    }

    #[test]
    fn bfs_multi_source_uses_min_distance() {
        let mut graph = Graph::<NodeData, ()>::new();
        let a = graph.add_node(node("a"));
        let b = graph.add_node(node("b"));
        let c = graph.add_node(node("c"));

        graph.add_edge(a, c, ());
        graph.add_edge(b, c, ());

        let distances = bfs_multi_source(&graph, &[a, b]);
        assert_eq!(distances.get(&a), Some(&0));
        assert_eq!(distances.get(&b), Some(&0));
        assert_eq!(distances.get(&c), Some(&1));
    }

    #[test]
    fn bfs_multi_source_includes_incoming_edges() {
        let mut graph = Graph::<NodeData, ()>::new();
        let a = graph.add_node(node("a"));
        let b = graph.add_node(node("b"));

        graph.add_edge(a, b, ());

        let distances = bfs_multi_source(&graph, &[b]);
        assert_eq!(distances.get(&b), Some(&0));
        assert_eq!(distances.get(&a), Some(&1));
    }
}
