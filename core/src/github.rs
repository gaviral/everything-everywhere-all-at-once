//! The GitHub card, a connector of the Full preset (messages.rs `Preset`): "show me the open pull requests" or
//! "what's happening with PR 42" puts a card up listing pull requests (number, title, state, checks, when updated),
//! read through `gh` on the host's laptop. A click on one opens it on GitHub, in the browser.
//!
//! - Read-only: only `gh pr list`, `gh pr view` and `gh api user` ever run (`read_only` holds every call to that), so
//!   it never comments, reviews, merges or closes anything.
//! - Off in the Demo preset and on a hosted core (`E2A2O_HOSTED`): the words stay talk, as they were.
//! - The host's only: a guest's window never shows the host's repos.
//! - The repo is the one named ("… in acme/garden-planner", a name on `GITHUB_REPOS`, or a bare name, taken as the
//!   signed-in account's), else `GITHUB_REPO`, else the repo `gh` finds where the core runs (the app's own).
//! - `gh` missing, signed out, slow or refused: the card says so in one calm line.
//!
//! Tests stand in for `gh` (`Gh`), so no test reaches GitHub.

use crate::catalog::{Act, Done};
use crate::protocol::ServerMsg;
use crate::Core;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// Rows on the card. Worked back from a 900-px-tall laptop window: the card starts under the header (about 70 px),
/// each row is two lines in 48 px (Apple's 44-px least tap target, plus its meta line's air), and with its heading
/// and "See all" (about 80 px) 10 one-line rows end near 630 px, above the composer, so none needs a scroll. A title
/// longer than a line (about 60 characters at the card's 480 px) wraps rather than being cut; past the room above the
/// composer the card scrolls inside itself (pulls-card.css), so every row and "See all" stay in reach. More stay on
/// GitHub, a click away.
pub const ROWS: usize = 10;

/// How long the card waits for GitHub before it says it gave up: 10 s, the limit for keeping attention on a wait
/// (Nielsen, "Response Times: The 3 Important Limits"); `gh pr list` answers in about 1 s on a working connection.
pub const ANSWER_MS: u64 = 10_000;

/// The fields asked of `gh`, and nothing more.
const FIELDS: &str = "number,title,state,isDraft,updatedAt,url,statusCheckRollup";

/// What a run may do with GitHub.
#[derive(Clone, Debug, Default)]
pub struct Settings {
    /// Repos by a name you'd say: "garden=acme/garden-planner".
    pub repos: Vec<(String, String)>,
    /// `GITHUB_REPO`: the repo when none is named. Unset, `gh` finds the one where the core runs.
    pub default_repo: Option<String>,
    /// A hosted core (`E2A2O_HOSTED`): GitHub is off, there's no host's laptop to read `gh` on.
    pub hosted: bool,
}

impl Settings {
    pub fn from_env() -> Settings {
        let var = |name: &str| std::env::var(name).ok();
        Settings {
            repos: repos(var("GITHUB_REPOS").as_deref().unwrap_or("")),
            default_repo: var("GITHUB_REPO").map(|r| r.trim().to_string()).filter(|r| slug(r)),
            hosted: crate::hosted(),
        }
    }
}

/// `GITHUB_REPOS`: "garden=acme/garden-planner, site=acme/site". An entry without a name and an owner/name is left out.
pub fn repos(list: &str) -> Vec<(String, String)> {
    list.split([',', ';'])
        .filter_map(|entry| {
            let (name, repo) = entry.split_once('=')?;
            let (name, repo) = (name.trim(), repo.trim());
            (!crate::words(name).is_empty() && slug(repo)).then(|| (name.to_string(), repo.to_string()))
        })
        .collect()
}

/// An owner/name as GitHub spells one: letters, digits, "-", and in the name "." and "_" too.
fn slug(repo: &str) -> bool {
    let Some((owner, name)) = repo.split_once('/') else { return false };
    let part = |s: &str, extra: &[char]| !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || extra.contains(&c));
    part(owner, &[]) && part(name, &['.', '_']) && !name.starts_with('.')
}

