# Fresh-clone sample check

2026-11-04 17:52 BC

Intel macOS, Node 26.11.0 and Rust 1.97.1. The branch was cloned into a temporary directory, with an isolated runtime home and initially empty Cargo/npm caches. No `.env`, key, existing map or build output was copied. Only the installed toolchain binaries were reused.

The README command, `./run.sh sample`, downloaded dependencies, built the Rust core and both UI pages, seeded the labelled sample and served it on localhost port 4321. Four existing unused-code warnings did not prevent compilation.

## Findings and corrections

- Native prerequisites were checked after the storage resolver had already invoked Cargo. The launcher now checks them before the first compilation. The focused check verifies that missing prerequisites stop before Cargo runs, plus macOS/Linux bundle selection for Intel and ARM. The other architectures are simulated, not native builds.
- Crew has no keyless sample build. Its routes require local development mode and remain disabled in hosted/Docker mode. The README now gives the required command; a denied Crew request explains the setup instead of reporting a bare HTTP status.
- Keyless typed thoughts save, but automatic placement and the AI drawing actions require a Meta key. The README distinguishes local sketching/labels from those model calls.
- **REAL, test setup:** the first launch used a temporary home under macOS's symlinked temporary-directory alias. The storage guard correctly refused it after compilation. The test switched to the canonical path; the guard was retained.
- **TIMING, browser driver:** cold headless Chrome held the first HTML response for about 40 seconds before requesting scripts. The check waits for readiness, with a 60-second deadline. Coordinate clicks also became stale while the map moved; controls now use focus and trusted keyboard activation, while sketching still uses pointer input.
- **STALE, test fixture:** returning to unfinished work changes the sample's state. Each complete rerun needs a fresh `./run.sh sample` start, which preserves the previous data in a backup.
- **STALE, browser driver:** Enter without its character event exercised the custom thought handler but did not submit Draw's native form. The driver now sends the complete Enter event; the app's form was retained.
- **STALE, browser driver:** the provisional page-side microphone counter was not injected in this Chrome session. The final check denies the permission at the browser level and verifies that denial instead.

## Validation

The focused browser command is `node scripts/stranger-check.mjs`, run against a freshly started sample. It checks the populated map, recovery, saved pictures, a saved typed thought, Features, a drawn stroke and label, and Crew's setup guidance. Microphone access is denied through Chrome's permission policy and that denial is checked; no microphone control is activated.

Final browser result: **PASS** for every listed interaction and the denied microphone permission. Crew's setup guidance passed; no live Crew build was attempted.

Shell syntax, JavaScript syntax, Compose YAML parsing and `git diff --check` passed. No `preflight.sh` exists in this checkout; the broader suite was not run.

Docker is unavailable on this Mac. The Dockerfile, entrypoint, build context and Compose steps were reviewed by inspection: native Linux build dependencies, UI/sample copies, writable volume, loopback relay and health checks are consistent. The README gives `docker compose up --build --wait`. No container build/start, native Linux/Apple-silicon run or live model request is claimed.
