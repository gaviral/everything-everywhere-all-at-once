# Static tree boundary

Run `python3 scripts/tree-guard.py` from the repository root. This reads index blobs and every tracked working file independently, including new staged entries. It fails closed on Git/read errors, conflicts, symlinks, submodules, missing indexed files and unreadable files. A fully staged deletion is absent from the candidate index; a remaining working copy is still checked. Diagnostics use a path SHA-256 prefix, source and line, never matched values. Resolve a path locator locally by hashing the repository-relative filename.

`sh scripts/precheck.sh` invokes this first, before any build, page or live check. Run `PYTHONDONTWRITEBYTECODE=1 python3 scripts/tree-guard-test.py` for isolated Git regression fixtures. Neither command needs the running app. The full precheck still has its other build/live checks; use the standalone command for static-only work.

Every narrative/data fixture (JSONL/CSV/TSV, sample/fixture/testdata assets, named sample/export/inbox/chat/report documents, and structured chat documents) needs an explicit entry in `scripts/fixture-provenance.json`: `kind: synthetic`, an explanatory `provenance`, and the exact `sha256`. Changed bytes require renewed review and a changed record in both index and worktree. There is deliberately no baseline or auto-approval command. The initial enumerated scenarios come from the audit's handwritten/synthetic fixture findings and the explicitly synthetic sample-chat introducing commit; image records describe generated sample illustrations, not rights approval. Do not record arbitrary exports as synthetic merely to pass. Reports copied from an inbox with neutral names still require provenance; private data paths remain forbidden even with a record.

Allowances apply to individual matches, never entire files:

- `.env.example` must contain only whitespace. Other environment files are refused.
- `journal_tests.rs` is source, not a runtime journal. Runtime journal/data/log/TLS/export/chat/inbox/personal/editor configuration paths remain forbidden, including force-staged configuration.
- The approved current Canvas view label and HTML canvas terminology remain valid. Earlier/legacy project, checkout, repository, Keychain and command contexts are rejected independently. No view rename or file exemption is used.
- `example.com` email examples, the exact fictional Git test identity `fixture@users.noreply.github.com`, and 555 phone examples are synthetic. Email-shaped URL user-info without a password is URL syntax. Password-bearing URLs remain subject to secret rules.
- The approved public GitHub noreply identity and repository/copyright account identity remain valid. Upstream email attribution is allowed only on a copyright line beginning with a year; every other secret/private-content rule still scans that line and all licence/notice files.
- In the static index/worktree check, contact matches in upstream dependency evidence are allowed only at the package's exact evidence path with matching SHA-256 and `archive_verified: true` in that same snapshot's dependency inventory. Changed or unlisted files are checked normally. All other rules, including secrets, personal paths and owner text, still apply. Upstream evidence stays byte-for-byte intact; this allowance does not clear outgoing history.
- The two literal compiler cache paths `~` followed by `/.cargo/registry` or `/.cargo/git` are tool-cache configuration, not personal home paths. Other literal home paths are refused.

Checker patterns and negative test payloads use split spellings where needed; there are no checker/test/doc/licence file exclusions. Secret patterns scan all bytes, including binary assets. Prose/contact rules inspect UTF-8 text; this is not OCR or arbitrary binary metadata clearance.

The default tree check plus synthetic fixture provenance is structural protection against known data paths and patterns, not proof that arbitrary prose is non-personal. Embedded scenarios and arbitrary unnamed prose still need human review. The default check does not inspect history or outgoing refs and grants no film, rights, deployment or release clearance. External runtime-state defaults/migration and approved history cleanup remain open.

## Outgoing publication boundary (inactive until explicitly installed)