/// Why `gh` gave no answer, each with its own calm line on the card.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Failure {
    /// No `gh` on this laptop.
    Missing,
    /// `gh` isn't signed in.
    SignedOut,
    /// No repo named, and none where the core runs.
    NoRepo,
    /// GitHub knows no such repo, or this account can't see it.
    UnknownRepo,
    /// No pull request with that number.
    NoPull,
    /// Past `ANSWER_MS`.
    Timeout,
    /// Anything else (offline, GitHub down, an answer it couldn't read).
    Other,
}

/// Runs `gh` with these arguments, its output or why not. `gh` on this laptop in the app; a stand-in in tests.
pub type Gh = Arc<dyn Fn(Vec<String>) -> Pin<Box<dyn Future<Output = Result<String, Failure>> + Send>> + Send + Sync>;

/// Whether `args` only read: `gh pr list`, `gh pr view` (never `--web` in any spelling, `--web=true` or `-w` among other
/// short flags, which opens a browser on the host), or the signed-in account's name. Every call goes through this, so
/// nothing here can comment, review, merge or close.
pub fn read_only(args: &[String]) -> bool {
    let web = |r: &str| r.starts_with("--web") || (r.starts_with('-') && !r.starts_with("--") && r.contains('w'));
    let a: Vec<&str> = args.iter().map(String::as_str).collect();
    match a.as_slice() {
        ["pr", "list" | "view", rest @ ..] => !rest.iter().any(|r| web(r)),
        ["api", "user", "--jq", ".login"] => true,
        _ => false,
    }
}

/// `gh` on this laptop. Prompts off (a prompt would wait for no one), and killed if the card stops waiting.
fn gh_app() -> Gh {
    Arc::new(|args| {
        Box::pin(async move {
            if !read_only(&args) {
                return Err(Failure::Other);
            }
            // A core started outside a shell (no Homebrew on its PATH) still finds it.
            let mut last = Failure::Missing;
            for program in ["gh", "/opt/homebrew/bin/gh", "/usr/local/bin/gh"] {
                let output = tokio::process::Command::new(program)
                    .args(&args)
                    .env("GH_PROMPT_DISABLED", "1")
                    .env("GH_NO_UPDATE_NOTIFIER", "1")
                    .env("NO_COLOR", "1")
                    .stdin(std::process::Stdio::null())
                    .kill_on_drop(true)
                    .output()
                    .await;
                match output {
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
                    Err(_) => last = Failure::Other,
                    Ok(o) if o.status.success() => return Ok(String::from_utf8_lossy(&o.stdout).into_owned()),
                    Ok(o) => return Err(failure(o.status.code(), &String::from_utf8_lossy(&o.stderr))),
                }
                break;
            }
            Err(last)
        })
    })
}

/// What `gh`'s exit and error words mean. Exit 4 is `gh`'s own "authentication required".
pub fn failure(code: Option<i32>, stderr: &str) -> Failure {
    let said = stderr.to_lowercase();
    let has = |words: &[&str]| words.iter().any(|w| said.contains(w));
    if code == Some(4) || has(&["gh auth login", "not logged in", "authentication required", "bad credentials"]) {
        Failure::SignedOut
    } else if has(&["could not resolve to a pullrequest", "no pull requests found"]) {
        Failure::NoPull
    } else if has(&["could not resolve to a repository", "http 404"]) {
        Failure::UnknownRepo
    } else if has(&["not a git repository", "no git remotes", "none of the git remotes", "no default remote", "set-default"]) {
        Failure::NoRepo
    } else {
        Failure::Other
    }
}

/// The GitHub side of the core: what it may do, how it runs `gh`, and the cards asked for.
pub struct Runtime {
    pub settings: Settings,
    gh: Gh,
    state: Mutex<State>,
}

#[derive(Default)]
struct State {
    next: u64,
    /// The signed-in account, once asked: a bare repo name is theirs.
    login: Option<String>,
}

impl Default for Runtime {
    /// Settings off the list, and a test core's stand-in refuses, should one ever get that far.
    fn default() -> Self {
        let gh: Gh = if cfg!(test) { Arc::new(|_| Box::pin(async { Err(Failure::Other) })) } else { gh_app() };
        Runtime::with(Settings::default(), gh)
    }
}

impl Runtime {
    pub fn from_env() -> Self {
        Runtime::with(Settings::from_env(), gh_app())
    }

    pub fn with(settings: Settings, gh: Gh) -> Self {
        Runtime { settings, gh, state: Mutex::default() }
    }
}

