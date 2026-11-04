# Hosted candidate rehearsal

This lane provides a provider-neutral, synthetic candidate package and an isolated
React preview. It does not publish, choose a cloud vendor, contact a public
endpoint, access credentials, start capture, change branches or enable other
features. The generated manifest is the rehearsal artifact; it is **not a
deployable application bundle**. Its fingerprint covers the exact canonical bytes
of `manifest.json`, including source identity, synthetic fixture, capabilities,
switches and hosting requirements.

Run from the repository root with the existing UI dependencies installed:

```sh
node scripts/intake1422/hosted-release/package.mjs --opt-in
node scripts/intake1422/hosted-release/check.mjs --opt-in
node scripts/intake1422/hosted-release/preview.mjs --opt-in
```

The package command resolves `HEAD` and `HEAD^` independently to full Git commit
IDs and verifies their object types. They identify source metadata, not a deployed
current/prior pair. Working-tree changes are excluded from those identities.
The command writes `manifest.json`, `candidate.json`, `prior.json` and `plan.json`
to a new ignored directory on every invocation. It never overwrites an artifact.

The check builds the owned parts and isolated preview, runs synthetic behavioral
checks, then opens its own headless Chrome profile on an ephemeral loopback port.
It writes desktop/phone screenshots, stops its recorded browser PIDs and closes
its server. Generated artifacts/profiles remain in the ignored `generated/`
directory; this lane does not delete them. Chrome can be selected with `CHROME`.
The preview command prints its own loopback URL and exits on Ctrl-C. All commands
require `--opt-in` before generating artifacts or starting a listener. None uses
the main application or an existing browser session.

## Host integration contract

The host owner can import `hostedReleaseFeature` and `HostedCandidateView` from
`ui/src/intake1422/hosted-release/index.ts`. The descriptor's ID is
`intake1422-hosted-release` and `defaultEnabled` is `false`. Mount with the host's
explicit enabled boolean, a validated candidate, a prior artifact and an
`expectedCurrent` identity containing revision, source kind and fingerprint.
Omitting `enabled` renders nothing and starts no verification. Disabling unmounts
the inspection, discards late results and changes no user or application data.

The standalone preview starts off too. Its controls select between two labelled
synthetic revisions, deliberately corrupt a fingerprint, and simulate a stale
current receipt. Turning inspection off and back on preserves those selections.
It does not register itself in App, the catalog, global styles or core routes.
Shared wiring is a host-owner dependency.

No caller may use the synthetic revisions as Git/deployment evidence. The
`git-commit` source kind is appropriate only after the caller has independently
resolved and type-checked that commit, as the package command does. Shape/hash
validation is an integrity check, not an authenticity signature or Git lookup.
All hosting requirements remain MISSING, even for a Git-sourced package. Promotion
and rollback are plans only: there is no execution function. They require exact
prior identity, matching source kinds and a different candidate revision. The
plan records the prior revision and fingerprint to restore, preserving session
data and prior switch configuration. No data migration is introduced.

## Named parts

| Part | Smaller parts / responsibility |
| --- | --- |
| CandidateIdentity | Full source validation, canonical serialization, SHA-256, identity comparison |
| CapabilityManifest | Local/hosted availability rows and default-off switch list |
| HostingContract | TLS, bidirectional session delivery, reconnect, budget, vendor evidence and release receipt requirements |
| CandidatePackage | Fixed synthetic manifest construction and schema/content/fingerprint verification |
| PromotionPlan | Prior-identity match, candidate validation, forward/rollback identities, blockers and owner steps |
| HostedCandidateView | Verification lifecycle, identity, availability, switches and plan display parts |
| Local tooling | Compiler, append-only artifact writer, loopback server, owned browser lifecycle, model and visible checks |

Available means usable in this local rehearsal. Unintegrated drawing/session
capabilities remain prerequisites, and native calendar bridging is explicitly
unsupported on the hosted route. Instance versus serverless selection still
requires primary-source cost/latency research by the architecture owner. No
vendor recommendation or new deployment receipt is claimed.

## Verification receipt

2026-11-04 14:50 BC

- Supplied checkout: `intake1422-hosted-release`, initially clean at
  `c331290f6204e02b751a96de63712c46c232ab59`. The local clone has no `dev` ref;
  base-from-dev provenance is supplied by the hub and cannot be independently
  verified here. No branch was created, reset, switched or pushed.
- `sh tools/overnight/preflight.sh intake1422-hosted-release`: exit 127,
  **REAL setup gap**, script absent. No `tools/overnight` inventory exists here.
- `sh tools/overnight/recheck.sh intake1422-hosted-release`: exit 127,
  same **REAL setup gap**. No assertion or guard was changed to bypass it.
- `./ui/node_modules/.bin/tsc --noEmit -p ui/tsconfig.json`: exit 0.
- `node scripts/intake1422/hosted-release/package.mjs --opt-in`: exit 0;
  generated a Git-sourced synthetic package for the initial HEAD above.
- `node scripts/intake1422/hosted-release/check.mjs --opt-in`: exit 0;
  exact file-byte hash, deterministic packaging, two synthetic revisions,
  unsupported/native status, defaults, forward/reverse rollback identities,
  stale identity rejection, rehashed invalid schema/feature/content rejection,
  desktop rendering, phone viewport and off/on selection retention passed.
  Screenshots: ignored `generated/check-fp1qDo/desktop.png` and `phone.png`.
  All recorded browser PIDs exited; the local server closed.
- Package command without opt-in: expected exit 1 before artifact generation.
- `node scripts/hosted-check.mjs`: exit 1, **STALE assertion**. Its direct-file
  host-word scanner flags the existing `import.meta.env.VITE_BUILD_ID` expression
  in `dev-build.ts` as host-only prose. Both that file and the check are unchanged
  from HEAD. This lane does not edit either outside its ownership.
- Owned JavaScript syntax checks and `git diff --check`: exit 0.
- No full integration gate was run. The hub owns the final gate; the named
  overnight scripts are unavailable in this checkout.

Live hosted SHA, hosted artifact, logged-out access, trusted TLS, real phone,
session transport/reconnect, microphone, cloud cost/latency, public publication
and film evidence remain **MISSING**. Desktop/phone emulation demonstrates only
the isolated preview's rendered behavior.
