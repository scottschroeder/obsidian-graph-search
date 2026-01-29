use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct ParsedQuery {
    pub near_titles: Vec<String>,
    pub base_query: String,
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

fn strip_quotes(value: String) -> String {
    let trimmed = value.trim();
    if trimmed.len() >= 2 && trimmed.starts_with('"') && trimmed.ends_with('"') {
        trimmed[1..trimmed.len() - 1].to_string()
    } else {
        trimmed.to_string()
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
}