/// Which pull requests: those in a state, or one by number.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Which {
    Open,
    Closed,
    Merged,
    One(u64),
}

/// A request for pull requests: which, and the repo as said ("acme/garden-planner", "garden"), if one was.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Ask {
    pub which: Which,
    pub repo: Option<String>,
}

/// Words that ask to see something, opening the turn. "Check the PR" is left out: it's as often a to-do as a request.
const LEADS: &[&str] = &[
    "show me", "show", "list", "pull up", "bring up", "get me", "open", "what s happening with", "what s going on with",
    "what s up with", "what s new with", "what s the status of", "what s the state of", "what is the status of", "status of",
    "how s", "how is", "how are", "any", "are there any", "do i have any", "do we have any", "what are", "which", "what",
];
/// Words between the ask and the pull requests that change nothing.
const DETERMINERS: &[&str] = &["the", "my", "our", "all", "that", "this", "those", "these", "a", "your", "latest", "recent", "new"];
/// How a pull request is said, longest first as `skipped` reads them ("PR's" is "pr s").
const NOUNS: &[&str] = &["pull requests", "pull request", "p r s", "pr s", "prs", "p r", "pr"];
/// Words that may end the turn without changing what it asks.
const TAILS: &[&str] = &[
    "are open", "are there", "are waiting", "right now", "today", "on github", "from github", "in github", "doing", "going", "looking", "look like", "now", "status",
];
/// Words that name the repo after them.
const PREPOSITIONS: &[&str] = &["in", "on", "for", "from", "of"];
/// Saying the app's own repo, which is the one asked when none is named.
const OWN: &[&str] = &["this", "this app", "the app", "app", "app s", "this repo", "here", "your", "yours"];

/// Each word of `text` (as `crate::words` splits them, lowercased) with where it starts and ends.
fn spans(text: &str) -> Vec<(String, usize, usize)> {
    let mut out = Vec::new();
    let mut start = None;
    for (i, c) in text.char_indices().chain([(text.len(), ' ')]) {
        match (c.is_alphanumeric(), start) {
            (true, None) => start = Some(i),
            (false, Some(s)) => {
                out.push((text[s..i].to_lowercase(), s, i));
                start = None;
            }
            _ => {}
        }
    }
    out
}

/// How many words from `at` one of `phrases` takes (longest first), or 0.
fn takes(words: &[&str], at: usize, phrases: &[&str]) -> usize {
    let mut best = 0;
    for p in phrases {
        let p: Vec<&str> = p.split(' ').collect();
        if p.len() > best && words.len() >= at + p.len() && words[at..at + p.len()] == p[..] {
            best = p.len();
        }
    }
    best
}

/// Reads a whole turn as a request for pull requests: "show me the open pull requests", "what's happening with PR 42",
/// "any PRs in acme/garden-planner?". None when it isn't one: a to-do about a PR ("review Colleague's PR tomorrow") stays a
/// thought, and so does a turn with anything else in it.
pub fn read(text: &str) -> Option<Ask> {
    let said = crate::spoken::plain(text);
    let spans = spans(said);
    let words: Vec<&str> = spans.iter().map(|(w, _, _)| w.as_str()).collect();
    let mut at = takes(&words, 0, LEADS);
    if at == 0 {
        return None;
    }
    let mut which = Which::Open;
    let state = |w: &str| match w {
        "open" => Some(Which::Open),
        "closed" => Some(Which::Closed),
        "merged" => Some(Which::Merged),
        _ => None,
    };
    // "all the open", "my merged", "the draft": any order, any number.
    loop {
        if let Some(s) = words.get(at).and_then(|w| state(w)) {
            which = s;
            at += 1;
        } else if words.get(at).is_some_and(|w| DETERMINERS.contains(w)) {
            at += 1;
        } else {
            break;
        }
    }
    let noun = takes(&words, at, NOUNS);
    if noun == 0 {
        return None;
    }
    at += noun;
    if words.get(at) == Some(&"number") {
        at += 1;
    }
    if let Some(n) = words.get(at).and_then(|w| w.parse::<u64>().ok()) {
        which = Which::One(n);
        at += 1;
    }
    let mut end = words.len();
    // Tails at the end, any number ("are open on github").
    while let Some(n) = (1..=end.saturating_sub(at)).rev().find(|&n| TAILS.contains(&words[end - n..end].join(" ").as_str())) {
        if words[end - n..end].contains(&"open") && !matches!(which, Which::One(_)) {
            which = Which::Open;
        }
        end -= n;
    }
    if at == end {
        return Some(Ask { which, repo: None });
    }
    if !PREPOSITIONS.contains(&words[at]) || at + 1 == end {
        return None;
    }
    let repo = said[spans[at + 1].1..spans[end - 1].2].trim();
    let repo = repo_words(repo);
    Some(Ask { which, repo: (!OWN.contains(&crate::words(&repo).join(" ").as_str())).then_some(repo).filter(|r| !r.is_empty()) })
}

