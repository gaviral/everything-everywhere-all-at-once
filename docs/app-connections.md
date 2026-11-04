# App connections prototype

Enable **App connections** in Features on the local Mac running the core. Enter a
reminder title match and an explicit Calendar date, then choose **Preview three
steps**. Preview and watcher triggers only propose a plan; they access no account.

1. **Confirm Read Reminders** reads the first incomplete matching title in the
   local **E2A2O** Reminders list. No match or a permission failure stops the plan.
2. Review the exact title, date, all-day duration and **E2A2O** Calendar destination.
   **Confirm Add to Calendar** creates one event and waits for Apple's result.
3. **Confirm Play tune** requests the local browser chime. Audio failure is shown
   separately and changes no Calendar receipt.

Each step requires its own click. Pending and completed steps cannot be confirmed
again. Failures block dependent steps; there is no automatic retry. Refresh reads
current receipts without executing anything. Dismiss removes the proposal, leaving
completed external actions in their apps. Plans and request deduplication are held
in core memory until restart. After an uncertain write or restart, inspect Calendar
before deliberately creating another plan. This prototype has no undo or durable
cross-restart deduplication.

Mini-apps may use a single publisher with no model prompt:

```json
{"kind":"app_block","block":{"query":"rent","when":"2026-11-06"}}
```

The existing watcher creates three proposals in the same hub. It never executes a
connection step or tune. Connection blocks are deliberately excluded from portable
recipes. The explicit form and execution path need no model. No GPT service is used.

Execution requires a local human window on a Mac, with the feature enabled. Hosted,
remote and AI windows cannot execute or read local titles. macOS Automation access
and real Reminders/Calendar integration require separate live verification; the
checks below use synthetic titles and adapter receipts only.

Focused checks:

```sh
cargo test --manifest-path core/Cargo.toml app_blocks
cargo test --manifest-path core/Cargo.toml apps::tests
node scripts/app-connections-check.mjs --modules-only
PRECHECK_PAGES=1 node scripts/app-connections-check.mjs
PRECHECK_PAGES=1 node scripts/bricks-check.mjs app-connections
```

Build the UI before the page checks. Browser checks use an isolated synthetic map and service receipts, never real accounts.
