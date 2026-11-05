//! Admission validation for the browser's dictation-breakdown/v1 source spans.
//! Offsets count Unicode scalar values, with an exclusive end. Host transport and
//! module registration remain outside this module; no queue or capture side effects.

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceSpan {
    pub start: usize,
    pub end: usize,
    pub text: String,
}

pub fn validate_source_spans(source: &str, spans: &[SourceSpan]) -> Result<(), &'static str> {
    let chars: Vec<char> = source.chars().collect();
    let mut expected = 0;
    for span in spans {
        validate_span(&chars, span, expected)?;
        expected = span.end;
    }
    if expected != chars.len() { return Err("source text is missing"); }
    Ok(())
}

fn validate_span(chars: &[char], span: &SourceSpan, expected: usize) -> Result<(), &'static str> {
    if span.start != expected || span.end <= span.start || span.end > chars.len() {
        return Err("source ranges must form an ordered partition");
    }
    let text: String = chars[span.start..span.end].iter().collect();
    if text != span.text { return Err("source text does not match range"); }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn span(start: usize, end: usize, text: &str) -> SourceSpan {
        SourceSpan { start, end, text: text.into() }
    }
    #[test]
    fn unicode_and_aside_are_retained() {
        assert_eq!(validate_source_spans("🌱 go. aside", &[span(0, 6, "🌱 go. "), span(6, 11, "aside")]), Ok(()));
    }
    #[test]
    fn missing_overlapping_and_changed_source_are_refused() {
        assert!(validate_source_spans("abc", &[span(0, 2, "ab")]).is_err());
        assert!(validate_source_spans("abc", &[span(0, 2, "ab"), span(1, 3, "bc")]).is_err());
        assert!(validate_source_spans("abc", &[span(0, 3, "xyz")]).is_err());
    }
    #[test]
    fn invalid_ranges_do_not_panic() {
        assert!(validate_source_spans("abc", &[span(0, usize::MAX, "abc")]).is_err());
        assert!(validate_source_spans("abc", &[span(0, 0, "")]).is_err());
        assert_eq!(validate_source_spans("", &[]), Ok(()));
    }
}