/// A repo as said, without "the" before it or "repo" after it ("the garden planner repo" → "garden planner").
/// Compared by `get`, so a name in any script ("日本語") is never cut inside a character.
fn repo_words(said: &str) -> String {
    let mut t = said.trim();
    for lead in ["the ", "my ", "our "] {
        if t.len() > lead.len() && t.get(..lead.len()).is_some_and(|h| h.eq_ignore_ascii_case(lead)) {
            t = &t[lead.len()..];
        }
    }
    for tail in [" repository", " repo", " project"] {
        if t.len() > tail.len() && t.get(t.len() - tail.len()..).is_some_and(|h| h.eq_ignore_ascii_case(tail)) {
            t = &t[..t.len() - tail.len()];
        }
    }
    t.trim().to_string()
}

/// The shape of a request for pull requests, as the catalog reads it (`Act::GitHub`).
pub fn kind(text: &str) -> Option<Act> {
    read(text).map(|_| Act::GitHub)
}

/// Where a repo as said points.
#[derive(Debug, PartialEq, Eq)]
enum Target {
    /// None named: `GITHUB_REPO`, else the one where the core runs.
    Own,
    /// An owner/name.
    Repo(String),
    /// A bare name: the signed-in account's repo of that name.
    Mine(String),
    /// Something that can't be a repo name.
    Unclear,
}

fn target(said: Option<&str>, settings: &Settings) -> Target {
    let Some(said) = said else {
        return settings.default_repo.clone().map_or(Target::Own, Target::Repo);
    };
    let words = crate::words(said);
    if let Some((_, repo)) = settings.repos.iter().find(|(name, _)| crate::words(name) == words) {
        return Target::Repo(repo.clone());
    }
    // "acme slash garden-planner", as speech writes it, or typed as it is.
    let joined = said.split_whitespace().collect::<Vec<_>>().join(" ").replace(" slash ", "/").replace(" / ", "/").replace(' ', "-");
    if slug(&joined) {
        return Target::Repo(joined);
    }
    // A bare name already spelled as GitHub would ("foo_bar", "site.v2") is that repo, not its words joined.
    let typed = said.trim();
    if slug(&format!("me/{typed}")) {
        return Target::Mine(typed.to_string());
    }
    let name = words.join("-");
    if !name.is_empty() && slug(&format!("me/{name}")) {
        return Target::Mine(name);
    }
    Target::Unclear
}

/// A pull request on the card.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Pull {
    pub number: u64,
    pub title: String,
    pub state: PullState,
    pub checks: Checks,
    /// How many checks fail, of how many.
    pub failing: u32,
    pub total: u32,
    /// When it last changed, as GitHub says it (ISO 8601); the window says how long ago.
    pub updated: String,
    pub url: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PullState {
    Open,
    Draft,
    Merged,
    Closed,
}

/// The checks on a pull request, as one word: any failing is failing, then any still running, then passing.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Checks {
    Passing,
    Failing,
    Running,
    None,
}

/// The card, as the window shows it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CardState {
    /// Asked; GitHub hasn't answered yet.
    Loading,
    /// The pull requests (none is an answer too).
    Ready,
    /// No answer; `message` says why.
    Failed,
}

#[derive(Deserialize)]
struct GhPull {
    number: u64,
    #[serde(default)]
    title: String,
    #[serde(default)]
    state: String,
    #[serde(default, rename = "isDraft")]
    is_draft: bool,
    #[serde(default, rename = "updatedAt")]
    updated_at: String,
    #[serde(default)]
    url: String,
    #[serde(default, rename = "statusCheckRollup")]
    checks: Option<Vec<Value>>,
}

