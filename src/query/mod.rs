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
}

#[derive(Debug, Serialize)]
pub(crate) struct ParsedQuery {
    pub(crate) near_titles: Vec<String>,
    pub(crate) base_query: String,
}

pub(crate) fn parse_query_atoms(atoms: &[QueryAtom]) -> ParsedQuery {
    let mut near_titles = Vec::new();
    let mut base_tokens = Vec::new();

    for atom in atoms {
        let trimmed = atom.value.trim();
        if trimmed.is_empty() {
            continue;
        }
        match atom.kind {
            QueryAtomKind::Near => {
                near_titles.push(trimmed.to_string());
            }
            QueryAtomKind::Tag => {
                base_tokens.push(format!("tag:{}", trimmed));
            }
            QueryAtomKind::Path => {
                base_tokens.push(format!("path:{}", trimmed));
            }
            QueryAtomKind::Whitespace => {}
            QueryAtomKind::Term => {
                base_tokens.push(trimmed.to_string());
            }
        }
    }

    ParsedQuery {
        near_titles,
        base_query: base_tokens.join(" "),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_query_atoms_builds_base_and_near() {
        let atoms = vec![
            QueryAtom {
                kind: QueryAtomKind::Near,
                value: "My Note".to_string(),
            },
            QueryAtom {
                kind: QueryAtomKind::Whitespace,
                value: " ".to_string(),
            },
            QueryAtom {
                kind: QueryAtomKind::Term,
                value: "budget".to_string(),
            },
            QueryAtom {
                kind: QueryAtomKind::Whitespace,
                value: " ".to_string(),
            },
            QueryAtom {
                kind: QueryAtomKind::Tag,
                value: "#meeting".to_string(),
            },
            QueryAtom {
                kind: QueryAtomKind::Term,
                value: "deadline".to_string(),
            },
        ];

        let parsed = parse_query_atoms(&atoms);
        assert_eq!(parsed.near_titles, vec!["My Note"]);
        assert_eq!(parsed.base_query, "budget tag:#meeting deadline");
    }
}
