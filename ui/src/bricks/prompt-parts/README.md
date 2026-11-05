# Prompt parts

An optional, default-off view: enable **Prompt parts** in Features or use
`?bricks=prompt-parts`. Twelve developer parts each have a name, job, prompt,
input description and output description. The opening cache-expiry diff and
two answers are explicitly labelled illustrative examples; opening makes no
model request. Select a map thought or paste text, select a part, optionally
select a second part, and run. The second receives the first answer verbatim.
The composition tree keeps each answer and its exact input visible.

`index.tsx` orchestrates the catalog, workbench and composition. `records.ts`
reads the shared `parts.json`; `useComposition.ts` owns execution and
cancellation; `runtime.ts` owns the bounded transport. No microphone action,
external tool execution, map mutation or automatic request is involved.
Local draft and result state use the host's plugin-state scope. Answers are
text, never rendered HTML. Partial or failed answers do not start a later part.

## Server handoff

The new-folder-only constraint leaves the shared core router unchanged.
`server.rs` provides the dedicated `POST /flow/prompt-parts` route, using the
same `Core::call_model_noting` path as `core/src/clarify.rs`. It pins
`muse-spark-1.3` at Meta's endpoint, takes a catalog ID rather than an arbitrary
prompt, bounds the body and input, sets a 35-second timeout, and returns only
a bounded text answer or a generic error. It reads this folder's `parts.json`.

To mount it, the hub can add this module in `core/src/main.rs`:

```rust
#[path = "../../ui/src/bricks/prompt-parts/server.rs"]
mod prompt_parts;
```

Merge `.merge(prompt_parts::routes())` into the existing `Router<Arc<Core>>`
before its final `.with_state(...)`. The `/flow` prefix uses the existing Vite
proxy. No credentials belong in this feature.

Until mounted, a 404/405 falls back to the already mounted `/flow/run`, which
uses Muse Spark and accepts the part's prompt and bounded input. The client
accepts its NDJSON stream, waits for completion before chaining, and surfaces
clarification requests or failures without feeding them downstream. Other
HTTP errors do not fall back. Each part has a 45-second client timeout and
the Stop button aborts the request; an already accepted upstream model call
may finish on the server. The dedicated Rust module needs the hub's compile
check after mounting; no shared core file is edited here.

## Focused check

Run `node ui/src/bricks/prompt-parts/check.mjs`. It type-checks this entry and
builds an isolated browser fixture. Synthetic responses exercise the example,
catalog, exact two-step input, selected thought, failed-first stopping,
cancellation, streamed fallback, input limit, and 390/320px layout. Screenshots
and the temporary fixture remain in the printed artifact directory. No live
model, microphone, listening port or existing browser session is used.

The repository has no `preflight.sh`; the hub owns landing checks. This lane
commits only this folder and does not push.

Handoff: 2026-11-04 17:46 BC. The focused command above passed, including
the TypeScript entry check and synthetic browser assertions. Desktop image
reviewed; screenshots remain with the temporary check artifacts. The initial
Mac import-case collision and two standalone harness configuration errors
were corrected before the passing run. No live-model or Rust compile check
was run.
