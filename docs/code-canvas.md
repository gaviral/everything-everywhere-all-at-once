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
