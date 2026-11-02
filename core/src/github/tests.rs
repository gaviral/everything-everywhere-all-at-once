//! Tests for the GitHub card (github.rs). Every one stands in for `gh`, so none reaches GitHub; the repos and pull
//! requests are made up.

use super::*;
use crate::messages::{Preset, Runtime as Messages, Settings as MessageSettings};
use crate::protocol::Outgoing;
use crate::world::{Journal, World};
use tokio::sync::broadcast::Receiver;

type Calls = Arc<Mutex<Vec<Vec<String>>>>;

struct Fixture {
    core: Arc<Core>,
    calls: Calls,
    out: Receiver<Outgoing>,
    path: std::path::PathBuf,
}

/// A stand-in for `gh`: it writes down each call, and answers with `answer`'s reply to it.
fn stand_in(calls: Calls, answer: impl Fn(&[String]) -> Result<String, Failure> + Send + Sync + 'static) -> Gh {
    let answer = Arc::new(answer);
    Arc::new(move |args| {
        calls.lock().unwrap().push(args.clone());
        let reply = answer(&args);
        Box::pin(async move { reply })
    })
}

impl Fixture {
    fn new(preset: Preset, settings: Settings, answer: impl Fn(&[String]) -> Result<String, Failure> + Send + Sync + 'static) -> Self {
        Self::with(preset, settings, answer, |core| core)
    }

    fn with(
        preset: Preset,
        settings: Settings,
        answer: impl Fn(&[String]) -> Result<String, Failure> + Send + Sync + 'static,
        adjust: impl FnOnce(Core) -> Core,
    ) -> Self {
        let calls: Calls = Arc::default();
        Self::gh(preset, settings, stand_in(calls.clone(), answer), calls, adjust)
    }

    fn gh(preset: Preset, settings: Settings, gh: Gh, calls: Calls, adjust: impl FnOnce(Core) -> Core) -> Self {
        let path = std::env::temp_dir().join(format!("e2a2o-github-{}.jsonl", uuid::Uuid::new_v4()));
        let (journal, _) = Journal::open(&path).unwrap();
        let messages = Messages::with(MessageSettings { preset, ..Default::default() }, Arc::new(|_, _| Box::pin(async { Err("no sending in tests".into()) })));
        let core = Arc::new(adjust(Core { messages, github: Runtime::with(settings, gh), ..Core::test(journal, World::default()) }));
        let out = core.updates.subscribe();
        Self { core, calls, out, path }
    }

    /// The cards and notices sent since last asked, as short lines.
    fn told(&mut self) -> Vec<String> {
        std::iter::from_fn(|| self.out.try_recv().ok())
            .filter_map(|o| match o.message {
                ServerMsg::PullsCard { title, repo, state, pulls, more, message, .. } => {
                    let rows: Vec<String> = pulls.iter().map(|p| format!("#{} {} {:?} {:?} {}/{}", p.number, p.title, p.state, p.checks, p.failing, p.total)).collect();
                    let parts = [format!("card {state:?} {title} [{repo}]"), rows.join("; "), format!("more {more}"), message];
                    Some(parts.into_iter().filter(|p| !p.is_empty()).collect::<Vec<_>>().join(" "))
                }
                ServerMsg::Notice { message } => Some(format!("notice {message}")),
                _ => None,
            })
            .collect()
    }

    fn calls(&self) -> Vec<Vec<String>> {
        self.calls.lock().unwrap().clone()
    }

