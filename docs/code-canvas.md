# Code canvas (optional)

Build the UI and core, then run `sh scripts/code-canvas.sh`. Open
`http://localhost:4459/?canvas=code`. The launcher creates a fresh temporary map.
The ordinary map stays the default. The reader requires `E2A2O_CODE_CANVAS=1`
and a loopback connection; room guests cannot read it. It needs no model.

The Rust reader scans `core/src` and `ui/src` on every read, skipping symlinks.
Only relative paths, function names, locations, metrics and resolved call IDs
leave the reader. It does not return source bodies or read saved maps, keys,
private documents or environment files. The UI reads again four seconds after
each completed request. Failed reads keep the prior view with an explicit notice.

Composition follows folders, files, named functions and block/expression arrow
functions. Calls and JSX components resolve by name, preferring a qualified file
or an unambiguous local function. This is a plain parser, not a compiler: dynamic
dispatch, overloads, anonymous callbacks, template interpolation and some method
syntax are incomplete. Ambiguous/external call names remain unresolved; they
are never presented as certain dependencies. Test functions are included.

The splitting list measures functions over 60 physical lines, 8 decision keywords,
or 10 resolved callees. These are review signals, not claims that a function has
multiple responsibilities. A person should decide what to split.

Local branch refs and commit parents are read from git on each request. The tree
uses the nearest ancestral named tip, falling back to shared main history. Equal
tips are siblings, and unrelated roots remain separate. Dev is the default;
`stage`, `staging` and `train` name segments suggest staging. An ancestor of main
is marked “in main”. MERGE_HEAD in the common Git directory and its worktree metadata detects
pending local merges. This view does not infer deployments.
Nothing writes to git or changes a branch.

Validation: `cargo test --manifest-path core/Cargo.toml code_canvas` exercises
source parsing, call ambiguity, metrics and real local git ancestry/ref changes.
`node scripts/code-canvas-check.mjs` checks visible behavior with synthetic API
responses: expansion, calls, refresh, new functions, branch nesting, measured
signals, stale/recovery feedback, keyboard controls and narrow layout.

## Agent work

Use **Agent work** on the map to open this optional view, and **Back to map** to
leave it. The map remains the default; the reader and answer endpoint require the
existing loopback-only opt-in. **TV size** enlarges work and controls independently
of physical screen resolution and remembers the choice in this browser.

The board puts main, staging and dev at the left, followed by lanes. Dashed lines
show a known starting branch. Solid lines rise to the integration branch that
contains the lane tip. The join identifier is the first commit on that
integration's first-parent history that contains the tip, including fast-forward
arrivals. This describes local git, not a deployment. A changed destination or
join shows a visible “Just joined” moment. Recent joins stay in the active list;
new lanes append without reordering existing lane slots during a visit. Search,
all-lanes filtering and Show more expose older work without rendering every
historical branch at once.

Set `E2A2O_AGENT_STATE` to a local JSON file outside the public checkout. A separate
local exporter can update it atomically when jobs, coordination notes or requests
change. The app contains no exporter dependency or personal source path. Its
optional feed has `updated_at`, `lanes`, `needs_you`, `summary` and `notice` fields.
Each lane reports `id`, `branch`, `who`, `now`, `finished`, `state`, `updated_at`.
Each request reports `id`, `title`, `detail`, `lane`. Unmatched jobs stay separate;
missing updates say so. This view never claims to know work a producer has not
reported. The timestamp denotes a feed change, not a heartbeat.

The work summary separates running items, items built into the TV build,
written-only ideas, and items waiting on the person. A completed agent job is
not proof that a feature reached the TV. The local producer supplies live-job
evidence and verified build ancestry. When written-only ideas have no live
worker, a large red notice names the first three. It becomes quiet as work
resumes. Missing, stale or disconnected observations show unknown status,
never a confident zero. Work observations expire after fifteen seconds without
the producer; ordinary source browsing remains available.

Needs-you cards remain until answered. Saving posts only to the local answer
endpoint. A successful save writes a restricted-permission JSON receipt to a
sibling directory with the state file's extension replaced by `.answers`, one
receipt per request ID. The exporter and reader retain those receipts, so a
source refresh or browser reload cannot resurrect an answered card. An answer
records the person's decision for the agent to read; it runs no command and
sends no message. Failed saves keep the card and draft. Source/feed failures keep
last-known requests during the visit; unknown feeds never claim no requests.
On narrow screens a compact persistent bar opens a native modal sheet, with
Close, Escape and focus return; desktop reserves a rail for the cards.

Parts include source files even when they contain no named functions. Tags are
simple source/file-role heuristics: prompt, function, data, mechanism, view.
Filter by any tag. Each part displays a simple version from git file history;
functions share their containing file's version, explicitly labeled. v0 means
no committed file history. These are file revisions, not semantic releases or
independently tracked function versions.
