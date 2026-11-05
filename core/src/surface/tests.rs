use super::*;
use axum::http::StatusCode;
use futures_util::StreamExt;
use serde_json::json;

const LOCAL_TOOLS: &[(&str, &str)] = &[
    ("GET", "/build-id"), ("POST", "/build-activity"),
    ("GET", "/code-canvas/snapshot"), ("GET", "/code-canvas/events"), ("POST", "/code-canvas/answer"),
    ("GET", "/workshop/turns?name=Example"), ("GET", "/workshop/catalog"),
    ("POST", "/workshop/run"), ("GET", "/workshop/hackathon"),
    ("POST", "/crew/plan"), ("POST", "/crew/build"),
    ("POST", "/crew/merge"), ("POST", "/crew/promote"),
    ("GET", "/bricks.html"), ("GET", "/src/example.html"), ("GET", "/%73rc/example.html"),
    ("GET", "/bricks%2ehtml"), ("POST", "/__mechanics/release"),
];

struct Site {
    url: String,
    server: tokio::task::JoinHandle<()>,
}
impl Drop for Site { fn drop(&mut self) { self.server.abort(); } }
impl Site {
    async fn start(policy: Policy) -> Self {
        let dir = std::env::temp_dir().join(format!("surface-check-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(dir.join("images")).unwrap();
        std::fs::write(dir.join("index.html"), "<p>Clearly labelled example map</p>").unwrap();
        std::fs::write(dir.join(".env"), "synthetic private fixture").unwrap();
        std::fs::write(dir.join("images/example.webp"), "example image").unwrap();
        let _ = crate::DATA_DIR.set(dir.to_string_lossy().into_owned());
        let (journal, world) = crate::world::Journal::open(&dir.join("journal.jsonl")).unwrap();
        let mut core = Core::test(journal, world);
        core.key = None;
        let app = router(Arc::new(core), &dir, &dir.join("images"), policy);
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            axum::serve(listener, app.into_make_service_with_connect_info::<Link>()).await.unwrap();
        });
        Self { url, server }
    }
}

#[tokio::test]
async fn surface_host_and_origin_reject_foreign_sites() {
    let site = Site::start(Policy::default()).await;
    let client = reqwest::Client::new();
    for (header, value) in [("host", "example.com"), ("origin", "https://example.com"), ("origin", "http://localhost:1")] {
        assert_eq!(client.get(&site.url).header(header, value).send().await.unwrap().status(), StatusCode::FORBIDDEN);
    }
    assert_eq!(client.get(&site.url).header("origin", &site.url).send().await.unwrap().status(), StatusCode::OK);
}

#[tokio::test]
async fn surface_default_and_hosted_hide_local_tools_before_reading_bodies() {
    let client = reqwest::Client::new();
    for policy in [Policy::default(), Policy { hosted: true, development: true, canvas: true }] {
        let site = Site::start(policy).await;
        for &(method, path) in LOCAL_TOOLS {
            let response = client.request(method.parse().unwrap(), format!("{}{path}", site.url))
                .header("content-type", "application/json").body("invalid JSON").send().await.unwrap();
            assert_eq!(response.status(), StatusCode::NOT_FOUND, "{method} {path}");
        }
        let page = client.get(&site.url).send().await.unwrap();
        assert_eq!(page.status(), StatusCode::OK);
        assert!(page.text().await.unwrap().contains("example map"));
        assert_eq!(client.get(format!("{}/room", site.url)).send().await.unwrap().status(), StatusCode::OK);
        let (mut ws, _) = tokio_tungstenite::connect_async(site.url.replacen("http", "ws", 1) + "/ws?identity=1").await.unwrap();
        assert!(ws.next().await.unwrap().unwrap().is_text());
        ws.close(None).await.unwrap();
    }
}

