//! Explicit, cited evidence attached to a thought. No model-written URL becomes a citation.
use crate::{
    world::{Change, World},
    Core,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Citation {
    pub title: String,
    pub url: String,
    pub start: usize,
    pub end: usize,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ResearchKept {
    pub id: String,
    pub owner: String,
    pub thought_id: String,
    pub quote: String,
    #[serde(default)]
    pub source_point: String,
    pub topic_id: String,
    pub topic_title: String,
    pub query: String,
    pub answer: String,
    pub citations: Vec<Citation>,
    pub at_ms: u64,
    pub model: String,
    pub simulated: bool,
    pub revision: u64,
    pub removed: bool,
    pub request_id: String,
}
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
pub struct Command {
    pub request_id: String,
    pub op: String,
    #[serde(default)]
    pub thought_id: String,
    #[serde(default)]
    pub quote: String,
    #[serde(default)]
    pub query: String,
    #[serde(default)]
    pub answer_id: String,
    #[serde(default)]
    pub revision: u64,
}
#[derive(Default)]
pub struct Session {
    pub on: bool,
    pub epoch: u64,
    pub busy: bool,
    pub preview: Option<ResearchKept>,
}
impl Session {
    pub fn invalidate(&mut self, on: bool) {
        self.on = on;
        self.epoch += 1;
        self.busy = false;
        self.preview = None;
    }
}
fn identity(id: &str) -> bool {
    !id.is_empty() && id.len() <= 100 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}
fn plain(s: &str, max: usize) -> bool {
    !s.trim().is_empty()
        && s.chars().count() <= max
        && !s.contains(['<', '>'])
        && !s
            .chars()
            .any(|c| c.is_control() && !matches!(c, '\n' | '\t'))
}
pub fn valid_citation(c: &Citation, answer: &str) -> bool {
    plain(&c.title, 240)
        && c.url.len() <= 2048
        && c.start < c.end
        && c.end <= answer.chars().count()
        && !c.url.chars().any(|c| c.is_control() || c.is_whitespace())
        && reqwest::Url::parse(&c.url).is_ok_and(|u| {
            u.scheme() == "https"
                && u.host_str().is_some()
                && u.username().is_empty()
                && u.password().is_none()
        })
}
/// Offsets are preserved across output_text blocks. Unsafe content is rejected rather than shifting spans.
pub fn parse(value: &Value) -> Result<(String, Vec<Citation>, String), &'static str> {
    if value
        .get("status")
        .and_then(Value::as_str)
        .is_some_and(|s| s != "completed")
    {
        return Err("No cited answer returned");
    }
    let mut answer = String::new();
    let mut citations = Vec::new();
    for item in value["output"]
        .as_array()
        .ok_or("No cited answer returned")?
    {
        if item["type"] != "message" {
            continue;
        }
        for block in item["content"]
            .as_array()
            .ok_or("No cited answer returned")?
        {
            if block["type"] == "refusal" {
                return Err("Provider declined this research request.");
            }
            if block["type"] != "output_text" {
                continue;
            }
            let text = block["text"].as_str().ok_or("No cited answer returned")?;
            let offset = answer.chars().count();
            answer.push_str(text);
            if let Some(rows) = block["annotations"].as_array() {
                for a in rows.iter().take(40) {
                    if a["type"] != "url_citation" {
                        continue;
                    }
                    let Some(start) = a["start_index"]
                        .as_u64()
                        .and_then(|v| usize::try_from(v).ok())
                    else {
                        continue;
                    };
                    let Some(end) = a["end_index"]
                        .as_u64()
                        .and_then(|v| usize::try_from(v).ok())
                    else {
                        continue;
                    };
                    let c = Citation {
                        title: a["title"].as_str().unwrap_or("").into(),
                        url: a["url"].as_str().unwrap_or("").into(),
                        start,
                        end,
                    };
                    if valid_citation(&c, text) {
                        citations.push(Citation {
                            start: offset + start,
                            end: offset + end,
                            ..c
                        });
                    }
                }
            }
        }
    }
    if !plain(&answer, 1200) || citations.is_empty() {
        return Err("No cited answer returned");
    }
    let model = value["model"]
        .as_str()
        .filter(|s| plain(s, 160))
        .unwrap_or("Meta Responses")
        .to_string();
    Ok((answer, citations, model))
}
pub fn source(w: &World, actor: &str, c: &Command) -> Result<ResearchKept, &'static str> {
    if !identity(&c.request_id) || !plain(&c.query, 400) {
        return Err("Use a research query of 1–400 characters.");
    }
    let thought = w
        .thoughts
        .iter()
        .find(|t| t.id == c.thought_id && t.placed && t.text == c.quote)
        .ok_or("Source changed or no longer on map. Select it again.")?;
    let thread = w
        .threads
        .iter()
        .find(|t| Some(&t.id) == thought.thread_id.as_ref())
        .ok_or("Source no longer on map.")?;
    Ok(ResearchKept {
        id: c.request_id.clone(),
        owner: actor.into(),
        thought_id: thought.id.clone(),
        quote: thought.text.clone(),
        source_point: thought.point.clone(),
        topic_id: thread.id.clone(),
        topic_title: thread.title.clone(),
        query: c.query.clone(),
        answer: String::new(),
        citations: vec![],
        at_ms: crate::now_ms(),
        model: String::new(),
        simulated: false,
        revision: 0,
        removed: false,
        request_id: String::new(),
    })
}
/// Only query and selected topic title enter the existing Meta client and counted budget path.
async fn provider(core: &Core, record: &ResearchKept) -> Result<(Value, bool), String> {
    #[cfg(debug_assertions)]
    if let Ok(path) = std::env::var("E2A2O_RESEARCH_FIXTURE") {
        core.spend()
            .map_err(|_| "Research budget unavailable.".to_string())?;
        let bytes = std::fs::read(path)
            .map_err(|_| "Simulated research fixture unavailable.".to_string())?;
        if bytes.len() > 65536 {
            return Err("Simulated research fixture too large.".into());
        }
        let value: Value = serde_json::from_slice(&bytes)
            .map_err(|_| "Simulated research fixture invalid.".to_string())?;
        tokio::time::sleep(std::time::Duration::from_millis(
            value["fixture_delay_ms"].as_u64().unwrap_or(0).min(2000),
        ))
        .await;
        return Ok((value, true));
    }
    // Verified against dev.meta.ai/docs/search-grounding and responses/schemas, 2026-11-04.
    let result = core.ask_model(&core.placer_model, "https://api.meta.ai/v1/responses", std::time::Duration::from_secs(45), |model| json!({
        "model": model, "store": false, "max_output_tokens": 1800, "max_tool_calls": 2,
        "tools": [{ "type": "web_search" }],
        "instructions": "Research the supplied query. Return at most 1200 characters of plain text with provider citation annotations. No HTML. If evidence is unavailable, decline.",
        "input": serde_json::to_string(&json!({ "query": record.query, "topic": record.topic_title })).unwrap()
    }), json!({"feature":"research"})).await.map_err(|_| "Research unavailable: offline, provider refused, key missing, or budget used. Your question and query are kept.".to_string())?;
    Ok((result, false))
}
pub async fn run(
    core: Arc<Core>,
    gate: Arc<Mutex<Session>>,
    mut record: ResearchKept,
    epoch: u64,
    target: String,
) {
    {
        let s = gate.lock().unwrap();
        if !s.on || s.epoch != epoch {
            return;
        }
    }
    let request_id = record.id.clone();
    let result = provider(&core, &record).await.and_then(|(v, simulated)| {
        let (answer, citations, model) = parse(&v).map_err(str::to_owned)?;
        record.answer = answer;
        record.citations = citations;
        record.model = model;
        record.simulated = simulated;
        Ok(record)
    });
    let mut s = gate.lock().unwrap();
    if !s.on || s.epoch != epoch {
        return;
    }
    s.busy = false;
    if let Ok(r) = &result {
        s.preview = Some(r.clone());
    }
    let (answer, message) = match result {
        Ok(r) => (
            Some(r),
            "Review the cited answer before keeping it.".to_string(),
        ),
        Err(e) => (None, e),
    };
    core.send_to(
        &target,
        crate::protocol::ServerMsg::ResearchResult {
            request_id,
            ok: answer.is_some(),
            message,
            answer,
            epoch,
        },
    );
}
pub fn mutate(
    core: &Core,
    gate: &Session,
    actor: &str,
    c: &Command,
) -> Result<ResearchKept, String> {
    if !gate.on || !identity(&c.request_id) {
        return Err("Research this question is off or the request identity is invalid.".into());
    }
    let w = core.snapshot();
    if let Some((request, record)) = w
        .research_receipts
        .get(&(actor.into(), c.request_id.clone()))
    {
        return if request == c {
            Ok(record.clone())
        } else {
            Err("Request identity already used.".into())
        };
    }
    let mut record = match c.op.as_str() {
        "keep" => {
            let r = gate
                .preview
                .as_ref()
                .filter(|r| r.id == c.answer_id)
                .ok_or("Research preview unavailable. Research again explicitly.")?;
            if w.research.iter().any(|old| old.id == r.id) {
                return Err("This answer was already kept.".into());
            }
            if w.research
                .iter()
                .filter(|r| r.owner == actor && !r.removed)
                .count()
                >= 30
            {
                return Err("Keep at most 30 answers. Remove an answer first.".into());
            }
            if !w.thoughts.iter().any(|t| {
                t.id == r.thought_id
                    && t.text == r.quote
                    && t.point == r.source_point
                    && t.placed
                    && t.thread_id.as_deref() == Some(&r.topic_id)
            }) || !w
                .threads
                .iter()
                .any(|t| t.id == r.topic_id && t.title == r.topic_title)
            {
                return Err("Source changed. Research again before keeping it.".into());
            }
            if !plain(&r.answer, 1200)
                || !plain(&r.query, 400)
                || r.citations.is_empty()
                || r.citations.iter().any(|c| !valid_citation(c, &r.answer))
            {
                return Err("No cited answer returned".into());
            }
            r.clone()
        }
        "remove" | "undo" => {
            let r = w
                .research
                .iter()
                .find(|r| r.id == c.answer_id && r.owner == actor)
                .ok_or("Saved answer unavailable.")?;
            if r.revision != c.revision || r.removed != (c.op == "undo") {
                return Err("Saved answer changed. Review its current state.".into());
            }
            if c.op == "undo"
                && w.research
                    .iter()
                    .filter(|r| r.owner == actor && !r.removed)
                    .count()
                    >= 30
            {
                return Err("Keep at most 30 answers.".into());
            }
            r.clone()
        }
        _ => return Err("Unknown research action.".into()),
    };
    let expected = record.revision;
    record.revision = expected.checked_add(1).ok_or("Revision limit reached.")?;
    record.removed = c.op == "remove";
    record.request_id = c.request_id.clone();
    let valid = |current: &World| {
        let same_source = c.op != "keep"
            || current.thoughts.iter().any(|t| {
                t.id == record.thought_id
                    && t.text == record.quote
                    && t.point == record.source_point
                    && t.placed
                    && t.thread_id.as_deref() == Some(&record.topic_id)
            }) && current
                .threads
                .iter()
                .any(|t| t.id == record.topic_id && t.title == record.topic_title);
        same_source
            && current
                .research
                .iter()
                .find(|r| r.id == record.id)
                .map_or(expected == 0, |r| r.revision == expected)
            && (record.removed
                || current
                    .research
                    .iter()
                    .filter(|r| r.owner == actor && !r.removed)
                    .count()
                    < 30)
            && !current
                .research_receipts
                .contains_key(&(actor.into(), c.request_id.clone()))
    };
    match core.try_commit_if(
        valid,
        vec![Change::ResearchKept {
            research: record.clone(),
            request: c.clone(),
        }],
    ) {
        Ok(true) => Ok(record),
        Ok(false) => Err("Saved answer or source changed. Review before retrying.".into()),
        Err(_) => Err("Save unconfirmed. Retry explicitly.".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    pub fn fixture() -> Value {
        json!({"model":"synthetic", "status":"completed", "output":[{"type":"message","content":[{"type":"output_text","text":"Open at nine.","annotations":[{"type":"url_citation","title":"Venue hours","url":"https://example.com/hours","start_index":0,"end_index":13}]}]}]})
    }
    #[test]
    fn c10_research_only_provider_annotations_and_safe_spans() {
        let v = fixture();
        let (answer, c, _) = parse(&v).unwrap();
        assert_eq!(c[0].end, answer.chars().count());
        let mut credential_url = reqwest::Url::parse("https://example.com").unwrap();
        credential_url.set_username("test-user").unwrap();
        credential_url.set_password(Some("test-password")).unwrap();
        for url in [
            "javascript:alert(1)",
            "http://example.com",
            credential_url.as_str(),
        ] {
            let mut v = v.clone();
            v["output"][0]["content"][0]["annotations"][0]["url"] = json!(url);
            assert!(parse(&v).is_err());
        }
        let mut v = v.clone();
        v["output"][0]["content"][0]["annotations"] = json!([]);
        assert!(parse(&v).is_err());
        let mut v = fixture();
        v["output"][0]["content"][0]["text"] = json!("<script>bad</script>");
        assert!(parse(&v).is_err());
        let mut v = fixture();
        v["output"][0]["content"][0]["annotations"][0]["end_index"] = json!(999);
        assert!(parse(&v).is_err());
    }
    #[test]
    fn c10_research_keep_remove_undo_owner_and_stale() {
        use crate::world::{
            fixtures::{thought, thread},
            Journal,
        };
        let path = std::env::temp_dir().join(format!("research-{}.jsonl", uuid::Uuid::new_v4()));
        let (journal, w) = Journal::open(&path).unwrap();
        let core = Core::test(journal, w);
        core.commit(vec![
            Change::ThreadAdded {
                thread: thread("T1", "Venue", 1),
            },
            Change::ThoughtAdded {
                thought: thought("p1", "T1", "When does it open?", 1),
            },
        ]);
        let run = Command {
            request_id: "run-one".into(),
            op: "run".into(),
            thought_id: "p1".into(),
            quote: "When does it open?".into(),
            query: "Venue hours".into(),
            ..Default::default()
        };
        let mut preview = source(&core.snapshot(), "you", &run).unwrap();
        let (a, c, m) = parse(&fixture()).unwrap();
        preview.answer = a;
        preview.citations = c;
        preview.model = m;
        preview.simulated = true;
        let gate = Session {
            on: true,
            preview: Some(preview),
            ..Default::default()
        };
        let keep = Command {
            request_id: "keep-one".into(),
            op: "keep".into(),
            answer_id: "run-one".into(),
            ..Default::default()
        };
        let kept = mutate(&core, &gate, "you", &keep).unwrap();
        assert_eq!(mutate(&core, &gate, "you", &keep).unwrap(), kept);
        let remove = Command {
            request_id: "remove-one".into(),
            op: "remove".into(),
            answer_id: kept.id.clone(),
            revision: 1,
            ..Default::default()
        };
        assert!(mutate(&core, &gate, "Colleague", &remove).is_err());
        let removed = mutate(&core, &gate, "you", &remove).unwrap();
        assert!(removed.removed);
        let undo = Command {
            request_id: "undo-one".into(),
            op: "undo".into(),
            revision: 2,
            ..remove.clone()
        };
        assert!(!mutate(&core, &gate, "you", &undo).unwrap().removed);
        assert!(mutate(
            &core,
            &gate,
            "you",
            &Command {
                request_id: "stale-one".into(),
                ..remove
            }
        )
        .is_err());
        drop(core);
        let (_, w) = Journal::open(&path).unwrap();
        assert_eq!(w.research[0].revision, 3);
        assert_eq!(w.research[0].quote, "When does it open?");
        let journal = Journal::read_only(&path).unwrap();
        let broken = Core::test(journal, w.clone());
        assert!(mutate(
            &broken,
            &gate,
            "you",
            &Command {
                request_id: "failed-write".into(),
                op: "remove".into(),
                answer_id: "run-one".into(),
                revision: 3,
                ..Default::default()
            }
        )
        .is_err());
        assert_eq!(broken.snapshot().research[0].revision, 3);
        let mut capped = w;
        let seed = capped.research[0].clone();
        capped.research = (0..30)
            .map(|i| ResearchKept {
                id: format!("cap-{i}"),
                ..seed.clone()
            })
            .collect();
        let (journal, _) = Journal::open(&path).unwrap();
        let capped = Core::test(journal, capped);
        assert!(mutate(
            &capped,
            &gate,
            "you",
            &Command {
                request_id: "over-cap".into(),
                ..keep
            }
        )
        .unwrap_err()
        .contains("30"));
    }
}
