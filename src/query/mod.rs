use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum QueryAtomKind {
    Term,
    Near,
    Tag,
    Path,
    Whitespace,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct QueryAtom {
    pub(crate) kind: QueryAtomKind,
    pub(crate) value: String,
    #[serde(default)]
    pub(crate) display: Option<String>,
}

#[derive(Debug)]
pub(crate) struct AtomQuery {
    pub(crate) near_titles: Vec<String>,
    pub(crate) terms: Vec<String>,
    pub(crate) tags: Vec<String>,
    pub(crate) paths: Vec<String>,
}

pub(crate) fn partition_atoms(atoms: &[QueryAtom]) -> AtomQuery {
    let mut near_titles = Vec::new();
    let mut terms = Vec::new();
    let mut tags = Vec::new();
    let mut paths = Vec::new();

    for atom in atoms {
        let trimmed = atom.value.trim();
        if trimmed.is_empty() {
            continue;
        }
        match atom.kind {
            QueryAtomKind::Near => near_titles.push(trimmed.to_string()),
            QueryAtomKind::Tag => tags.push(trimmed.to_string()),
            QueryAtomKind::Path => paths.push(trimmed.to_string()),
            QueryAtomKind::Whitespace => {}
            QueryAtomKind::Term => terms.push(trimmed.to_string()),
        }
    }

    AtomQuery {
        near_titles,
        terms,
        tags,
        paths,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn partition_atoms_splits_near_and_filters() {
        let atoms = vec![
            QueryAtom {
                kind: QueryAtomKind::Near,
                value: "My Note".to_string(),
                display: None,
            },
            QueryAtom {
                kind: QueryAtomKind::Whitespace,
                value: " ".to_string(),
                display: None,
            },
            QueryAtom {
                kind: QueryAtomKind::Term,
                value: "budget".to_string(),
                display: None,
            },
            QueryAtom {
                kind: QueryAtomKind::Whitespace,
                value: " ".to_string(),
                display: None,
            },
            QueryAtom {
                kind: QueryAtomKind::Tag,
                value: "#meeting".to_string(),
                display: None,
            },
            QueryAtom {
                kind: QueryAtomKind::Term,
                value: "deadline".to_string(),
                display: None,
            },
            QueryAtom {
                kind: QueryAtomKind::Path,
                value: "projects".to_string(),
                display: None,
            },
        ];

        let parsed = partition_atoms(&atoms);
        assert_eq!(parsed.near_titles, vec!["My Note"]);
        assert_eq!(parsed.terms, vec!["budget", "deadline"]);
        assert_eq!(parsed.tags, vec!["#meeting"]);
        assert_eq!(parsed.paths, vec!["projects"]);
    }
}
