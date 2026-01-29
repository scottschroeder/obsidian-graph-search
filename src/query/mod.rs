use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct ParsedQuery {
    pub near_titles: Vec<String>,
    pub base_query: String,
}

#[derive(Debug, Serialize)]
pub struct NearSpan {
    pub start: usize,
    pub end: usize,
    pub text: String,
}

#[derive(Debug, Serialize)]
pub struct QueryLayout {
    pub near_spans: Vec<NearSpan>,
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
    let mut near_spans = Vec::new();

    let mut index = 0;
    while index < tokens.len() {
        let token = &tokens[index];
        if token.text.starts_with("near:") {
            let mut value = token.text[5..].to_string();
            let mut value_start = token.start + 5;
            let mut value_end = token.end;

            if value.is_empty() {
                if let Some(next) = tokens.get(index + 1) {
                    value = next.text.clone();
                    value_start = next.start;
                    value_end = next.end;
                    index += 1;
                }
            }

            if !value.is_empty() {
                let (cleaned, start, end) = strip_quotes_with_span(value, value_start, value_end);
                if !cleaned.is_empty() {
                    near_spans.push(NearSpan {
                        start,
                        end,
                        text: cleaned,
                    });
                }
            }
        }

        index += 1;
    }

    QueryLayout { near_spans }
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
        assert_eq!(layout.near_spans.len(), 1);
        let span = &layout.near_spans[0];
        assert_eq!(span.text, "my project");
        assert!(span.start < span.end);
    }
}
