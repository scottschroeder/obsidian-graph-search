use std::collections::HashSet;

pub fn tokenize(text: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();

    for ch in text.chars() {
        if is_token_char(ch, current.is_empty()) {
            current.push(ch.to_ascii_lowercase());
        } else if !current.is_empty() {
            tokens.push(current);
            current = String::new();
        }
    }

    if !current.is_empty() {
        tokens.push(current);
    }

    tokens
}

pub fn extract_tags(text: &str) -> HashSet<String> {
    let mut tags = HashSet::new();
    let mut in_fence = false;
    let mut fence_marker = "";
    let mut frontmatter_checked = false;
    let mut in_frontmatter = false;

    for line in text.lines() {
        let trimmed = line.trim();
        if !frontmatter_checked {
            if trimmed.is_empty() {
                continue;
            }
            frontmatter_checked = true;
            if trimmed == "---" {
                in_frontmatter = true;
                continue;
            }
        }

        if in_frontmatter {
            if trimmed == "---" {
                in_frontmatter = false;
            }
            continue;
        }

        let stripped = line.trim_start();
        if stripped.starts_with("```") || stripped.starts_with("~~~") {
            let marker = &stripped[..3];
            if !in_fence {
                in_fence = true;
                fence_marker = marker;
            } else if stripped.starts_with(fence_marker) {
                in_fence = false;
                fence_marker = "";
            }
            continue;
        }

        if in_fence {
            continue;
        }

        for token in tokenize(line) {
            if token.starts_with('#') && token.len() > 1 {
                tags.insert(token);
            }
        }
    }

    tags
}

fn is_token_char(ch: char, is_start: bool) -> bool {
    if ch.is_alphanumeric() || ch == '_' || ch == '-' || ch == '/' {
        return true;
    }
    if ch == '#' {
        return is_start;
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokenize_basic_words() {
        let tokens = tokenize("Budget for Q3 meeting");
        assert_eq!(tokens, vec!["budget", "for", "q3", "meeting"]);
    }

    #[test]
    fn tokenize_tags_and_paths() {
        let tokens = tokenize("tag:#meeting path/to/file");
        assert!(tokens.contains(&"tag".to_string()));
        assert!(tokens.contains(&"#meeting".to_string()));
    }

    #[test]
    fn extract_tags_from_text() {
        let tags = extract_tags("Notes for #ProjectX and #meeting");
        assert!(tags.contains("#projectx"));
        assert!(tags.contains("#meeting"));
    }

    #[test]
    fn extract_tags_with_slashes() {
        let tags = extract_tags("Notes for #project/alpha and #meeting");
        assert!(tags.contains("#project/alpha"));
    }

    #[test]
    fn extract_tags_ignores_frontmatter() {
        let text = "---\ntags:\n  - log/incident\n---\nBody #keep";
        let tags = extract_tags(text);
        assert!(!tags.contains("#log/incident"));
        assert!(tags.contains("#keep"));
    }

    #[test]
    fn extract_tags_ignores_fenced_yaml() {
        let text = "Example:\n```yaml\ntags: [log/incident]\n#fake\n```\nBody #real";
        let tags = extract_tags(text);
        assert!(!tags.contains("#fake"));
        assert!(tags.contains("#real"));
    }
}
