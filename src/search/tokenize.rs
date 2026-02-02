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
    let mut buffer = CompositeBuffer::new();

    for ch in text.chars() {
        if ch.is_alphanumeric() {
            buffer.push_alphanumeric(ch);
            continue;
        }

        if is_composite_separator(ch) {
            buffer.push_separator(ch, &mut tokens);
            continue;
        }

        buffer.flush(&mut tokens);
    }

    buffer.flush(&mut tokens);

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

struct CompositeBuffer {
    token: String,
    segment_ranges: Vec<(usize, usize)>,
    segment_start: Option<usize>,
    has_separator: bool,
    has_alphanumeric: bool,
}

impl CompositeBuffer {
    fn new() -> Self {
        Self {
            token: String::new(),
            segment_ranges: Vec::new(),
            segment_start: None,
            has_separator: false,
            has_alphanumeric: false,
        }
    }

    fn push_alphanumeric(&mut self, ch: char) {
        if self.segment_start.is_none() {
            self.segment_start = Some(self.token.len());
        }
        append_lowercase(&mut self.token, ch);
        self.has_alphanumeric = true;
    }

    fn push_separator(&mut self, ch: char, tokens: &mut HashSet<String>) {
        if self.token.is_empty() {
            if is_prefix_separator(ch) {
                self.token.push(ch);
                self.has_separator = true;
            } else {
                self.flush(tokens);
            }
            return;
        }

        self.close_segment();
        self.token.push(ch);
        self.has_separator = true;
    }

    fn close_segment(&mut self) {
        if let Some(start) = self.segment_start.take() {
            let end = self.token.len();
            if end > start {
                self.segment_ranges.push((start, end));
            }
        }
    }

    fn flush(&mut self, tokens: &mut HashSet<String>) {
        self.close_segment();
        add_composite_token_if_valid_with_segments(
            tokens,
            &self.token,
            &self.segment_ranges,
            self.has_alphanumeric,
            self.has_separator,
        );
        self.reset();
    }

    fn reset(&mut self) {
        self.token.clear();
        self.segment_ranges.clear();
        self.segment_start = None;
        self.has_separator = false;
        self.has_alphanumeric = false;
    }
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

fn add_composite_token_if_valid_with_segments(
    tokens: &mut HashSet<String>,
    token: &str,
    segment_ranges: &[(usize, usize)],
    has_alnum: bool,
    has_separator: bool,
) {
    if is_valid_composite_token(token, has_alnum, has_separator) {
        add_composite_token_variants(tokens, token, segment_ranges);
    }
}

fn add_composite_token_variants(
    tokens: &mut HashSet<String>,
    token: &str,
    segment_ranges: &[(usize, usize)],
) {
    tokens.insert(token.to_string());
    add_composite_segments_from_ranges(tokens, token, segment_ranges);
    add_composite_suffixes_from_ranges(tokens, token, segment_ranges);
}

fn add_composite_segments_from_ranges(
    tokens: &mut HashSet<String>,
    token: &str,
    segment_ranges: &[(usize, usize)],
) {
    for (start, end) in segment_ranges {
        if end > start {
            tokens.insert(token[*start..*end].to_string());
        }
    }
}

fn add_composite_suffixes_from_ranges(
    tokens: &mut HashSet<String>,
    token: &str,
    segment_ranges: &[(usize, usize)],
) {
    if segment_ranges.len() < 2 {
        return;
    }
    for idx in 1..segment_ranges.len() - 1 {
        let start = segment_ranges[idx].0;
        let suffix = &token[start..];
        if suffix.len() < 2 {
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
    fn extract_composite_tokens_unicode_segments() {
        let tokens = extract_composite_tokens("Über/naïve:кофе");
        assert!(tokens.contains("über/naïve:кофе"));
        assert!(tokens.contains("über"));
        assert!(tokens.contains("naïve"));
        assert!(tokens.contains("кофе"));
        assert!(tokens.contains("naïve:кофе"));
    }

    #[test]
    fn extract_composite_tokens_unicode_lowercase_expansion() {
        let tokens = extract_composite_tokens("İstanbul/ßeta");
        assert!(tokens.contains("i̇stanbul/ßeta"));
        assert!(tokens.contains("i̇stanbul"));
        assert!(tokens.contains("ßeta"));
    }

    #[test]
    fn extract_composite_tokens_repeated_separator_suffixes() {
        let tokens = extract_composite_tokens("a..b--c__d");
        assert!(tokens.contains("a..b--c__d"));
        assert!(tokens.contains("b--c__d"));
        assert!(tokens.contains("c__d"));
    }

    #[test]
    fn extract_composite_tokens_rejects_trailing_separator() {
        let tokens = extract_composite_tokens("path/to/");
        assert!(tokens.is_empty());
    }

    #[test]
    fn extract_composite_tokens_requires_separator() {
        let tokens = extract_composite_tokens("naïve");
        assert!(tokens.is_empty());
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
