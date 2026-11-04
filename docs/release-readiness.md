# Release readiness

## Historical rehearsal — 2026-11-04 UTC

Rehearsed commit: `39d3c4ac766d53864d6c3d1f6721b9747dbe5cc6` (a verified ancestor of `main`). This historical record concerns a local, keyless sample rehearsal, **not a release pass or a live Meta test**. The documentation update was uncommitted at that time.

The rehearsal uses a clean detached checkout, a new browser profile, an isolated home and dependency caches, an empty `MODEL_API_KEY`, and no `.env` file. Keychain access is blocked by a test-only command stub. Port 4417 is checked by the launcher's preflight before startup. All sample content and saved pictures are synthetic examples; their dates and people are not live user evidence.

Environment: macOS 15.8.1 (24H32), x86_64; Node.js 26.11.0, npm 11.20.0, Rust 1.97.1; headless Chrome 156.0.8078.81. Node.js 22.12+ and npm are required. A source build also needs Rust 1.89+ and, on macOS, Apple's command-line developer tools. The optional bundled-core route is separate and was not used.

### Rehearsal results

The local sample starts and can be explored, with the return limitation below. **The candidate has not passed release acceptance.** Commands ran in the isolation described above; private receipts retain their output and exit status.

| Command or check | Exit/result |
|---|---|
| `sh -n run.sh`; `./run.sh --help` | Both 0. Usage lists the sample route and port override. |
| `node --version`; `npm --version`; `rustc --version`; `cargo --version`; `cc --version`; `xcode-select -p` | All 0; prerequisites present on this host. |
| `PORT=4417 node scripts/start.mjs sample` | 0; selected port 4417 was available. |
| `PORT=4417 ./run.sh sample` | Installed UI dependencies, built the UI, compiled and served the real Rust core. Cargo reported the cold release build finished in **13m 19s**; this is one host's observation, not a startup guarantee. After the browser check, the owned core was stopped with SIGTERM (process exit −15). |
| `node scripts/samples-check.mjs` | 0; four offered samples, including three shorter examples. |
| `node scripts/install-check.mjs` | 0; manifest, icons, links, public-asset gate and install-hint rules. This does not test an actual OS installation. |
| `node scripts/readme-check.mjs` | 0; existing static README checks only, not fresh validation of its live claims. |
| `node scripts/start-check.mjs` | **1 on both attempts.** First: synthetic source-launch fixture reported missing developer tools and returned 1 instead of 17. Retry after compilation: a synthetic launcher subprocess reached its 60-second timeout (`ETIMEDOUT`). Cause remains unconfirmed. No assertions or timeouts were changed. |
| Fresh-profile browser rehearsal against the real core, `/?sample` | Private CDP driver exited 0 after its initial snapshot-wait race was corrected (first attempt: 1). No app assertion was relaxed. See observations below. |

Browser observations: **SAMPLE** and **No AI key** were visible; the core supplied eight topics and 30 thoughts. `pictures` opened eight tiles with all 16 saved small/large images loaded from local `/images/` URLs. `/` focused search; `rent` returned two results; Enter returned to a topic. `where was I?` selected the expected unfinished topic, confirmed by the core's return message and the active topic after reload. Reload retained SAMPLE and 30 thoughts without inventing a completion.

**Return limitation:** the page reported that the exact interruption source was unavailable for this older sample. The target-topic return worked, but the original unfinished quotation was not recovered. This remains a candidate limitation; the rehearsal does not claim full interruption-source recovery.

Recorded readback: at **2026-11-04 08:00:58 UTC**, both local `HEAD` and `main` resolved to the rehearsed commit above. This does not identify current main or a remote or hosted build. Later code changes need fresh verification.

### Local route: sample first, own Meta key second

From the repository root, after installing the prerequisites:

```sh
./run.sh --help
PORT=4417 ./run.sh sample
```

Open the printed `http://localhost:4417/?sample` URL after the core starts. Confirm **SAMPLE** and **No AI key**. Type `where was I?` to return to the unfinished example, then `pictures` to see its saved pictures. Use `/` to search for `rent` and Enter to open a matching topic. Each sample startup restores its fixture. These actions do not demonstrate live transcription, model placement, or image generation.

For a separate local map with live model features, supply **your own Meta Model API key** privately in `.env` using the existing template, then start the demo map:

```sh
cp .env.example .env
# Set MODEL_API_KEY privately in .env; never commit or share that file.
PORT=4417 ./run.sh demo
```

That second route is an instruction, not a result from this keyless rehearsal. Live features require access to `api.meta.ai`; there is no offline model. The app requires no GPT runtime service.

Local startup does not depend on the optional hosted preview. Hosted admission, account/guest entry, capacity, shared model budgets, and deployed-build identity require their own checks. This record makes no fresh no-account hosted claim and does not apply hosted limits to a local process.

Committed files were inspected with `git show` at the recorded candidate; no helper-based verification is claimed. Linux, Windows/WSL, actual Dock/home-screen installation, and the optional downloaded-binary route were not exercised. No local runtime prerequisite was missing.

### Still required for release

- Resolution or explicit release acceptance of the sample interruption-source limitation and the failing launcher check.
- A live Meta run on the candidate: real microphone/transcription, placement, and newly generated pictures, with appropriate evidence. Saved sample pictures do not establish any of those results.
- A fresh logged-out hosted rehearsal, served-build comparison, and verification of current hosted limits. Hosted access was not exercised here.
- The final video/link and its build identity, plus approval of submission claims. This rehearsal does not validate the broad film or claims lanes.
- The full release gate on the final candidate. No full precheck, broad UI suite, release command, publication, or deployment is implied by the targeted checks here.

## Historical record — 2026-11-03

The earlier versions of this document, committed as `2e52f7a20c9a34fe4faba0120bb3375652419854` and `25a3b2e53c05762c6bce4dc013b531e4f823ea7a`, described a different release-branch working state. The first reported integration through `cf7acd4` and seven release-safety tests. The later entry described an **uncommitted** integration of `2c66c1e`, eight release-safety tests, a zero-finding secret scan, all 14 bricks, and 78 checks with `PRECHECK_PAGES=0`; live probes were skipped.

Those are historical reports, not checks rerun for the candidate above. The old uncommitted-merge description is not the current checkout's status. Neither that precheck nor its skipped live/browser coverage establishes a release pass. The earlier entry also recorded unresolved submission placeholders and no release-script run or deployment.
