use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct ParsedQuery {
    pub near_titles: Vec<String>,
    pub base_query: String,
}

#[derive(Debug, Serialize)]
pub struct QuerySpan {
    pub start: usize,
    pub end: usize,
    pub text: String,
    pub prefix: String,
}

#[derive(Debug, Serialize)]
pub struct QueryLayout {
    pub spans: Vec<QuerySpan>,
}

pub fn parse_query(raw: &str) -> ParsedQuery {
    let tokens = tokenize(raw);
    let mut near_titles = Vec::new();
    let mut base_tokens = Vec::new();

    let mut index = 0;
    while index < tokens.len() {
        let token = &tokens[index];
        if token.starts_with("near:") {
            let mut value = token[5..].to_string();
            if value.is_empty() {
                if let Some(next) = tokens.get(index + 1) {
                    value = next.clone();
                    index += 1;
                }
            }
            let cleaned = strip_quotes(value);
            if !cleaned.is_empty() {
                near_titles.push(cleaned);
            }
        } else {
            base_tokens.push(token.clone());
        }

        index += 1;
    }

    ParsedQuery {
        near_titles,
        base_query: base_tokens.join(" "),
    }
}

pub fn parse_query_layout(raw: &str) -> QueryLayout {
    let tokens = tokenize_with_spans(raw);
    let mut spans = Vec::new();

    let mut index = 0;
    while index < tokens.len() {
        let token = &tokens[index];
        if token.text.starts_with("near:") {
            if let Some(span) = build_span(&tokens, index, "near:") {
                spans.push(span);
                if token.text == "near:" {
                    index += 1;
                }
            }
        } else if token.text.starts_with("tag:") {
            if let Some(span) = build_span(&tokens, index, "tag:") {
                spans.push(span);
                if token.text == "tag:" {
                    index += 1;
                }
            }
        }

        index += 1;
    }

    QueryLayout { spans }
}

fn build_span(tokens: &[TokenSpan], index: usize, prefix: &str) -> Option<QuerySpan> {
    let token = tokens.get(index)?;
    let prefix_len = prefix.len();
    let mut value = token.text[prefix_len..].to_string();
    let mut value_start = token.start + prefix_len;
    let mut value_end = token.end;

    if value.is_empty() {
        if let Some(next) = tokens.get(index + 1) {
            value = next.text.clone();
            value_start = next.start;
            value_end = next.end;
        }
    }

    if value.is_empty() {
        return None;
    }

    let (cleaned, start, end) = strip_quotes_with_span(value, value_start, value_end);
    if cleaned.is_empty() {
        return None;
    }

    Some(QuerySpan {
        start,
        end,
        text: cleaned,
        prefix: prefix.to_string(),
    })
}

fn strip_quotes(value: String) -> String {
    let trimmed = value.trim();
    if trimmed.len() >= 2 && trimmed.starts_with('"') && trimmed.ends_with('"') {
        trimmed[1..trimmed.len() - 1].to_string()
    } else {
        trimmed.to_string()
    }
}

fn strip_quotes_with_span(value: String, start: usize, end: usize) -> (String, usize, usize) {
    let trimmed = value.trim();
    if trimmed.len() >= 2 && trimmed.starts_with('"') && trimmed.ends_with('"') {
        let offset_start = value.find('"').unwrap_or(0);
        let offset_end = value.rfind('"').unwrap_or(value.len().saturating_sub(1));
        let new_start = start + offset_start + 1;
        let new_end = start + offset_end;
        let cleaned = trimmed[1..trimmed.len() - 1].to_string();
        (cleaned, new_start, new_end)
    } else {
        (trimmed.to_string(), start, end)
    }
}

fn tokenize(raw: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;

    for ch in raw.chars() {
        if ch == '"' {
            in_quotes = !in_quotes;
            current.push(ch);
            continue;
        }

        if ch.is_whitespace() && !in_quotes {
            if !current.is_empty() {
                tokens.push(current);
                current = String::new();
            }
            continue;
        }

        current.push(ch);
    }

    if !current.is_empty() {
        tokens.push(current);
    }

    tokens
}

#[derive(Debug)]
struct TokenSpan {
    text: String,
    start: usize,
    end: usize,
}

fn tokenize_with_spans(raw: &str) -> Vec<TokenSpan> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    let mut start = None;

    for (idx, ch) in raw.char_indices() {
        if ch == '"' {
            in_quotes = !in_quotes;
            if start.is_none() {
                start = Some(idx);
            }
            current.push(ch);
            continue;
        }

        if ch.is_whitespace() && !in_quotes {
            if let Some(token_start) = start.take() {
                if !current.is_empty() {
                    tokens.push(TokenSpan {
                        text: current.clone(),
                        start: token_start,
                        end: idx,
                    });
                    current.clear();
                }
            }
            continue;
        }

        if start.is_none() {
            start = Some(idx);
        }
        current.push(ch);
    }

    if let Some(token_start) = start {
        if !current.is_empty() {
            tokens.push(TokenSpan {
                text: current,
                start: token_start,
                end: raw.len(),
            });
        }
    }

    tokens
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_query_extracts_near_titles() {
        let parsed = parse_query("budget tag:#meeting near:bob near:myproject");
        assert_eq!(parsed.near_titles, vec!["bob", "myproject"]);
        assert_eq!(parsed.base_query, "budget tag:#meeting");
    }

    #[test]
    fn parse_query_handles_quoted_near() {
        let parsed = parse_query("near:\"my project\" status");
        assert_eq!(parsed.near_titles, vec!["my project"]);
        assert_eq!(parsed.base_query, "status");
    }

    #[test]
    fn parse_query_handles_separate_near_value() {
        let parsed = parse_query("near: bob status");
        assert_eq!(parsed.near_titles, vec!["bob"]);
        assert_eq!(parsed.base_query, "status");
    }

    #[test]
    fn parse_query_layout_tracks_spans() {
        let layout = parse_query_layout("tag:#meeting near:\"my project\" notes");
        assert_eq!(layout.spans.len(), 2);
        let near_span = layout
            .spans
            .iter()
            .find(|span| span.prefix == "near:")
            .expect("missing near span");
        assert_eq!(near_span.text, "my project");
        assert!(near_span.start < near_span.end);
        let tag_span = layout
            .spans
            .iter()
            .find(|span| span.prefix == "tag:")
            .expect("missing tag span");
        assert_eq!(tag_span.text, "#meeting");
    }
}
