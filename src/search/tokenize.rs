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
    tokenize(text)
        .into_iter()
        .filter(|token| token.starts_with('#') && token.len() > 1)
        .collect()
}

fn is_token_char(ch: char, is_start: bool) -> bool {
    if ch.is_alphanumeric() || ch == '_' || ch == '-' {
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
}
