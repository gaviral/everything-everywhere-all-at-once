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
- The two literal compiler cache paths `~` followed by `/.cargo/registry` or `/.cargo/git` are tool-cache configuration, not personal home paths. Other literal home paths are refused.

Checker patterns and negative test payloads use split spellings where needed; there are no checker/test/doc/licence file exclusions. Secret patterns scan all bytes, including binary assets. Prose/contact rules inspect UTF-8 text; this is not OCR or arbitrary binary metadata clearance.

This guard plus synthetic fixture provenance is structural protection against known data paths and patterns, not proof that arbitrary prose is non-personal. Embedded scenarios and arbitrary unnamed prose still need human review. It does not inspect history or outgoing refs and grants no film, rights, deployment or release clearance. External runtime-state defaults/migration and approved history cleanup remain open.
