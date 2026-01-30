use std::collections::HashSet;

pub fn tokenize(text: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();

    for ch in text.chars() {
        if is_token_char(ch, current.is_empty()) {
            for c in ch.to_lowercase() {
                current.push(c);
            }
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

pub fn extract_composite_tokens(text: &str) -> HashSet<String> {
    let mut tokens = HashSet::new();
    let mut current = String::new();
    let mut has_separator = false;
    let mut has_alnum = false;

    for ch in text.chars() {
        if ch.is_alphanumeric() {
            for c in ch.to_lowercase() {
                current.push(c);
            }
            has_alnum = true;
            continue;
        }

        if is_composite_separator(ch) {
            if current.is_empty() {
                if ch == '$' {
                    current.push(ch);
                    has_separator = true;
                    continue;
                }
                if is_valid_composite_token(&current, has_alnum, has_separator) {
                    tokens.insert(current.clone());
                }
                current.clear();
                has_separator = false;
                has_alnum = false;
                continue;
            }
            current.push(ch);
            has_separator = true;
            continue;
        }

        if is_valid_composite_token(&current, has_alnum, has_separator) {
            tokens.insert(current.clone());
        }
        current.clear();
        has_separator = false;
        has_alnum = false;
    }

    if is_valid_composite_token(&current, has_alnum, has_separator) {
        tokens.insert(current);
    }

    tokens
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

fn is_composite_separator(ch: char) -> bool {
    matches!(ch, '.' | '/' | '-' | '_' | '&' | '$' | '+' | ':')
}

fn is_valid_composite_token(token: &str, has_alnum: bool, has_separator: bool) -> bool {
    if token.len() < 2 {
        return false;
    }
    if !has_alnum || !has_separator {
        return false;
    }
    let starts_ok = token
        .chars()
        .next()
        .map(|ch| ch.is_alphanumeric() || ch == '$')
        .unwrap_or(false);
    let ends_ok = token
        .chars()
        .last()
        .map(|ch| ch.is_alphanumeric() || ch == '+')
        .unwrap_or(false);
    starts_ok && ends_ok
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
    fn extract_composite_tokens_basic() {
        let text = "app.mysite.com foo/bar slug-like a_b-c price$usd c++ proto:v1 $PATH";
        let tokens = extract_composite_tokens(text);
        assert!(tokens.contains("app.mysite.com"));
        assert!(tokens.contains("foo/bar"));
        assert!(tokens.contains("slug-like"));
        assert!(tokens.contains("a_b-c"));
        assert!(tokens.contains("price$usd"));
        assert!(tokens.contains("c++"));
        assert!(tokens.contains("proto:v1"));
        assert!(tokens.contains("$path"));
    }

    #[test]
    fn extract_composite_tokens_ignores_repeated_separators() {
        let text = "ok.good fine/path bad..token bad++token no::go";
        let tokens = extract_composite_tokens(text);
        assert!(tokens.contains("ok.good"));
        assert!(tokens.contains("fine/path"));
        assert!(tokens.contains("bad..token"));
        assert!(tokens.contains("bad++token"));
        assert!(tokens.contains("no::go"));
    }

    #[test]
    fn extract_composite_tokens_requires_alnum_edges() {
        let text = ".start end. mid-/dash $money";
        let tokens = extract_composite_tokens(text);
        assert!(!tokens.contains(".start"));
        assert!(!tokens.contains("end."));
        assert!(tokens.contains("mid-/dash"));
        assert!(tokens.contains("$money"));
    }

    #[test]
    fn tokenize_unicode_characters() {
        let tokens = tokenize("Über café naïve");
        assert!(tokens.contains(&"über".to_string()));
        assert!(tokens.contains(&"café".to_string()));
        assert!(tokens.contains(&"naïve".to_string()));
    }

    #[test]
    fn tokenize_very_long_token() {
        let long_token: String = "a".repeat(1000);
        let text = format!("hello {} world", long_token);
        let tokens = tokenize(&text);
        assert_eq!(tokens.len(), 3);
        assert!(tokens.contains(&long_token));
    }
}