`--pre-push` is a separate historical gate. It consumes Git's actual pre-push standard input: one `local-ref local-oid remote-ref remote-oid` row per proposed update. It never substitutes HEAD or a tracking branch. Every destination must be `refs/heads/main`, and its full object ID must match the explicitly approved sanitized commit in a local JSON allowlist. Missing policy, empty/malformed input, duplicate destinations, deletions, changed tips and extra branches/tags/backup refs fail. This rejects extra refs proposed by `--all` or `--mirror`; Git does not tell hooks the option spelling, so a command proposing only the approved main has the same result as an explicit main push.

All reachable ancestry is scanned, including merge parents and objects the receiver may already have. Remote old IDs never subtract history. A clean working tree, staged deletion, or clean tip cannot hide older private blobs, paths or messages. The complete raw commit header and message, every reachable blob (including binary secret signatures), and paths in every historical tree use the existing rules. Historical data fixtures require matching provenance in their own snapshot. The exact approved public display name paired with its exact public noreply address is allowed in author/committer headers only; message text receives no such exception. There is no `ACCEPT_COMMITS` escape for this gate.

The scanner checks command exit status, object type, length and hash, then independently walks commit parents and tree children and requires that closure to equal the enumerated inventory. Shallow history, grafts, missing objects, submodules, symlinks and incomplete enumeration fail closed. No fetch, remote query, app call or model call occurs. Local refs not proposed by Git are not published and are not scanned; already-existing remote refs require separate review before making a repository public. The guard does not assess remote visibility, film, rights or arbitrary prose outside its documented pattern limits.

After the separately approved history rewrite and human review, set `approved` to the **full reviewed sanitized main commit ID**. Do not approve the current unsanitized history just to enable a push. From the intended repository root, the exact check-only command is:

```sh
approved='<reviewed-full-commit-oid>'
PYTHONDONTWRITEBYTECODE=1 python3 scripts/install-publication-guard.py --repo . --approved-main "$approved" --check-only
```

That command scans the proposed main and writes nothing. Only after it passes and activation is explicitly authorized, install with:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 scripts/install-publication-guard.py --repo . --approved-main "$approved"
```

The installer rechecks history, snapshots the three guard modules and pinned allowlist into the common Git directory's `publication-guard/`, and atomically creates `hooks/pre-push`. It refuses an existing hook/bundle or any configured `core.hooksPath`, preserving existing gates for manual integration. It changes no Git config or refs. Linked worktrees share this hook and policy. Installing is local only; no hooks are automatically enabled by checking out these files. A later main tip requires renewed review and an updated local approval; this installer deliberately refuses to overwrite a previous installation. Preserve it by a reversible move for reviewed reinstallation, never by silently discarding another hook.

For a check against an existing installed policy, reproduce the proposed Git rows offline:

```sh
printf 'refs/heads/main %s refs/heads/main %s\n' "$approved" "$(printf '%s' "$approved" | tr '0-9a-f' '0')" |
  PYTHONDONTWRITEBYTECODE=1 python3 scripts/tree-guard.py --repo . --pre-push
```

The zero old ID above models creating the public branch and does not weaken the scan. `--allowlist /path/to/local-policy.json` can select a reviewed policy for check-only use; its exact schema is `{"version":1,"refs":{"refs/heads/main":"<full-oid>"}}`. Actual installed hooks consume Git's rows directly, not this example. Hooks are local safeguards and can be bypassed by Git options or configuration; publication remains an explicit operator responsibility.

Verify without touching repository hooks or refs:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 scripts/publication-guard-test.py
PYTHONDONTWRITEBYTECODE=1 python3 scripts/tree-guard-test.py
sh -n scripts/precheck.sh
git diff --check
```

Fixtures live only in retained temporary repositories. They cover approved main, a clean tip over dirty ancestry, historical private paths, a bad side tag and broad ref updates, complete messages and identities, failed/truncated enumeration, missing/shallow history, and check-only/installed hook behavior. This lane provides tooling only: publication stays blocked until history is sanitized and the hook is activated. Merge-time precheck and `scripts/release.sh` retain their existing behavior.