    fn thoughts(&self) -> Vec<String> {
        self.core.snapshot().thoughts.iter().map(|t| t.text.clone()).collect()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

async fn settle() {
    for _ in 0..20 {
        tokio::task::yield_now().await;
    }
}

const PULLS: &str = r#"[
  {"number": 42, "title": "Water the raised beds on a schedule", "state": "OPEN", "isDraft": false, "updatedAt": "2026-11-01T18:00:00Z",
   "url": "https://github.com/acme/garden-planner/pull/42",
   "statusCheckRollup": [{"__typename": "CheckRun", "status": "COMPLETED", "conclusion": "SUCCESS"}, {"__typename": "StatusContext", "state": "SUCCESS"}]},
  {"number": 41, "title": "Frost dates for the north beds", "state": "OPEN", "isDraft": true, "updatedAt": "2026-10-31T09:00:00Z",
   "url": "https://github.com/acme/garden-planner/pull/41",
   "statusCheckRollup": [{"__typename": "CheckRun", "status": "COMPLETED", "conclusion": "FAILURE"}, {"__typename": "CheckRun", "status": "COMPLETED", "conclusion": "SUCCESS"}]},
  {"number": 39, "title": "Seed list export", "state": "OPEN", "isDraft": false, "updatedAt": "2026-10-30T09:00:00Z",
   "url": "https://github.com/acme/garden-planner/pull/39",
   "statusCheckRollup": [{"__typename": "CheckRun", "status": "IN_PROGRESS", "conclusion": ""}]},
  {"number": 37, "title": "Compost reminders", "state": "OPEN", "isDraft": false, "updatedAt": "2026-10-29T09:00:00Z",
   "url": "https://github.com/acme/garden-planner/pull/37", "statusCheckRollup": []}
]"#;

fn listing(args: &[String]) -> Result<String, Failure> {
    match args.get(1).map(String::as_str) {
        Some("list") => Ok(PULLS.into()),
        Some("view") => Ok(r#"{"number": 7, "title": "Rename beds", "state": "MERGED", "isDraft": false, "updatedAt": "2026-10-01T00:00:00Z", "url": "https://github.com/acme/garden-planner/pull/7", "statusCheckRollup": null}"#.into()),
        _ => Ok("pat-example\n".into()),
    }
}

fn args(list: &[&str]) -> Vec<String> {
    list.iter().map(|s| s.to_string()).collect()
}

#[test]
fn requests_for_pull_requests_read_as_one_and_to_dos_about_them_stay_thoughts() {
    let open = |repo: Option<&str>| Some(Ask { which: Which::Open, repo: repo.map(String::from) });
    for said in [
        "Show me the open pull requests",
        "show me the PRs",
        "Okay, can you show me my open PRs please?",
        "What's happening with that PR?",
        "What PRs are open?",
        "Any open PRs?",
        "List the pull requests",
        "Pull up the open PRs on GitHub",
        "Show me the pull requests for this app",
        "Show me the open pull requests in this repo",
    ] {
        assert_eq!(read(said), open(None), "{said}");
    }
    assert_eq!(read("Show me the open pull requests in acme/garden-planner"), open(Some("acme/garden-planner")));
    assert_eq!(read("Any PRs on the garden planner repo?"), open(Some("garden planner")));
    assert_eq!(read("show me the PRs in acme slash garden-planner"), open(Some("acme slash garden-planner")));
    assert_eq!(read("What's happening with PR 42?"), Some(Ask { which: Which::One(42), repo: None }));
    assert_eq!(read("How's pull request #42 doing"), Some(Ask { which: Which::One(42), repo: None }));
    assert_eq!(read("Show me PR number 7 in acme/garden-planner"), Some(Ask { which: Which::One(7), repo: Some("acme/garden-planner".into()) }));
    assert_eq!(read("Show me the merged PRs"), Some(Ask { which: Which::Merged, repo: None }));
    assert_eq!(read("list closed pull requests"), Some(Ask { which: Which::Closed, repo: None }));
    for talk in [
        "I need to review Sam's PR tomorrow",
        "Check the PR before lunch",
        "Show me the garden thread",
        "The PR is open",
        "What PR should I review first",
        "Show me the PRs and then call Mia",
        "PR",
        "Show me",
    ] {
        assert_eq!(read(talk), None, "{talk}");
    }
    assert_eq!(crate::catalog::classify("Show me the open pull requests"), Some(Act::GitHub));
}

#[test]
fn a_repo_said_points_at_a_named_one_an_owner_and_name_or_your_own() {
    let settings = Settings { repos: repos("garden=acme/garden-planner, bad entry, site=nope"), ..Default::default() };
    assert_eq!(settings.repos, vec![("garden".to_string(), "acme/garden-planner".to_string())]);
    assert_eq!(target(None, &settings), Target::Own);
    assert_eq!(target(None, &Settings { default_repo: Some("acme/site".into()), ..Default::default() }), Target::Repo("acme/site".into()));
    assert_eq!(target(Some("Garden"), &settings), Target::Repo("acme/garden-planner".into()));
    assert_eq!(target(Some("acme/garden-planner"), &settings), Target::Repo("acme/garden-planner".into()));
    assert_eq!(target(Some("acme slash garden planner"), &settings), Target::Repo("acme/garden-planner".into()));
    assert_eq!(target(Some("seed swap"), &settings), Target::Mine("seed-swap".into()));
    assert_eq!(target(Some("a/b/c"), &settings), Target::Mine("a-b-c".into()));
    assert_eq!(target(Some("…"), &settings), Target::Unclear);
}

#[test]
fn only_reads_ever_pass_never_a_comment_review_merge_or_close() {
    assert!(read_only(&args(&["pr", "list", "--state", "open", "--json", FIELDS])));
    assert!(read_only(&args(&["pr", "view", "42", "--json", FIELDS, "-R", "acme/garden-planner"])));
    assert!(read_only(&args(&["api", "user", "--jq", ".login"])));
    for write in [
        &["pr", "merge", "42"][..],
        &["pr", "comment", "42", "--body", "hi"],
        &["pr", "review", "42", "--approve"],
        &["pr", "close", "42"],
        &["pr", "edit", "42", "--title", "x"],
        &["pr", "view", "42", "--web"],
        &["api", "-X", "POST", "repos/acme/garden-planner/issues/42/comments"],
        &["api", "user", "--method", "PATCH"],
        &["issue", "comment", "42"],
        &[],
    ] {
        assert!(!read_only(&args(write)), "{write:?}");
    }
}

#[test]
fn checks_sum_up_as_failing_then_running_then_passing() {
    let v = |s: &str| serde_json::from_str::<Vec<Value>>(s).unwrap();
    assert_eq!(checks(&[]), (Checks::None, 0, 0));
    assert_eq!(checks(&v(r#"[{"status":"COMPLETED","conclusion":"SUCCESS"},{"status":"COMPLETED","conclusion":"SKIPPED"},{"state":"SUCCESS"}]"#)), (Checks::Passing, 0, 3));
    assert_eq!(checks(&v(r#"[{"status":"COMPLETED","conclusion":"SUCCESS"},{"status":"QUEUED","conclusion":""}]"#)), (Checks::Running, 0, 2));
    assert_eq!(checks(&v(r#"[{"state":"PENDING"},{"status":"COMPLETED","conclusion":"TIMED_OUT"},{"state":"ERROR"}]"#)), (Checks::Failing, 2, 3));
}

#[test]
fn gh_saying_why_reads_as_a_calm_reason() {
    assert_eq!(failure(Some(4), "To get started with GitHub CLI, please run:  gh auth login"), Failure::SignedOut);
    assert_eq!(failure(Some(1), "GraphQL: Could not resolve to a Repository with the name 'acme/nope'. (repository)"), Failure::UnknownRepo);
    assert_eq!(failure(Some(1), "GraphQL: Could not resolve to a PullRequest with the number of 999. (repository.pullRequest)"), Failure::NoPull);
    assert_eq!(failure(Some(1), "failed to run git: fatal: not a git repository (or any of the parent directories): .git"), Failure::NoRepo);
    assert_eq!(failure(Some(1), "error connecting to api.github.com"), Failure::Other);
}

#[tokio::test(start_paused = true)]
async fn in_full_the_card_lists_open_pull_requests_newest_change_first_with_checks() {
    let mut f = Fixture::new(Preset::Full, Settings::default(), listing);
    f.core.add_thought("me", "Show me the open pull requests");
    settle().await;
    assert_eq!(
        f.told(),
        vec![
            "card Loading Open pull requests [] more false".to_string(),
            "card Ready Open pull requests [acme/garden-planner] #42 Water the raised beds on a schedule Open Passing 0/2; #41 Frost dates for the north beds Draft Failing 1/2; #39 Seed list export Open Running 0/1; #37 Compost reminders Open None 0/0 more false".to_string(),
        ]
    );
    assert_eq!(
        f.calls(),
        vec![args(&["pr", "list", "--state", "open", "--search", "sort:updated-desc", "--limit", "11", "--json", FIELDS])],
        "the app's own repo: gh finds it where the core runs"
    );
    assert!(f.thoughts().is_empty(), "a request, not a thought");
}

#[tokio::test(start_paused = true)]
async fn one_pull_request_by_number_in_a_named_repo() {
    let mut f = Fixture::new(Preset::Full, Settings::default(), listing);
    f.core.add_thought("me", "What's happening with PR 7 in acme/garden-planner?");
    settle().await;
    let told = f.told();
    assert_eq!(told[1], "card Ready Pull request #7 [acme/garden-planner] #7 Rename beds Merged None 0/0 more false");
    assert_eq!(f.calls(), vec![args(&["pr", "view", "7", "--json", FIELDS, "-R", "acme/garden-planner"])]);
}

#[tokio::test(start_paused = true)]
async fn a_bare_repo_name_is_the_signed_in_accounts_asked_once() {
    let mut f = Fixture::new(Preset::Full, Settings::default(), listing);
    f.core.add_thought("me", "Show me the PRs in seed swap");
    settle().await;
    f.core.add_thought("me", "Show me the merged PRs in seed swap");
    settle().await;
    let told = f.told();
    assert!(told[1].starts_with("card Ready Open pull requests [pat-example/seed-swap]"), "{told:?}");
    let calls = f.calls();
    assert_eq!(calls.iter().filter(|c| c[0] == "api").count(), 1, "the account's name is asked once: {calls:?}");
    assert_eq!(calls[1].last().map(String::as_str), Some("pat-example/seed-swap"));
    assert_eq!(calls[2][3], "merged");
}

#[tokio::test(start_paused = true)]
async fn more_than_fit_shows_ten_and_says_github_has_more() {
    let many: Vec<String> = (1..=11)
        .map(|n| format!(r#"{{"number": {n}, "title": "Change {n}", "state": "OPEN", "updatedAt": "2026-11-01T00:00:00Z", "url": "https://github.com/acme/garden-planner/pull/{n}"}}"#))
        .collect();
    let body = format!("[{}]", many.join(","));
    let mut f = Fixture::new(Preset::Full, Settings::default(), move |_| Ok(body.clone()));
    f.core.add_thought("me", "Show me the open PRs");
    settle().await;
    let told = f.told();
    assert!(told[1].contains("#10 Change 10") && !told[1].contains("#11 ") && told[1].contains("more true"), "{told:?}");
}

#[tokio::test(start_paused = true)]
async fn the_demo_preset_and_a_hosted_core_never_run_gh_and_the_words_stay_talk() {
    let mut demo = Fixture::new(Preset::Demo, Settings::default(), listing);
    demo.core.add_thought("me", "Show me the open pull requests");
    settle().await;
    assert!(demo.calls().is_empty());
    assert!(demo.told().iter().all(|t| !t.starts_with("card")));
    let mut hosted = Fixture::new(Preset::Full, Settings { hosted: true, ..Default::default() }, listing);
    hosted.core.add_thought("me", "Show me the open pull requests");
    settle().await;
    assert!(hosted.calls().is_empty());
    assert!(hosted.told().iter().all(|t| !t.starts_with("card")));
}

#[tokio::test(start_paused = true)]
async fn a_guest_in_a_room_never_sees_the_hosts_github() {
    let mut f = Fixture::with(Preset::Full, Settings::default(), listing, |core| Core { room: Some(crate::Room::from("k7m2x9qp")), ..core });
    f.core.add_thought("guest", "Show me the open pull requests");
    settle().await;
    assert!(f.calls().is_empty());
    let told = f.told();
    assert!(told.iter().all(|t| !t.starts_with("card")) && told.iter().any(|t| t.contains("Only the host")), "{told:?}");
}

#[tokio::test(start_paused = true)]
async fn gh_missing_signed_out_or_slow_gives_one_calm_line() {
    for (failure, line) in [
        (Failure::Missing, "GitHub needs the gh command on this Mac: install it (brew install gh), then ask again."),
        (Failure::SignedOut, "gh isn't signed in to GitHub: run gh auth login in Terminal, then ask again."),
        (Failure::UnknownRepo, "GitHub has no acme/nope that your account can see."),
        (Failure::NoRepo, "Which repo? Say it as “pull requests in owner/name”."),
    ] {
        let reply = failure.clone();
        let mut f = Fixture::new(Preset::Full, Settings::default(), move |_| Err(reply.clone()));
        f.core.add_thought("me", "Show me the open pull requests in acme/nope");
        settle().await;
        assert_eq!(f.told()[1], format!("card Failed Open pull requests [acme/nope] more false {line}"), "{failure:?}");
    }
    // gh that never answers: the card gives up at 10 s, and says so.
    let calls: Calls = Arc::default();
    let log = calls.clone();
    let slow: Gh = Arc::new(move |args| {
        log.lock().unwrap().push(args);
        Box::pin(async {
            tokio::time::sleep(Duration::from_secs(3_600)).await;
            Ok(String::new())
        })
    });
    let mut f = Fixture::gh(Preset::Full, Settings::default(), slow, calls, |core| core);
    f.core.add_thought("me", "Show me the open pull requests");
    settle().await;
    assert_eq!(f.told().len(), 1, "loading");
    tokio::time::advance(Duration::from_millis(ANSWER_MS - 1)).await;
    settle().await;
    assert!(f.told().is_empty(), "still waiting 1 ms before");
    tokio::time::advance(Duration::from_millis(1)).await;
    settle().await;
    assert_eq!(f.told(), vec!["card Failed Open pull requests [] more false GitHub didn't answer within 10 seconds. Ask again in a moment.".to_string()]);
}

#[tokio::test(start_paused = true)]
async fn every_call_the_card_makes_only_reads() {
    let mut f = Fixture::new(Preset::Full, Settings { repos: repos("garden=acme/garden-planner"), ..Default::default() }, listing);
    for said in ["Show me the open pull requests", "What's happening with PR 7", "Any merged PRs in garden?", "Show me the PRs in seed swap", "List closed pull requests in acme/site"] {
        f.core.add_thought("me", said);
        settle().await;
    }
    let calls = f.calls();
    assert_eq!(calls.len(), 6, "{calls:?}");
    assert!(calls.iter().all(|c| read_only(c)), "{calls:?}");
    f.told();
}

#[test]
fn a_link_from_gh_opens_only_on_the_web() {
    let p = |url: &str| pull(serde_json::from_value(serde_json::json!({ "number": 1, "url": url })).unwrap());
    assert_eq!(p("https://github.com/acme/garden-planner/pull/1").url, "https://github.com/acme/garden-planner/pull/1");
    assert_eq!(p("javascript:alert(1)").url, "");
    assert_eq!(repo_of("https://github.com/acme/garden-planner/pull/1").as_deref(), Some("acme/garden-planner"));
}
