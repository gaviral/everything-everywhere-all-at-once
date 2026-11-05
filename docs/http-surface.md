# HTTP and WebSocket surface

The production router is in `core/src/surface.rs`; every request passes the Host,
Origin and room-code gate in `main.rs`. GET routes also support HEAD. Other
methods receive 405. The UI fallback serves GET/HEAD only.

| Method | Route | Purpose / boundary |
| --- | --- | --- |
| GET → WebSocket | `/ws` | Map and commands; 64 KiB messages/frames |
| GET → WebSocket | `/ws/my-words` | Map-bound glossary; 16 KiB messages/frames |
| GET | `/room` | Availability and join information; join code only for members |
| GET | `/memory/stats` | In-RAM index, lookup, context savings and cache counts; zero while off |
| POST | `/terse` | Short display lines |
| POST | `/clarify` | Clarification from Meta |
| POST | `/draw/read` | Read a bounded sketch with Meta |
| POST | `/draw/back` | Draw with Meta |
| POST | `/flow/plan` | Plan or edit text boxes |
| POST | `/flow/run` | Stream results over SSE |
| GET | `/flow/turns` | Active panel's turn stream over SSE |
| GET, POST | `/flow/library` | Read/save bounded text pipelines |
| POST | `/flow/finish` | Keep a result after checking its source; host only |
| POST | `/flow/send` | Explicit send through existing allowlist/countdown; host only |
| POST | `/helper-result` | Read a recorded helper result; validates identity and paths |
| POST | `/import` | Preview an import; host only, explicitly capped at 100 MiB |
| GET | `/evidence/{id}` | A recorded image UUID; never accepts a filesystem path |
| GET | `/images/*` | Images under the configured data image directory |
| GET | `/*` | Built UI files, then `index.html` for page navigation |

These local tools return **404 by default**, and **404 in hosted mode even if
their switches are set**. Both ends of their connection must be loopback.

| Method | Route | Required environment switch |
| --- | --- | --- |
| GET | `/build-id` | `E2A2O_DEV_TOOLS=1` |
| POST | `/build-activity` | `E2A2O_DEV_TOOLS=1` |
| GET | `/workshop/catalog` | `E2A2O_DEV_TOOLS=1` |
| GET | `/workshop/hackathon` | `E2A2O_DEV_TOOLS=1` |
| POST | `/workshop/run` | `E2A2O_DEV_TOOLS=1` |
| GET | `/workshop/turns` (SSE) | `E2A2O_DEV_TOOLS=1` |
| POST | `/crew/plan` | `E2A2O_DEV_TOOLS=1` |
| POST | `/crew/build` | `E2A2O_DEV_TOOLS=1` |
| POST | `/crew/merge` | `E2A2O_DEV_TOOLS=1` |
| POST | `/crew/promote` | `E2A2O_DEV_TOOLS=1` |
| GET | `/bricks.html` (playground) | `E2A2O_DEV_TOOLS=1` |
| GET | `/code-canvas/snapshot` | `E2A2O_CODE_CANVAS=1` |
| GET | `/code-canvas/events` (SSE) | `E2A2O_CODE_CANVAS=1` |
| POST | `/code-canvas/answer` | `E2A2O_CODE_CANVAS=1` |

The build watcher also requires `E2A2O_DEV_TOOLS=1` and a configured build file.
Crew's intentional fault injection requires that same development switch.
`/src/*` and `/__*` are always refused by the production server, including a
misconfigured UI root containing source or fixtures.

The additional router registrations under `#[cfg(test)]` in `core/src` are:

| Method | Fixture route | Location |
| --- | --- | --- |
| POST | `/` | `helpers/tests.rs` provider fixtures |
| POST | `/chat` | `conversation/tests.rs` provider fixture |
| POST | `/v1/chat/completions` | `model.rs`, `topics.rs`, `placer.rs`, `placer_route_tests.rs`, `memory/tests.rs` |
| POST | `/__mechanics/release`, `/__mechanics/stop`, `/__mechanics/cleanup` | `helpers/tests.rs` |
| GET | `/f7-stats` | `explain.rs` |
| GET | `/fixture.wav` | `asr/tests/identity.rs` |
| POST | `/helper-result` | `helper_result/tests.rs` reuses the production handler |
| GET | `/room` | Shared map fixtures reuse the production handler |
| GET → WebSocket | `/ws` | Map/voice/TLS fixtures reuse or replace the production handler |
| GET | `/*` | UI fixtures use `ServeDir` |

None of those test routers is compiled into the release executable.

## Film and hosted configuration

Synthetic words, camera controls and the film overlay require a UI built with
`VITE_E2A2O_FILM=1`, plus `?film`. A URL alone cannot enable them. `?crewfault`
also requires that build switch. The capture script explicitly builds its
isolated UI with the switch and enables its local development endpoints.
Normal film checks verify absence; opt-in checks use the same build switch.

Docker explicitly builds with `VITE_E2A2O_FILM=0`. Docker and Compose set
`E2A2O_HOSTED=1`, development and code-canvas switches to `0`, `E2A2O_TRACE=0`
and `HELPERS_RUN=off`. No credential is a build argument or UI environment value.

## Bounds, files, generated parts and credentials

- JSON extractors have an explicit 2 MiB cap, preserving the existing sketch
  allowance. Import alone uses its existing 100 MiB raw-body cap. WebSocket
  limits are independent of HTTP body limits.
- Decoded path segments beginning with a dot, backslashes, control bytes and
  malformed escapes are rejected before static-file serving. UI/image roots
  are operator configuration; generated content cannot choose those roots.
  Static roots must contain trusted files and no links to private directories.
- Evidence accepts recorded UUIDs. Imports display a basename, without opening
  a caller-provided path. Code-canvas uses an operator-configured source root
  behind the local gate. Helper results accept only server-recorded worktrees.
- Generated Crew parts stay in a separate data-adjacent repository. Run/part
  identifiers allow only bounded lowercase letters, digits and dashes. The
  model produces JSON for fixed React blocks, never JavaScript or HTML. Each
  part is capped at 24,000 bytes; unknown block kinds are refused. Git receives
  argument arrays, and its stderr never reaches a page. Coding helpers retain
  their existing tracked-file, canonical-path and symlink checks and are off
  in the hosted config.
- The configured model credential is removed from provider JSON, errors and
  traces before exposure. Streaming redaction spans chunk boundaries while
  ordinary text still arrives immediately. Voice provider events are also
  redacted; handshake diagnostics and refused HTTP requests do not log raw
  provider frames, URLs or Origin headers.

Focused checks: `cd core && cargo test --locked surface_ -- --test-threads=1`,
then `node scripts/surface-check.mjs` from the repository root. These use
synthetic local data and do not start a microphone or call a model.

Validation: 2026-11-04 17:12 BC. The six focused Rust tests and the UI check
passed. `git diff --check`, the changed JavaScript syntax checks, and shell
syntax checks passed. No `preflight.sh` exists in this checkout; the full
precheck suite was not substituted or run.