#[tokio::test]
async fn surface_opt_in_and_request_limits_preserve_the_product() {
    let client = reqwest::Client::new();
    let site = Site::start(Policy { development: true, ..Policy::default() }).await;
    for path in ["/build-id", "/workshop/catalog"] {
        assert_eq!(client.get(format!("{}{path}", site.url)).send().await.unwrap().status(), StatusCode::OK);
    }
    let response = client.post(format!("{}/draw/read", site.url))
        .json(&json!({"sketch":"not an image","labels":[],"said":"Example"})).send().await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.json::<serde_json::Value>().await.unwrap()["error"], "That drawing can't be read.");
    let response = client.post(format!("{}/clarify", site.url)).header("content-type", "application/json")
        .body(" ".repeat(JSON_BYTES + 1)).send().await.unwrap();
    assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
    for path in ["/.env", "/images/%2eenv", "/images/%5cprivate", "/images/%00private"] {
        assert_eq!(client.get(format!("{}{path}", site.url)).send().await.unwrap().status(), StatusCode::NOT_FOUND, "{path}");
    }
    assert_eq!(client.get(format!("{}/images/example.webp", site.url)).send().await.unwrap().text().await.unwrap(), "example image");
}

#[test]
fn surface_paths_and_tool_admission() {
    for path in ["/", "/assets/index-a1.js", "/flow/run", "/images/example.webp"] { assert!(request_path(path).is_some()); }
    for path in ["/.env", "/images/../secret", "/images/%2e%2e/secret", "/images/%2Eenv", "/images/%2f.env", "/bad%", "/bad%gg", "/images/%5csecret", "/bad%00"] { assert!(request_path(path).is_none(), "{path}"); }
    let local = Link { from: "127.0.0.1:50000".parse().unwrap(), to: "127.0.0.1:50001".parse().unwrap(), tls: false };
    let remote = Link { from: "192.0.2.1:50000".parse().unwrap(), ..local };
    let enabled = Policy { development: true, canvas: true, hosted: false };
    assert!(enabled.allows("/code-canvas/snapshot", local));
    for &(_, path) in LOCAL_TOOLS {
        let path = request_path(path.split('?').next().unwrap()).unwrap();
        assert!(!enabled.allows(&path, remote), "{path}");
    }
}

#[test]
fn surface_credentials_never_escape_provider_results_or_split_deltas() {
    let key = "synthetic-surface-credential";
    let mut value = json!({key: [format!("Bearer {key}"), {"answer":key}], "count":3});
    crate::secrets::value(&mut value, Some(key));
    assert!(!value.to_string().contains(key));
    assert_eq!(value["count"], 3);
    let failure = crate::secrets::result(Err(anyhow::anyhow!("provider echoed {key}")), Some(key)).unwrap_err();
    assert_eq!(failure.to_string(), "provider echoed [redacted]");
    let refusal = crate::secrets::error(crate::model::Verdict::Refused.into(), Some(key));
    assert_eq!(crate::model::Verdict::of(&refusal), Some(crate::model::Verdict::Refused));
    for split in 0..=key.len() {
        let mut stream = crate::secrets::Stream::new(Some(key));
        let mut output = stream.push(&format!("Hello {}", &key[..split]));
        output.push_str(&stream.push(&format!("{} world", &key[split..])));
        output.push_str(&stream.finish());
        assert_eq!(output, "Hello [redacted] world", "split {split}");
    }
    let mut stream = crate::secrets::Stream::new(Some(key));
    assert_eq!(stream.push("Normal words arrive immediately."), "Normal words arrive immediately.");
}

#[test]
fn surface_generated_parts_accept_only_bounded_known_blocks() {
    assert!(crate::crew::sound_spec(&json!({"title":"Example","blocks":[{"kind":"line","text":"Hello"}]})).is_ok());
    assert!(crate::crew::sound_spec(&json!({"title":"Example","blocks":[{"kind":"html","text":"<script>example</script>"}]})).is_err());
    assert!(crate::crew::sound_spec(&json!({"title":"Example","blocks":[{"kind":"line","text":"x".repeat(24001)}]})).is_err());
}