/// One check's verdict: a check run has a status and, once completed, a conclusion; a commit status has a state.
fn verdict(check: &Value) -> Checks {
    let field = |name: &str| check[name].as_str().unwrap_or("").to_ascii_uppercase();
    let (status, conclusion, state) = (field("status"), field("conclusion"), field("state"));
    match (status.as_str(), conclusion.as_str(), state.as_str()) {
        (_, "FAILURE" | "TIMED_OUT" | "CANCELLED" | "ACTION_REQUIRED" | "STARTUP_FAILURE", _) | (_, _, "FAILURE" | "ERROR") => Checks::Failing,
        ("COMPLETED", _, _) | (_, _, "SUCCESS") => Checks::Passing,
        _ => Checks::Running,
    }
}

/// The checks of one pull request, summed up: how they stand, how many fail, of how many.
fn checks(all: &[Value]) -> (Checks, u32, u32) {
    let verdicts: Vec<Checks> = all.iter().map(verdict).collect();
    let failing = verdicts.iter().filter(|v| **v == Checks::Failing).count() as u32;
    let total = verdicts.len() as u32;
    let state = if total == 0 {
        Checks::None
    } else if failing > 0 {
        Checks::Failing
    } else if verdicts.contains(&Checks::Running) {
        Checks::Running
    } else {
        Checks::Passing
    };
    (state, failing, total)
}

fn pull(p: GhPull) -> Pull {
    let state = match (p.state.to_ascii_uppercase().as_str(), p.is_draft) {
        ("MERGED", _) => PullState::Merged,
        ("CLOSED", _) => PullState::Closed,
        (_, true) => PullState::Draft,
        _ => PullState::Open,
    };
    let (checks, failing, total) = checks(p.checks.as_deref().unwrap_or(&[]));
    // Only a web link opens from the card.
    let url = if p.url.starts_with("https://") { p.url } else { String::new() };
    Pull { number: p.number, title: p.title.trim().to_string(), state, checks, failing, total, updated: p.updated_at, url }
}

/// The owner/name in a pull request's web link (".../acme/garden/pull/7" → "acme/garden").
fn repo_of(url: &str) -> Option<String> {
    let path = url.strip_prefix("https://")?.split_once('/')?.1;
    let mut parts = path.split('/');
    let repo = format!("{}/{}", parts.next()?, parts.next()?);
    slug(&repo).then_some(repo)
}

/// The card's heading for what was asked.
fn title(which: Which) -> String {
    match which {
        Which::Open => "Open pull requests".into(),
        Which::Closed => "Closed pull requests".into(),
        Which::Merged => "Merged pull requests".into(),
        Which::One(n) => format!("Pull request #{n}"),
    }
}

/// The calm line for a failure, as apple.rs says Reminders' (what happened, then what to do).
fn failure_line(failure: &Failure, repo: &str, which: Which) -> String {
    let named = if repo.is_empty() { "that repo".to_string() } else { repo.to_string() };
    match failure {
        Failure::Missing => "GitHub needs the gh command on this Mac: install it (brew install gh), then ask again.".into(),
        Failure::SignedOut => "gh isn't signed in to GitHub: run gh auth login in Terminal, then ask again.".into(),
        Failure::NoRepo => "Which repo? Say it as “pull requests in owner/name”.".into(),
        Failure::UnknownRepo => format!("GitHub has no {named} that your account can see."),
        Failure::NoPull => match which {
            Which::One(n) => format!("No pull request #{n} in {named}."),
            _ => format!("No pull requests in {named}."),
        },
        Failure::Timeout => "GitHub didn't answer within 10 seconds. Ask again in a moment.".into(),
        Failure::Other => "GitHub didn't answer. Check the connection, then ask again.".into(),
    }
}

fn card(id: u64, title: &str, repo: &str, state: CardState, pulls: Vec<Pull>, more: bool, message: &str) -> ServerMsg {
    ServerMsg::PullsCard { id, title: title.into(), repo: repo.into(), state, pulls, more, message: message.into() }
}

