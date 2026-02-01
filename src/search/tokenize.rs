use std::collections::HashSet;

pub(crate) fn tokenize(text: &str) -> HashSet<String> {
    let mut tokens = HashSet::new();
    let mut current = String::new();

    for ch in text.chars() {
        if is_token_char(ch, current.is_empty()) {
            append_lowercase(&mut current, ch);
        } else if !current.is_empty() {
            tokens.insert(current);
            current = String::new();
        }
    }

    if !current.is_empty() {
        tokens.insert(current);
    }

    tokens
}

pub(crate) fn extract_composite_tokens(text: &str) -> HashSet<String> {
    let mut tokens = HashSet::new();
    let mut current = String::new();
    let mut has_separator = false;
    let mut has_alphanumeric = false;

    for ch in text.chars() {
        if ch.is_alphanumeric() {
            append_lowercase(&mut current, ch);
            has_alphanumeric = true;
            continue;
        }

        if is_composite_separator(ch) {
            handle_composite_separator(
                ch,
                &mut current,
                &mut has_separator,
                &mut has_alphanumeric,
                &mut tokens,
            );
            continue;
        }

        flush_composite_token(
            &mut tokens,
            &mut current,
            &mut has_alphanumeric,
            &mut has_separator,
        );
    }

    flush_composite_token(
        &mut tokens,
        &mut current,
        &mut has_alphanumeric,
        &mut has_separator,
    );

    tokens
}

fn append_lowercase(buffer: &mut String, ch: char) {
    for c in ch.to_lowercase() {
        buffer.push(c);
    }
}

fn is_token_char(ch: char, is_start: bool) -> bool {
    if ch.is_alphanumeric() || ch == '_' || ch == '-' || ch == '/' {
        return true;
    }
    ch == '#' && is_start
}

fn is_composite_separator(ch: char) -> bool {
    is_infix_separator(ch) || is_prefix_separator(ch)
}

fn is_infix_separator(ch: char) -> bool {
    matches!(ch, '.' | '/' | '-' | '_' | '&' | '+' | ':')
}

fn is_prefix_separator(ch: char) -> bool {
    matches!(ch, '$' | '/')
}

fn handle_composite_separator(
    ch: char,
    current: &mut String,
    has_separator: &mut bool,
    has_alphanumeric: &mut bool,
    tokens: &mut HashSet<String>,
) {
    if current.is_empty() {
        if is_prefix_separator(ch) {
            current.push(ch);
            *has_separator = true;
        } else {
            flush_composite_token(tokens, current, has_alphanumeric, has_separator);
        }
        return;
    }
    current.push(ch);
    *has_separator = true;
}

fn flush_composite_token(
    tokens: &mut HashSet<String>,
    current: &mut String,
    has_alphanumeric: &mut bool,
    has_separator: &mut bool,
) {
    add_composite_token_if_valid(tokens, current, *has_alphanumeric, *has_separator);
    current.clear();
    *has_separator = false;
    *has_alphanumeric = false;
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
        .map(|ch| ch.is_alphanumeric() || is_prefix_separator(ch))
        .unwrap_or(false);
    let ends_ok = token
        .chars()
        .last()
        .map(|ch| ch.is_alphanumeric() || ch == '+')
        .unwrap_or(false);
    starts_ok && ends_ok
}

fn add_composite_token_if_valid(
    tokens: &mut HashSet<String>,
    token: &str,
    has_alnum: bool,
    has_separator: bool,
) {
    if is_valid_composite_token(token, has_alnum, has_separator) {
        add_composite_token_variants(tokens, token);
    }
}

fn add_composite_token_variants(tokens: &mut HashSet<String>, token: &str) {
    tokens.insert(token.to_string());
    add_composite_segments(tokens, token);
    add_composite_suffixes(tokens, token);
}

fn add_composite_segments(tokens: &mut HashSet<String>, token: &str) {
    let mut current = String::new();
    for ch in token.chars() {
        if is_composite_separator(ch) {
            if !current.is_empty() {
                tokens.insert(current.clone());
                current.clear();
            }
            continue;
        }
        current.push(ch);
    }
    if !current.is_empty() {
        tokens.insert(current);
    }
}

fn add_composite_suffixes(tokens: &mut HashSet<String>, token: &str) {
    let mut starts = Vec::new();
    let mut prev_is_sep = true;
    for (idx, ch) in token.char_indices() {
        let is_sep = is_composite_separator(ch);
        if !is_sep && prev_is_sep {
            starts.push(idx);
        }
        prev_is_sep = is_sep;
    }
    for start in starts.iter().skip(1) {
        let suffix = &token[*start..];
        if suffix.len() < 2 {
            continue;
        }
        if !suffix.chars().any(is_composite_separator) {
            continue;
        }
        tokens.insert(suffix.to_string());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokenize_basic_words() {
        let tokens = tokenize("Budget for Q3 meeting");
        let expected: HashSet<String> = ["budget", "for", "q3", "meeting"]
            .iter()
            .copied()
            .map(String::from)
            .collect();
        assert_eq!(tokens, expected);
    }

    #[test]
    fn tokenize_tags_and_paths() {
        let tokens = tokenize("tag:#meeting path/to/file");
        assert!(tokens.contains("tag"));
        assert!(tokens.contains("#meeting"));
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
    fn extract_composite_tokens_adds_subsections() {
        let tokens = extract_composite_tokens("/v1/health:check");
        assert!(tokens.contains("/v1/health:check"));
        assert!(tokens.contains("health:check"));
        assert!(tokens.contains("health"));
        assert!(tokens.contains("check"));
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
        assert!(tokens.contains("über"));
        assert!(tokens.contains("café"));
        assert!(tokens.contains("naïve"));
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