/// Acts on a whole turn that asks for pull requests, in the Full preset on the host's laptop; None leaves it to be
/// talk (the Demo preset, a hosted core, or not a request for them).
pub fn act(core: &Arc<Core>, speaker: &str, text: &str) -> Option<Done> {
    if core.messages.settings.preset != crate::messages::Preset::Full || core.github.settings.hosted {
        return None;
    }
    let ask = read(text)?;
    // The host's gh and the host's repos: a guest's window never shows them.
    if !core.is_host(speaker) {
        core.send_to(speaker, ServerMsg::Notice { message: "Only the host can see GitHub here: it reads their gh.".into() });
        return Some(Done::missed(Act::GitHub));
    }
    let id = {
        let mut state = core.github.state.lock().unwrap();
        state.next += 1;
        state.next
    };
    let heading = title(ask.which);
    core.send_to(speaker, card(id, &heading, "", CardState::Loading, vec![], false, ""));
    let (core, speaker) = (core.clone(), speaker.to_string());
    tokio::spawn(async move {
        let answer = match tokio::time::timeout(Duration::from_millis(ANSWER_MS), fetch(&core, &ask)).await {
            Ok(answer) => answer,
            Err(_) => Err((Failure::Timeout, String::new())),
        };
        let shown = match answer {
            Ok((repo, pulls, more)) => card(id, &heading, &repo, CardState::Ready, pulls, more, ""),
            Err((failure, repo)) => {
                // The kind only: gh's own words can name a private repo.
                tracing::info!("GitHub card: no answer ({failure:?})");
                card(id, &heading, &repo, CardState::Failed, vec![], false, &failure_line(&failure, &repo, ask.which))
            }
        };
        core.send_to(&speaker, shown);
    });
    Some(Done::with(Act::GitHub, None))
}

/// Asks `gh`: the repo shown, its pull requests (at most `ROWS`), and whether GitHub has more.
async fn fetch(core: &Core, ask: &Ask) -> Result<(String, Vec<Pull>, bool), (Failure, String)> {
    let gh = core.github.gh.clone();
    let run = |args: Vec<String>| {
        let gh = gh.clone();
        async move {
            // Never reached with a write: every call here reads, and this holds it.
            if !read_only(&args) {
                return Err(Failure::Other);
            }
            gh(args).await
        }
    };
    let repo = match target(ask.repo.as_deref(), &core.github.settings) {
        Target::Own => None,
        Target::Repo(repo) => Some(repo),
        Target::Mine(name) => {
            let known = core.github.state.lock().unwrap().login.clone();
            let login = match known {
                Some(login) => login,
                None => {
                    let login = run(vec!["api".into(), "user".into(), "--jq".into(), ".login".into()]).await.map_err(|f| (f, String::new()))?.trim().to_string();
                    if login.is_empty() || !slug(&format!("{login}/x")) {
                        return Err((Failure::Other, String::new()));
                    }
                    core.github.state.lock().unwrap().login = Some(login.clone());
                    login
                }
            };
            Some(format!("{login}/{name}"))
        }
        Target::Unclear => return Err((Failure::NoRepo, String::new())),
    };
    let shown = repo.clone().unwrap_or_default();
    let mut args: Vec<String> = match ask.which {
        Which::One(n) => vec!["pr".into(), "view".into(), n.to_string(), "--json".into(), FIELDS.into()],
        which => {
            let state = match which {
                Which::Closed => "closed",
                Which::Merged => "merged",
                _ => "open",
            };
            // The most recently changed first: "what's happening" is about what moved lately.
            vec!["pr".into(), "list".into(), "--state".into(), state.into(), "--search".into(), "sort:updated-desc".into(), "--limit".into(), (ROWS + 1).to_string(), "--json".into(), FIELDS.into()]
        }
    };
    if let Some(repo) = &repo {
        args.extend(["-R".into(), repo.clone()]);
    }
    let out = run(args).await.map_err(|f| (f, shown.clone()))?;
    let mut pulls: Vec<Pull> = match ask.which {
        Which::One(_) => serde_json::from_str::<GhPull>(&out).map(|p| vec![pull(p)]),
        _ => serde_json::from_str::<Vec<GhPull>>(&out).map(|ps| ps.into_iter().map(pull).collect()),
    }
    .map_err(|_| (Failure::Other, shown.clone()))?;
    let more = pulls.len() > ROWS;
    pulls.truncate(ROWS);
    let repo = repo.or_else(|| pulls.first().and_then(|p| repo_of(&p.url))).unwrap_or_default();
    Ok((repo, pulls, more))
}

#[cfg(test)]
mod tests;
