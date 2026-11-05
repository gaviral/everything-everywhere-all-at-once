# Third-party dependency notices

The app's MIT licence covers its own code. Third-party components retain their own
terms, copyrights and notices. This inventory records the exact checked-in
`ui/package-lock.json` and `core/Cargo.lock`; it does not relicense dependencies.

Original source licence, copyright, AUTHORS and NOTICE files are preserved byte
for byte under [dependency-licences](dependency-licences/); Git line-ending conversion
is disabled for that evidence. Each package record in
[inventory.json](dependency-licences/inventory.json) includes its exact source,
lock integrity/checksum, original metadata SPDX expression, selected licence,
distribution category, evidence paths and SHA-256 hashes. Embedded copyright and
licence comments are preserved verbatim in `embedded-source-notices.json`, with
source file, line and full source hash. These supplementary extracts retain source
notices; they do not replace the original source or establish an exhaustive legal audit.
Inventory repository links use public HTTPS; retained package metadata is unmodified.

For alternative licences, this record selects MIT when offered, otherwise the
first stated alternative. Legacy Cargo `MIT/Apache-2.0` and `Apache-2.0 / MIT`
notation is retained as declared and treated as an alternative for selection.
Conjunctions remain conjunctions: ring is Apache-2.0 AND ISC; matchit is MIT AND
BSD-3-Clause; encoding_rs selects MIT AND BSD-3-Clause, including the WHATWG BSD
terms; unicode-ident selects MIT AND Unicode-3.0. Other Unicode-3.0 dependencies
retain that licence. Additional bundled-code terms remain in original notices,
including ring's once_cell and fiat notices and npm tooling's bundled notices;
selecting an OR branch does not discard those component obligations. All available
alternative licence texts are retained, even when not selected.

In particular, rolldown 1.2.16's [THIRD-PARTY-LICENSE](dependency-licences/npm/rolldown@1.2.16/THIRD-PARTY-LICENSE)
retains its additional MIT notices. security-framework 3.7.0's
[THIRD_PARTY](dependency-licences/cargo/security-framework@3.7.0/THIRD_PARTY)
states that it contains documentation adapted from Apple's Security Framework
and includes the original APSL-2.0 terms. Its package-level MIT selection does
not replace those documentation terms; the package metadata expression remains
recorded verbatim. Final artifact inclusion remains subject to packaging review.

Distribution labels describe lock/source metadata, not a measured final bundle.
Npm `dev=true` entries are build tooling; all 12 MPL-2.0 Lightning CSS entries are
in that category and are not automatically part of the browser runtime. Npm entries
without `dev=true` are UI runtime candidates (including type metadata), not proof
of code shipped. Cargo includes target-specific, optional and build support crates;
proc-macro packages are marked build-only, while other crates are conservatively
listed as core candidates. No build or target/feature resolution was run. The exact
release binary/UI contents require a separate packaging review. Release/binary
packaging must carry the applicable notices and required texts when that work occurs.

## Evidence and open sources

The original records used local lock-matched cached archives. The 32 added npm
records for QR-code support use exact archives fetched from the npm registry,
verified against the lockfile integrity before retaining their original notices.
No packages were installed. There are 346 third-party entries: 125 npm and 221
Cargo; the local app packages are excluded.
Of these, 46 have explicit evidence gaps: 43 npm platform archives are unavailable,
`@rolldown/binding-darwin-arm64` has no standalone licence text, and the published
`valuable` and `yasna` archives omit full licence texts. Their available metadata
and embedded notices are retained. A selected licence in an unresolved record is
a recorded choice from metadata, not an assertion that missing terms are satisfied.

[Unresolved records](dependency-licences/UNRESOLVED.md) give exact package/version,
reason and source URL. Inventory records include the locked integrity/checksum for
reproduction. Do not substitute a sibling platform package's licence or invent a
holder. Resolve missing archives/texts at their exact versions before distributing
affected components; recheck final artifact inclusion separately.

AI artwork, music and voice rights remain separate unresolved film-owner tasks.
This dependency ledger does not clear assets, recordings or generated media.

## Static verification

Run `python3 scripts/dependency-licences-check.py` to check lock coverage, selected
terms, critical source-text presence, evidence hashes and private-path/credential
patterns. Run `python3 scripts/dependency-licences-check.py --sources` where the
original caches are available to verify all retained source files and embedded
notice extracts against the lock-verified archives. Both commands are read-only,
perform no network access, installs, builds, model calls or app access, and report
unresolved entries separately from evidence consistency. Lock hashes below pin
this snapshot; changing a lock requires refreshing this inventory and its texts.
`python3 -B scripts/dependency-licences-check-test.py` runs read-only regression
checks, including omitted-notice cases for both the static and cached-source checks.

- `ui/package-lock.json` SHA-256: `128729d9de1ade90ed2bc687b3c0e761ba4f3e065832006b66b6b18736e777d3`
- `core/Cargo.lock` SHA-256: `dea32a133b145f81dac72138135ed02b969e5edab3f6257e0fcdf57ee4ff1767`

## Exact inventory

| Package | Version | Declared SPDX | Selected licence | Distribution | Original evidence |
| --- | --- | --- | --- | --- | --- |
| `@oxc-project/types` | 0.156.0 | MIT | MIT | build-only (lock dev=true) | [texts/metadata](dependency-licences/npm/@oxc-project__types@0.156.0/) |
| `@rolldown/binding-android-arm-eabi` | 1.2.16 | MIT | MIT | build-only (lock dev=true) | [missing source](dependency-licences/UNRESOLVED.md) |
| `@rolldown/binding-android-arm64` | 1.2.16 | MIT | MIT | build-only (lock dev=true) | [missing source](dependency-licences/UNRESOLVED.md) |
| `@rolldown/binding-darwin-arm64` | 1.2.16 | MIT | MIT | build-only (lock dev=true) | [texts/metadata](dependency-licences/npm/@rolldown__binding-darwin-arm64@1.2.16/); [gap](dependency-licences/UNRESOLVED.md) |
| `@rolldown/binding-darwin-x64` | 1.2.16 | MIT | MIT | build-only (lock dev=true) | [missing source](dependency-licences/UNRESOLVED.md) |
| `@rolldown/binding-freebsd-x64` | 1.2.16 | MIT | MIT | build-only (lock dev=true) | [missing source](dependency-licences/UNRESOLVED.md) |
| `@rolldown/binding-linux-arm-gnueabihf` | 1.2.16 | MIT | MIT | build-only (lock dev=true) | [missing source](dependency-licences/UNRESOLVED.md) |
| `@rolldown/binding-linux-arm64-gnu` | 1.2.16 | MIT | MIT | build-only (lock dev=true) | [missing source](dependency-licences/UNRESOLVED.md) |
| `@rolldown/binding-linux-arm64-musl` | 1.2.16 | MIT | MIT | build-only (lock dev=true) | [missing source](dependency-licences/UNRESOLVED.md) |
| `@rolldown/binding-linux-ppc64-gnu` | 1.2.16 | MIT | MIT | build-only (lock dev=true) | [missing source](dependency-licences/UNRESOLVED.md) |
| `@rolldown/binding-linux-s390x-gnu` | 1.2.16 | MIT | MIT | build-only (lock dev=true) | [missing source](dependency-licences/UNRESOLVED.md) |
| `@rolldown/binding-linux-x64-gnu` | 1.2.16 | MIT | MIT | build-only (lock dev=true) | [missing source](dependency-licences/UNRESOLVED.md) |
| `@rolldown/binding-linux-x64-musl` | 1.2.16 | MIT | MIT | build-only (lock dev=true) | [missing source](dependency-licences/UNRESOLVED.md) |
| `@rolldown/binding-openharmony-arm64` | 1.2.16 | MIT | MIT | build-only (lock dev=true) | [missing source](dependency-licences/UNRESOLVED.md) |
| `@rolldown/binding-win32-arm64-msvc` | 1.2.16 | MIT | MIT | build-only (lock dev=true) | [missing source](dependency-licences/UNRESOLVED.md) |
| `@rolldown/binding-win32-x64-msvc` | 1.2.16 | MIT | MIT | build-only (lock dev=true) | [missing source](dependency-licences/UNRESOLVED.md) |
| `@rolldown/pluginutils` | 1.0.1 | MIT | MIT | build-only (lock dev=true) | [texts/metadata](dependency-licences/npm/@rolldown__pluginutils@1.0.1/) |
| `@types/d3-color` | 3.1.3 | MIT | MIT | UI runtime candidate (lock dev not true; exact bundle inclusion unverified) | [texts/metadata](dependency-licences/npm/@types__d3-color@3.1.3/) |
| `@types/d3-drag` | 3.0.7 | MIT | MIT | UI runtime candidate (lock dev not true; exact bundle inclusion unverified) | [texts/metadata](dependency-licences/npm/@types__d3-drag@3.0.7/) |
| `@types/d3-interpolate` | 3.0.4 | MIT | MIT | UI runtime candidate (lock dev not true; exact bundle inclusion unverified) | [texts/metadata](dependency-licences/npm/@types__d3-interpolate@3.0.4/) |
| `@types/d3-selection` | 3.0.12 | MIT | MIT | UI runtime candidate (lock dev not true; exact bundle inclusion unverified) | [texts/metadata](dependency-licences/npm/@types__d3-selection@3.0.12/) |
| `@types/d3-transition` | 3.0.9 | MIT | MIT | UI runtime candidate (lock dev not true; exact bundle inclusion unverified) | [texts/metadata](dependency-licences/npm/@types__d3-transition@3.0.9/) |
| `@types/d3-zoom` | 3.0.9 | MIT | MIT | UI runtime candidate (lock dev not true; exact bundle inclusion unverified) | [texts/metadata](dependency-licences/npm/@types__d3-zoom@3.0.9/) |
| `@types/node` | 26.6.6 | MIT | MIT | build-only (lock dev=true) | [texts/metadata](dependency-licences/npm/@types__node@26.6.6/) |
| `@types/qrcode` | 1.5.6 | MIT | MIT | build-only (lock dev=true) | [texts/metadata](dependency-licences/npm/@types__qrcode@1.5.6/) |
| `@types/react` | 19.3.0 | MIT | MIT | UI runtime candidate (lock dev not true; exact bundle inclusion unverified) | [texts/metadata](dependency-licences/npm/@types__react@19.3.0/) |
| `@types/react-dom` | 19.3.0 | MIT | MIT | UI runtime candidate (lock dev not true; exact bundle inclusion unverified) | [texts/metadata](dependency-licences/npm/@types__react-dom@19.3.0/) |
| `@typescript/typescript-aix-ppc64` | 7.0.2 | Apache-2.0 | Apache-2.0 | build-only (lock dev=true) | [missing source](dependency-licences/UNRESOLVED.md) |
| `@typescript/typescript-darwin-arm64` | 7.0.2 | Apache-2.0 | Apache-2.0 | build-only (lock dev=true) | [texts/metadata](dependency-licences/npm/@typescript__typescript-darwin-arm64@7.0.2/) |
| `@typescript/typescript-darwin-x64` | 7.0.2 | Apache-2.0 | Apache-2.0 | build-only (lock dev=true) | [missing source](dependency-licences/UNRESOLVED.md) |
| `@typescript/typescript-freebsd-arm64` | 7.0.2 | Apache-2.0 | Apache-2.0 | build-only (lock dev=true) | [missing source](dependency-licences/UNRESOLVED.md) |
| `@typescript/typescript-freebsd-x64` | 7.0.2 | Apache-2.0 | Apache-2.0 | build-only (lock dev=true) | [missing source](dependency-licences/UNRESOLVED.md) |
| `@typescript/typescript-linux-arm` | 7.0.2 | Apache-2.0 | Apache-2.0 | build-only (lock dev=true) | [missing source](dependency-licences/UNRESOLVED.md) |
| `@typescript/typescript-linux-arm64` | 7.0.2 | Apache-2.0 | Apache-2.0 | build-only (lock dev=true) | [missing source](dependency-licences/UNRESOLVED.md) |
| `@typescript/typescript-linux-loong64` | 7.0.2 | Apache-2.0 | Apache-2.0 | build-only (lock dev=true) | [missing source](dependency-licences/UNRESOLVED.md) |
| `@typescript/typescript-linux-mips64el` | 7.0.2 | Apache-2.0 | Apache-2.0 | build-only (lock dev=true) | [missing source](dependency-licences/UNRESOLVED.md) |
| `@typescript/typescript-linux-ppc64` | 7.0.2 | Apache-2.0 | Apache-2.0 | build-only (lock dev=true) | [missing source](dependency-licences/UNRESOLVED.md) |
| `@typescript/typescript-linux-riscv64` | 7.0.2 | Apache-2.0 | Apache-2.0 | build-only (lock dev=true) | [missing source](dependency-licences/UNRESOLVED.md) |
| `@typescript/typescript-linux-s390x` | 7.0.2 | Apache-2.0 | Apache-2.0 | build-only (lock dev=true) | [missing source](dependency-licences/UNRESOLVED.md) |
| `@typescript/typescript-linux-x64` | 7.0.2 | Apache-2.0 | Apache-2.0 | build-only (lock dev=true) | [missing source](dependency-licences/UNRESOLVED.md) |
| `@typescript/typescript-netbsd-arm64` | 7.0.2 | Apache-2.0 | Apache-2.0 | build-only (lock dev=true) | [missing source](dependency-licences/UNRESOLVED.md) |
| `@typescript/typescript-netbsd-x64` | 7.0.2 | Apache-2.0 | Apache-2.0 | build-only (lock dev=true) | [missing source](dependency-licences/UNRESOLVED.md) |
| `@typescript/typescript-openbsd-arm64` | 7.0.2 | Apache-2.0 | Apache-2.0 | build-only (lock dev=true) | [missing source](dependency-licences/UNRESOLVED.md) |
| `@typescript/typescript-openbsd-x64` | 7.0.2 | Apache-2.0 | Apache-2.0 | build-only (lock dev=true) | [missing source](dependency-licences/UNRESOLVED.md) |
| `@typescript/typescript-sunos-x64` | 7.0.2 | Apache-2.0 | Apache-2.0 | build-only (lock dev=true) | [missing source](dependency-licences/UNRESOLVED.md) |
| `@typescript/typescript-win32-arm64` | 7.0.2 | Apache-2.0 | Apache-2.0 | build-only (lock dev=true) | [missing source](dependency-licences/UNRESOLVED.md) |
| `@typescript/typescript-win32-x64` | 7.0.2 | Apache-2.0 | Apache-2.0 | build-only (lock dev=true) | [missing source](dependency-licences/UNRESOLVED.md) |
| `@vitejs/plugin-react` | 6.1.2 | MIT | MIT | build-only (lock dev=true) | [texts/metadata](dependency-licences/npm/@vitejs__plugin-react@6.1.2/) |
| `@xyflow/react` | 12.12.0 | MIT | MIT | UI runtime candidate (lock dev not true; exact bundle inclusion unverified) | [texts/metadata](dependency-licences/npm/@xyflow__react@12.12.0/) |
| `@xyflow/system` | 0.0.83 | MIT | MIT | UI runtime candidate (lock dev not true; exact bundle inclusion unverified) | [texts/metadata](dependency-licences/npm/@xyflow__system@0.0.83/) |
| `ansi-regex` | 5.0.1 | MIT | MIT | UI runtime candidate (lock dev not true; exact bundle inclusion unverified) | [texts/metadata](dependency-licences/npm/ansi-regex@5.0.1/) |
| `ansi-styles` | 4.3.0 | MIT | MIT | UI runtime candidate (lock dev not true; exact bundle inclusion unverified) | [texts/metadata](dependency-licences/npm/ansi-styles@4.3.0/) |
| `camelcase` | 5.3.1 | MIT | MIT | UI runtime candidate (lock dev not true; exact bundle inclusion unverified) | [texts/metadata](dependency-licences/npm/camelcase@5.3.1/) |
| `classcat` | 5.0.5 | MIT | MIT | UI runtime candidate (lock dev not true; exact bundle inclusion unverified) | [texts/metadata](dependency-licences/npm/classcat@5.0.5/) |
| `cliui` | 6.0.0 | ISC | ISC | UI runtime candidate (lock dev not true; exact bundle inclusion unverified) | [texts/metadata](dependency-licences/npm/cliui@6.0.0/) |
| `color-convert` | 2.0.1 | MIT | MIT | UI runtime candidate (lock dev not true; exact bundle inclusion unverified) | [texts/metadata](dependency-licences/npm/color-convert@2.0.1/) |
| `color-name` | 1.1.4 | MIT | MIT | UI runtime candidate (lock dev not true; exact bundle inclusion unverified) | [texts/metadata](dependency-licences/npm/color-name@1.1.4/) |
| `csstype` | 3.2.3 | MIT | MIT | UI runtime candidate (lock dev not true; exact bundle inclusion unverified) | [texts/metadata](dependency-licences/npm/csstype@3.2.3/) |
| `d3-color` | 3.1.0 | ISC | ISC | UI runtime candidate (lock dev not true; exact bundle inclusion unverified) | [texts/metadata](dependency-licences/npm/d3-color@3.1.0/) |
| `d3-dispatch` | 3.0.1 | ISC | ISC | UI runtime candidate (lock dev not true; exact bundle inclusion unverified) | [texts/metadata](dependency-licences/npm/d3-dispatch@3.0.1/) |
| `d3-drag` | 3.0.0 | ISC | ISC | UI runtime candidate (lock dev not true; exact bundle inclusion unverified) | [texts/metadata](dependency-licences/npm/d3-drag@3.0.0/) |
| `d3-ease` | 3.0.1 | BSD-3-Clause | BSD-3-Clause | UI runtime candidate (lock dev not true; exact bundle inclusion unverified) | [texts/metadata](dependency-licences/npm/d3-ease@3.0.1/) |
| `d3-interpolate` | 3.0.1 | ISC | ISC | UI runtime candidate (lock dev not true; exact bundle inclusion unverified) | [texts/metadata](dependency-licences/npm/d3-interpolate@3.0.1/) |
| `d3-selection` | 3.0.0 | ISC | ISC | UI runtime candidate (lock dev not true; exact bundle inclusion unverified) | [texts/metadata](dependency-licences/npm/d3-selection@3.0.0/) |
| `d3-timer` | 3.0.1 | ISC | ISC | UI runtime candidate (lock dev not true; exact bundle inclusion unverified) | [texts/metadata](dependency-licences/npm/d3-timer@3.0.1/) |
| `d3-transition` | 3.0.1 | ISC | ISC | UI runtime candidate (lock dev not true; exact bundle inclusion unverified) | [texts/metadata](dependency-licences/npm/d3-transition@3.0.1/) |
| `d3-zoom` | 3.0.0 | ISC | ISC | UI runtime candidate (lock dev not true; exact bundle inclusion unverified) | [texts/metadata](dependency-licences/npm/d3-zoom@3.0.0/) |
| `decamelize` | 1.2.0 | MIT | MIT | UI runtime candidate (lock dev not true; exact bundle inclusion unverified) | [texts/metadata](dependency-licences/npm/decamelize@1.2.0/) |
| `detect-libc` | 2.1.2 | Apache-2.0 | Apache-2.0 | build-only (lock dev=true) | [texts/metadata](dependency-licences/npm/detect-libc@2.1.2/) |
| `dijkstrajs` | 1.0.3 | MIT | MIT | UI runtime candidate (lock dev not true; exact bundle inclusion unverified) | [texts/metadata](dependency-licences/npm/dijkstrajs@1.0.3/) |
| `emoji-regex` | 8.0.0 | MIT | MIT | UI runtime candidate (lock dev not true; exact bundle inclusion unverified) | [texts/metadata](dependency-licences/npm/emoji-regex@8.0.0/) |
| `fdir` | 6.5.0 | MIT | MIT | build-only (lock dev=true) | [texts/metadata](dependency-licences/npm/fdir@6.5.0/) |
| `find-up` | 4.1.0 | MIT | MIT | UI runtime candidate (lock dev not true; exact bundle inclusion unverified) | [texts/metadata](dependency-licences/npm/find-up@4.1.0/) |
| `framer-motion` | 14.9.0 | MIT | MIT | UI runtime candidate (lock dev not true; exact bundle inclusion unverified) | [texts/metadata](dependency-licences/npm/framer-motion@14.9.0/) |
| `fsevents` | 2.3.3 | MIT | MIT | build-only (lock dev=true) | [texts/metadata](dependency-licences/npm/fsevents@2.3.3/) |
| `get-caller-file` | 2.0.5 | ISC | ISC | UI runtime candidate (lock dev not true; exact bundle inclusion unverified) | [texts/metadata](dependency-licences/npm/get-caller-file@2.0.5/) |
| `is-fullwidth-code-point` | 3.0.0 | MIT | MIT | UI runtime candidate (lock dev not true; exact bundle inclusion unverified) | [texts/metadata](dependency-licences/npm/is-fullwidth-code-point@3.0.0/) |
| `lightningcss` | 1.33.0 | MPL-2.0 | MPL-2.0 | build-only (lock dev=true) | [texts/metadata](dependency-licences/npm/lightningcss@1.33.0/) |
| `lightningcss-android-arm64` | 1.33.0 | MPL-2.0 | MPL-2.0 | build-only (lock dev=true) | [missing source](dependency-licences/UNRESOLVED.md) |
| `lightningcss-darwin-arm64` | 1.33.0 | MPL-2.0 | MPL-2.0 | build-only (lock dev=true) | [texts/metadata](dependency-licences/npm/lightningcss-darwin-arm64@1.33.0/) |
| `lightningcss-darwin-x64` | 1.33.0 | MPL-2.0 | MPL-2.0 | build-only (lock dev=true) | [missing source](dependency-licences/UNRESOLVED.md) |
| `lightningcss-freebsd-x64` | 1.33.0 | MPL-2.0 | MPL-2.0 | build-only (lock dev=true) | [missing source](dependency-licences/UNRESOLVED.md) |
| `lightningcss-linux-arm-gnueabihf` | 1.33.0 | MPL-2.0 | MPL-2.0 | build-only (lock dev=true) | [missing source](dependency-licences/UNRESOLVED.md) |
| `lightningcss-linux-arm64-gnu` | 1.33.0 | MPL-2.0 | MPL-2.0 | build-only (lock dev=true) | [missing source](dependency-licences/UNRESOLVED.md) |
| `lightningcss-linux-arm64-musl` | 1.33.0 | MPL-2.0 | MPL-2.0 | build-only (lock dev=true) | [missing source](dependency-licences/UNRESOLVED.md) |
| `lightningcss-linux-x64-gnu` | 1.33.0 | MPL-2.0 | MPL-2.0 | build-only (lock dev=true) | [missing source](dependency-licences/UNRESOLVED.md) |
| `lightningcss-linux-x64-musl` | 1.33.0 | MPL-2.0 | MPL-2.0 | build-only (lock dev=true) | [missing source](dependency-licences/UNRESOLVED.md) |
| `lightningcss-win32-arm64-msvc` | 1.33.0 | MPL-2.0 | MPL-2.0 | build-only (lock dev=true) | [missing source](dependency-licences/UNRESOLVED.md) |
| `lightningcss-win32-x64-msvc` | 1.33.0 | MPL-2.0 | MPL-2.0 | build-only (lock dev=true) | [missing source](dependency-licences/UNRESOLVED.md) |
| `locate-path` | 5.0.0 | MIT | MIT | UI runtime candidate (lock dev not true; exact bundle inclusion unverified) | [texts/metadata](dependency-licences/npm/locate-path@5.0.0/) |
| `motion` | 14.9.0 | MIT | MIT | UI runtime candidate (lock dev not true; exact bundle inclusion unverified) | [texts/metadata](dependency-licences/npm/motion@14.9.0/) |
| `motion-dom` | 14.9.0 | MIT | MIT | UI runtime candidate (lock dev not true; exact bundle inclusion unverified) | [texts/metadata](dependency-licences/npm/motion-dom@14.9.0/) |
| `motion-utils` | 14.7.0 | MIT | MIT | UI runtime candidate (lock dev not true; exact bundle inclusion unverified) | [texts/metadata](dependency-licences/npm/motion-utils@14.7.0/) |
| `nanoid` | 3.3.20 | MIT | MIT | build-only (lock dev=true) | [texts/metadata](dependency-licences/npm/nanoid@3.3.20/) |
| `p-limit` | 2.3.0 | MIT | MIT | UI runtime candidate (lock dev not true; exact bundle inclusion unverified) | [texts/metadata](dependency-licences/npm/p-limit@2.3.0/) |
| `p-locate` | 4.1.0 | MIT | MIT | UI runtime candidate (lock dev not true; exact bundle inclusion unverified) | [texts/metadata](dependency-licences/npm/p-locate@4.1.0/) |
| `p-try` | 2.2.0 | MIT | MIT | UI runtime candidate (lock dev not true; exact bundle inclusion unverified) | [texts/metadata](dependency-licences/npm/p-try@2.2.0/) |
| `path-exists` | 4.0.0 | MIT | MIT | UI runtime candidate (lock dev not true; exact bundle inclusion unverified) | [texts/metadata](dependency-licences/npm/path-exists@4.0.0/) |
| `picocolors` | 1.1.1 | ISC | ISC | build-only (lock dev=true) | [texts/metadata](dependency-licences/npm/picocolors@1.1.1/) |
| `picomatch` | 4.0.7 | MIT | MIT | build-only (lock dev=true) | [texts/metadata](dependency-licences/npm/picomatch@4.0.7/) |
| `pngjs` | 5.0.0 | MIT | MIT | UI runtime candidate (lock dev not true; exact bundle inclusion unverified) | [texts/metadata](dependency-licences/npm/pngjs@5.0.0/) |
| `postcss` | 8.5.32 | MIT | MIT | build-only (lock dev=true) | [texts/metadata](dependency-licences/npm/postcss@8.5.32/) |
| `qrcode` | 1.5.4 | MIT | MIT | UI runtime candidate (lock dev not true; exact bundle inclusion unverified) | [texts/metadata](dependency-licences/npm/qrcode@1.5.4/) |
| `react` | 19.3.1 | MIT | MIT | UI runtime candidate (lock dev not true; exact bundle inclusion unverified) | [texts/metadata](dependency-licences/npm/react@19.3.1/) |
| `react-dom` | 19.3.1 | MIT | MIT | UI runtime candidate (lock dev not true; exact bundle inclusion unverified) | [texts/metadata](dependency-licences/npm/react-dom@19.3.1/) |
| `require-directory` | 2.1.1 | MIT | MIT | UI runtime candidate (lock dev not true; exact bundle inclusion unverified) | [texts/metadata](dependency-licences/npm/require-directory@2.1.1/) |
| `require-main-filename` | 2.0.0 | ISC | ISC | UI runtime candidate (lock dev not true; exact bundle inclusion unverified) | [texts/metadata](dependency-licences/npm/require-main-filename@2.0.0/) |
| `rolldown` | 1.2.16 | MIT | MIT | build-only (lock dev=true) | [texts/metadata](dependency-licences/npm/rolldown@1.2.16/) |
| `scheduler` | 0.28.0 | MIT | MIT | UI runtime candidate (lock dev not true; exact bundle inclusion unverified) | [texts/metadata](dependency-licences/npm/scheduler@0.28.0/) |
| `set-blocking` | 2.0.0 | ISC | ISC | UI runtime candidate (lock dev not true; exact bundle inclusion unverified) | [texts/metadata](dependency-licences/npm/set-blocking@2.0.0/) |
| `source-map-js` | 1.2.2 | BSD-3-Clause | BSD-3-Clause | build-only (lock dev=true) | [texts/metadata](dependency-licences/npm/source-map-js@1.2.2/) |
| `string-width` | 4.2.3 | MIT | MIT | UI runtime candidate (lock dev not true; exact bundle inclusion unverified) | [texts/metadata](dependency-licences/npm/string-width@4.2.3/) |
| `strip-ansi` | 6.0.1 | MIT | MIT | UI runtime candidate (lock dev not true; exact bundle inclusion unverified) | [texts/metadata](dependency-licences/npm/strip-ansi@6.0.1/) |
| `tinyglobby` | 0.2.17 | MIT | MIT | build-only (lock dev=true) | [texts/metadata](dependency-licences/npm/tinyglobby@0.2.17/) |
| `tslib` | 2.9.1 | 0BSD | 0BSD | UI runtime candidate (lock dev not true; exact bundle inclusion unverified) | [texts/metadata](dependency-licences/npm/tslib@2.9.1/) |
| `typescript` | 7.0.2 | Apache-2.0 | Apache-2.0 | build-only (lock dev=true) | [texts/metadata](dependency-licences/npm/typescript@7.0.2/) |
| `undici-types` | 8.9.0 | MIT | MIT | build-only (lock dev=true) | [texts/metadata](dependency-licences/npm/undici-types@8.9.0/) |
| `use-sync-external-store` | 1.7.0 | MIT | MIT | UI runtime candidate (lock dev not true; exact bundle inclusion unverified) | [texts/metadata](dependency-licences/npm/use-sync-external-store@1.7.0/) |
| `vite` | 8.3.5 | MIT | MIT | build-only (lock dev=true) | [texts/metadata](dependency-licences/npm/vite@8.3.5/) |
| `which-module` | 2.0.1 | ISC | ISC | UI runtime candidate (lock dev not true; exact bundle inclusion unverified) | [texts/metadata](dependency-licences/npm/which-module@2.0.1/) |
| `wrap-ansi` | 6.2.0 | MIT | MIT | UI runtime candidate (lock dev not true; exact bundle inclusion unverified) | [texts/metadata](dependency-licences/npm/wrap-ansi@6.2.0/) |
| `y18n` | 4.0.3 | ISC | ISC | UI runtime candidate (lock dev not true; exact bundle inclusion unverified) | [texts/metadata](dependency-licences/npm/y18n@4.0.3/) |
| `yargs` | 15.4.1 | MIT | MIT | UI runtime candidate (lock dev not true; exact bundle inclusion unverified) | [texts/metadata](dependency-licences/npm/yargs@15.4.1/) |
| `yargs-parser` | 18.1.3 | ISC | ISC | UI runtime candidate (lock dev not true; exact bundle inclusion unverified) | [texts/metadata](dependency-licences/npm/yargs-parser@18.1.3/) |
| `zustand` | 4.5.7 | MIT | MIT | UI runtime candidate (lock dev not true; exact bundle inclusion unverified) | [texts/metadata](dependency-licences/npm/zustand@4.5.7/) |
| `aho-corasick` | 1.1.5 | Unlicense OR MIT | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/aho-corasick@1.1.5/) |
| `anyhow` | 1.0.104 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/anyhow@1.0.104/) |
| `atomic-waker` | 1.1.2 | Apache-2.0 OR MIT | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/atomic-waker@1.1.2/) |
| `axum` | 0.8.9 | MIT | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/axum@0.8.9/) |
| `axum-core` | 0.5.6 | MIT | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/axum-core@0.5.6/) |
| `base64` | 0.22.1 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/base64@0.22.1/) |
| `base64` | 0.23.1 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/base64@0.23.1/) |
| `bitflags` | 2.13.2 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/bitflags@2.13.2/) |
| `block-buffer` | 0.10.4 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/block-buffer@0.10.4/) |
| `bumpalo` | 3.20.3 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/bumpalo@3.20.3/) |
| `byteorder-lite` | 0.1.0 | Unlicense OR MIT | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/byteorder-lite@0.1.0/) |
| `bytes` | 1.12.1 | MIT | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/bytes@1.12.1/) |
| `cc` | 1.10.0 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/cc@1.10.0/) |
| `cfg-if` | 1.0.5 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/cfg-if@1.0.5/) |
| `core-foundation` | 0.9.4 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/core-foundation@0.9.4/) |
| `core-foundation` | 0.10.1 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/core-foundation@0.10.1/) |
| `core-foundation-sys` | 0.8.7 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/core-foundation-sys@0.8.7/) |
| `core_detect` | 1.0.0 | MIT/Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/core_detect@1.0.0/) |
| `cpufeatures` | 0.2.17 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/cpufeatures@0.2.17/) |
| `crypto-common` | 0.1.7 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/crypto-common@0.1.7/) |
| `data-encoding` | 2.11.1 | MIT | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/data-encoding@2.11.1/) |
| `deranged` | 0.5.9 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/deranged@0.5.9/) |
| `digest` | 0.10.7 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/digest@0.10.7/) |
| `displaydoc` | 0.2.7 | MIT OR Apache-2.0 | MIT | build-only proc-macro (support dependencies may also be build-only) | [texts/metadata](dependency-licences/cargo/displaydoc@0.2.7/) |
| `dotenvy` | 0.15.7 | MIT | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/dotenvy@0.15.7/) |
| `encoding_rs` | 0.8.44 | (Apache-2.0 OR MIT) AND BSD-3-Clause | MIT AND BSD-3-Clause | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/encoding_rs@0.8.44/) |
| `equivalent` | 1.0.3 | Apache-2.0 OR MIT | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/equivalent@1.0.3/) |
| `errno` | 0.3.14 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/errno@0.3.14/) |
| `fastrand` | 2.5.0 | Apache-2.0 OR MIT | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/fastrand@2.5.0/) |
| `find-msvc-tools` | 0.1.15 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/find-msvc-tools@0.1.15/) |
| `fnv` | 1.0.7 | Apache-2.0 / MIT | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/fnv@1.0.7/) |
| `foreign-types` | 0.3.2 | MIT/Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/foreign-types@0.3.2/) |
| `foreign-types-shared` | 0.1.1 | MIT/Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/foreign-types-shared@0.1.1/) |
| `form_urlencoded` | 1.2.2 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/form_urlencoded@1.2.2/) |
| `futures-channel` | 0.3.34 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/futures-channel@0.3.34/) |
| `futures-core` | 0.3.34 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/futures-core@0.3.34/) |
| `futures-macro` | 0.3.34 | MIT OR Apache-2.0 | MIT | build-only proc-macro (support dependencies may also be build-only) | [texts/metadata](dependency-licences/cargo/futures-macro@0.3.34/) |
| `futures-sink` | 0.3.34 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/futures-sink@0.3.34/) |
| `futures-task` | 0.3.34 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/futures-task@0.3.34/) |
| `futures-util` | 0.3.34 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/futures-util@0.3.34/) |
| `generic-array` | 0.14.7 | MIT | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/generic-array@0.14.7/) |
| `getrandom` | 0.2.17 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/getrandom@0.2.17/) |
| `getrandom` | 0.3.4 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/getrandom@0.3.4/) |
| `getrandom` | 0.4.3 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/getrandom@0.4.3/) |
| `h2` | 0.4.20 | MIT | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/h2@0.4.20/) |
| `hashbrown` | 0.17.1 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/hashbrown@0.17.1/) |
| `http` | 1.5.0 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/http@1.5.0/) |
| `http-body` | 1.1.0 | MIT | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/http-body@1.1.0/) |
| `http-body-util` | 0.1.5 | MIT | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/http-body-util@0.1.5/) |
| `http-range-header` | 0.4.2 | MIT | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/http-range-header@0.4.2/) |
| `httparse` | 1.10.1 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/httparse@1.10.1/) |
| `httpdate` | 1.0.3 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/httpdate@1.0.3/) |
| `hyper` | 1.12.0 | MIT | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/hyper@1.12.0/) |
| `hyper-rustls` | 0.27.10 | Apache-2.0 OR ISC OR MIT | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/hyper-rustls@0.27.10/) |
| `hyper-tls` | 0.6.0 | MIT/Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/hyper-tls@0.6.0/) |
| `hyper-util` | 0.1.21 | MIT | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/hyper-util@0.1.21/) |
| `icu_collections` | 2.4.0 | Unicode-3.0 | Unicode-3.0 | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/icu_collections@2.4.0/) |
| `icu_locale_core` | 2.4.0 | Unicode-3.0 | Unicode-3.0 | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/icu_locale_core@2.4.0/) |
| `icu_normalizer` | 2.4.0 | Unicode-3.0 | Unicode-3.0 | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/icu_normalizer@2.4.0/) |
| `icu_normalizer_data` | 2.4.0 | Unicode-3.0 | Unicode-3.0 | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/icu_normalizer_data@2.4.0/) |
| `icu_properties` | 2.4.0 | Unicode-3.0 | Unicode-3.0 | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/icu_properties@2.4.0/) |
| `icu_properties_data` | 2.4.0 | Unicode-3.0 | Unicode-3.0 | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/icu_properties_data@2.4.0/) |
| `icu_provider` | 2.4.0 | Unicode-3.0 | Unicode-3.0 | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/icu_provider@2.4.0/) |
| `idna` | 1.1.0 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/idna@1.1.0/) |
| `idna_adapter` | 1.2.2 | Apache-2.0 OR MIT | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/idna_adapter@1.2.2/) |
| `image-webp` | 0.2.4 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/image-webp@0.2.4/) |
| `indexmap` | 2.14.2 | Apache-2.0 OR MIT | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/indexmap@2.14.2/) |
| `ipnet` | 2.12.2 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/ipnet@2.12.2/) |
| `itoa` | 1.0.18 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/itoa@1.0.18/) |
| `js-sys` | 0.3.107 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/js-sys@0.3.107/) |
| `lazy_static` | 1.5.1 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/lazy_static@1.5.1/) |
| `libc` | 0.2.191 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/libc@0.2.191/) |
| `linux-raw-sys` | 0.12.1 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/linux-raw-sys@0.12.1/) |
| `litemap` | 0.8.3 | Unicode-3.0 | Unicode-3.0 | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/litemap@0.8.3/) |
| `lock_api` | 0.4.14 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/lock_api@0.4.14/) |
| `log` | 0.4.35 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/log@0.4.35/) |
| `matchers` | 0.2.0 | MIT | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/matchers@0.2.0/) |
| `matchit` | 0.8.4 | MIT AND BSD-3-Clause | MIT AND BSD-3-Clause | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/matchit@0.8.4/) |
| `memchr` | 2.8.3 | Unlicense OR MIT | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/memchr@2.8.3/) |
| `mime` | 0.3.17 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/mime@0.3.17/) |
| `mime_guess` | 2.0.5 | MIT | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/mime_guess@2.0.5/) |
| `mio` | 1.2.4 | MIT | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/mio@1.2.4/) |
| `multiversion_no_op` | 1.0.0 | Apache-2.0 OR MIT | MIT | build-only proc-macro (support dependencies may also be build-only) | [texts/metadata](dependency-licences/cargo/multiversion_no_op@1.0.0/) |
| `native-tls` | 0.2.18 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/native-tls@0.2.18/) |
| `nu-ansi-term` | 0.50.3 | MIT | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/nu-ansi-term@0.50.3/) |
| `num-conv` | 0.2.2 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/num-conv@0.2.2/) |
| `once_cell` | 1.21.4 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/once_cell@1.21.4/) |
| `openssl` | 0.10.81 | Apache-2.0 | Apache-2.0 | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/openssl@0.10.81/) |
| `openssl-macros` | 0.1.1 | MIT/Apache-2.0 | MIT | build-only proc-macro (support dependencies may also be build-only) | [texts/metadata](dependency-licences/cargo/openssl-macros@0.1.1/) |
| `openssl-probe` | 0.2.2 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/openssl-probe@0.2.2/) |
| `openssl-sys` | 0.9.117 | MIT | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/openssl-sys@0.9.117/) |
| `parking_lot` | 0.12.5 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/parking_lot@0.12.5/) |
| `parking_lot_core` | 0.9.12 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/parking_lot_core@0.9.12/) |
| `percent-encoding` | 2.3.2 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/percent-encoding@2.3.2/) |
| `pin-project-lite` | 0.2.17 | Apache-2.0 OR MIT | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/pin-project-lite@0.2.17/) |
| `pkg-config` | 0.3.34 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/pkg-config@0.3.34/) |
| `potential_utf` | 0.1.6 | Unicode-3.0 | Unicode-3.0 | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/potential_utf@0.1.6/) |
| `powerfmt` | 0.2.1 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/powerfmt@0.2.1/) |
| `ppv-lite86` | 0.2.21 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/ppv-lite86@0.2.21/) |
| `proc-macro2` | 1.0.107 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/proc-macro2@1.0.107/) |
| `quick-error` | 2.0.1 | MIT/Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/quick-error@2.0.1/) |
| `quote` | 1.0.47 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/quote@1.0.47/) |
| `r-efi` | 5.3.0 | MIT OR Apache-2.0 OR LGPL-2.1-or-later | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/r-efi@5.3.0/) |
| `r-efi` | 6.0.0 | MIT OR Apache-2.0 OR LGPL-2.1-or-later | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/r-efi@6.0.0/) |
| `rand` | 0.9.5 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/rand@0.9.5/) |
| `rand_chacha` | 0.9.0 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/rand_chacha@0.9.0/) |
| `rand_core` | 0.9.5 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/rand_core@0.9.5/) |
| `rcgen` | 0.13.2 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/rcgen@0.13.2/) |
| `redox_syscall` | 0.5.18 | MIT | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/redox_syscall@0.5.18/) |
| `regex-automata` | 0.4.18 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/regex-automata@0.4.18/) |
| `regex-syntax` | 0.8.11 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/regex-syntax@0.8.11/) |
| `reqwest` | 0.12.28 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/reqwest@0.12.28/) |
| `ring` | 0.17.14 | Apache-2.0 AND ISC | Apache-2.0 AND ISC | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/ring@0.17.14/) |
| `rustix` | 1.1.6 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/rustix@1.1.6/) |
| `rustls` | 0.23.46 | Apache-2.0 OR ISC OR MIT | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/rustls@0.23.46/) |
| `rustls-pki-types` | 1.15.1 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/rustls-pki-types@1.15.1/) |
| `rustls-webpki` | 0.103.16 | ISC | ISC | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/rustls-webpki@0.103.16/) |
| `rustversion` | 1.0.23 | MIT OR Apache-2.0 | MIT | build-only proc-macro (support dependencies may also be build-only) | [texts/metadata](dependency-licences/cargo/rustversion@1.0.23/) |
| `ryu` | 1.0.23 | Apache-2.0 OR BSL-1.0 | Apache-2.0 | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/ryu@1.0.23/) |
| `schannel` | 0.1.30 | MIT | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/schannel@0.1.30/) |
| `scopeguard` | 1.2.0 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/scopeguard@1.2.0/) |
| `security-framework` | 3.7.0 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/security-framework@3.7.0/) |
| `security-framework-sys` | 2.17.0 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/security-framework-sys@2.17.0/) |
| `serde` | 1.0.229 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/serde@1.0.229/) |
| `serde_core` | 1.0.229 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/serde_core@1.0.229/) |
| `serde_derive` | 1.0.229 | MIT OR Apache-2.0 | MIT | build-only proc-macro (support dependencies may also be build-only) | [texts/metadata](dependency-licences/cargo/serde_derive@1.0.229/) |
| `serde_json` | 1.0.154 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/serde_json@1.0.154/) |
| `serde_path_to_error` | 0.1.20 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/serde_path_to_error@0.1.20/) |
| `serde_urlencoded` | 0.7.1 | MIT/Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/serde_urlencoded@0.7.1/) |
| `sha1` | 0.10.7 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/sha1@0.10.7/) |
| `sharded-slab` | 0.1.7 | MIT | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/sharded-slab@0.1.7/) |
| `shlex` | 2.0.1 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/shlex@2.0.1/) |
| `signal-hook-registry` | 1.4.8 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/signal-hook-registry@1.4.8/) |
| `simdutf8` | 0.1.5 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/simdutf8@0.1.5/) |
| `slab` | 0.4.12 | MIT | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/slab@0.4.12/) |
| `smallvec` | 1.16.4 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/smallvec@1.16.4/) |
| `socket2` | 0.6.5 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/socket2@0.6.5/) |
| `stable_deref_trait` | 1.2.1 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/stable_deref_trait@1.2.1/) |
| `subtle` | 2.6.1 | BSD-3-Clause | BSD-3-Clause | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/subtle@2.6.1/) |
| `syn` | 2.0.119 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/syn@2.0.119/) |
| `syn` | 3.0.9 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/syn@3.0.9/) |
| `sync_wrapper` | 1.0.2 | Apache-2.0 | Apache-2.0 | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/sync_wrapper@1.0.2/) |
| `synstructure` | 0.14.0 | MIT | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/synstructure@0.14.0/) |
| `system-configuration` | 0.7.0 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/system-configuration@0.7.0/) |
| `system-configuration-sys` | 0.6.0 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/system-configuration-sys@0.6.0/) |
| `tempfile` | 3.27.0 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/tempfile@3.27.0/) |
| `thiserror` | 2.0.21 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/thiserror@2.0.21/) |
| `thiserror-impl` | 2.0.21 | MIT OR Apache-2.0 | MIT | build-only proc-macro (support dependencies may also be build-only) | [texts/metadata](dependency-licences/cargo/thiserror-impl@2.0.21/) |
| `thread_local` | 1.1.10 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/thread_local@1.1.10/) |
| `time` | 0.3.55 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/time@0.3.55/) |
| `time-core` | 0.1.9 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/time-core@0.1.9/) |
| `tinystr` | 0.8.5 | Unicode-3.0 | Unicode-3.0 | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/tinystr@0.8.5/) |
| `tokio` | 1.54.1 | MIT | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/tokio@1.54.1/) |
| `tokio-macros` | 2.7.2 | MIT | MIT | build-only proc-macro (support dependencies may also be build-only) | [texts/metadata](dependency-licences/cargo/tokio-macros@2.7.2/) |
| `tokio-native-tls` | 0.3.1 | MIT | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/tokio-native-tls@0.3.1/) |
| `tokio-rustls` | 0.26.6 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/tokio-rustls@0.26.6/) |
| `tokio-tungstenite` | 0.26.2 | MIT | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/tokio-tungstenite@0.26.2/) |
| `tokio-tungstenite` | 0.29.0 | MIT | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/tokio-tungstenite@0.29.0/) |
| `tokio-util` | 0.7.20 | MIT | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/tokio-util@0.7.20/) |
| `tower` | 0.5.3 | MIT | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/tower@0.5.3/) |
| `tower-http` | 0.6.11 | MIT | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/tower-http@0.6.11/) |
| `tower-layer` | 0.3.3 | MIT | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/tower-layer@0.3.3/) |
| `tower-service` | 0.3.3 | MIT | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/tower-service@0.3.3/) |
| `tracing` | 0.1.44 | MIT | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/tracing@0.1.44/) |
| `tracing-attributes` | 0.1.31 | MIT | MIT | build-only proc-macro (support dependencies may also be build-only) | [texts/metadata](dependency-licences/cargo/tracing-attributes@0.1.31/) |
| `tracing-core` | 0.1.36 | MIT | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/tracing-core@0.1.36/) |
| `tracing-log` | 0.2.0 | MIT | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/tracing-log@0.2.0/) |
| `tracing-subscriber` | 0.3.23 | MIT | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/tracing-subscriber@0.3.23/) |
| `try-lock` | 0.2.5 | MIT | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/try-lock@0.2.5/) |
| `tungstenite` | 0.26.2 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/tungstenite@0.26.2/) |
| `tungstenite` | 0.29.0 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/tungstenite@0.29.0/) |
| `typenum` | 1.20.1 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/typenum@1.20.1/) |
| `unicase` | 2.10.0 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/unicase@2.10.0/) |
| `unicode-ident` | 1.0.27 | (MIT OR Apache-2.0) AND Unicode-3.0 | MIT AND Unicode-3.0 | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/unicode-ident@1.0.27/) |
| `untrusted` | 0.9.0 | ISC | ISC | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/untrusted@0.9.0/) |
| `url` | 2.5.8 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/url@2.5.8/) |
| `utf-8` | 0.7.6 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/utf-8@0.7.6/) |
| `utf8_iter` | 1.1.0 | Apache-2.0 OR MIT | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/utf8_iter@1.1.0/) |
| `utf_types` | 1.0.0 | Apache-2.0 OR MIT | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/utf_types@1.0.0/) |
| `uuid` | 1.29.0 | Apache-2.0 OR MIT | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/uuid@1.29.0/) |
| `valuable` | 0.1.1 | MIT | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/valuable@0.1.1/); [gap](dependency-licences/UNRESOLVED.md) |
| `vcpkg` | 0.2.15 | MIT/Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/vcpkg@0.2.15/) |
| `version_check` | 0.9.5 | MIT/Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/version_check@0.9.5/) |
| `want` | 0.3.2 | MIT | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/want@0.3.2/) |
| `wasi` | 0.11.1+wasi-snapshot-preview1 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/wasi@0.11.1+wasi-snapshot-preview1/) |
| `wasip2` | 1.0.4+wasi-0.2.12 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/wasip2@1.0.4+wasi-0.2.12/) |
| `wasm-bindgen` | 0.2.130 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/wasm-bindgen@0.2.130/) |
| `wasm-bindgen-futures` | 0.4.80 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/wasm-bindgen-futures@0.4.80/) |
| `wasm-bindgen-macro` | 0.2.130 | MIT OR Apache-2.0 | MIT | build-only proc-macro (support dependencies may also be build-only) | [texts/metadata](dependency-licences/cargo/wasm-bindgen-macro@0.2.130/) |
| `wasm-bindgen-macro-support` | 0.2.130 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/wasm-bindgen-macro-support@0.2.130/) |
| `wasm-bindgen-shared` | 0.2.130 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/wasm-bindgen-shared@0.2.130/) |
| `web-sys` | 0.3.107 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/web-sys@0.3.107/) |
| `windows-link` | 0.2.1 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/windows-link@0.2.1/) |
| `windows-registry` | 0.6.1 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/windows-registry@0.6.1/) |
| `windows-result` | 0.4.1 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/windows-result@0.4.1/) |
| `windows-strings` | 0.5.1 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/windows-strings@0.5.1/) |
| `windows-sys` | 0.52.0 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/windows-sys@0.52.0/) |
| `windows-sys` | 0.61.2 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/windows-sys@0.61.2/) |
| `windows-targets` | 0.52.6 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/windows-targets@0.52.6/) |
| `windows_aarch64_gnullvm` | 0.52.6 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/windows_aarch64_gnullvm@0.52.6/) |
| `windows_aarch64_msvc` | 0.52.6 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/windows_aarch64_msvc@0.52.6/) |
| `windows_i686_gnu` | 0.52.6 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/windows_i686_gnu@0.52.6/) |
| `windows_i686_gnullvm` | 0.52.6 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/windows_i686_gnullvm@0.52.6/) |
| `windows_i686_msvc` | 0.52.6 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/windows_i686_msvc@0.52.6/) |
| `windows_x86_64_gnu` | 0.52.6 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/windows_x86_64_gnu@0.52.6/) |
| `windows_x86_64_gnullvm` | 0.52.6 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/windows_x86_64_gnullvm@0.52.6/) |
| `windows_x86_64_msvc` | 0.52.6 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/windows_x86_64_msvc@0.52.6/) |
| `wit-bindgen` | 0.57.1 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/wit-bindgen@0.57.1/) |
| `writeable` | 0.6.4 | Unicode-3.0 | Unicode-3.0 | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/writeable@0.6.4/) |
| `yasna` | 0.5.2 | MIT OR Apache-2.0 | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/yasna@0.5.2/); [gap](dependency-licences/UNRESOLVED.md) |
| `yoke` | 0.8.4 | Unicode-3.0 | Unicode-3.0 | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/yoke@0.8.4/) |
| `yoke-derive` | 0.8.4 | Unicode-3.0 | Unicode-3.0 | build-only proc-macro (support dependencies may also be build-only) | [texts/metadata](dependency-licences/cargo/yoke-derive@0.8.4/) |
| `zerocopy` | 0.8.63 | BSD-2-Clause OR Apache-2.0 OR MIT | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/zerocopy@0.8.63/) |
| `zerocopy-derive` | 0.8.63 | BSD-2-Clause OR Apache-2.0 OR MIT | MIT | build-only proc-macro (support dependencies may also be build-only) | [texts/metadata](dependency-licences/cargo/zerocopy-derive@0.8.63/) |
| `zerofrom` | 0.1.8 | Unicode-3.0 | Unicode-3.0 | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/zerofrom@0.1.8/) |
| `zerofrom-derive` | 0.1.8 | Unicode-3.0 | Unicode-3.0 | build-only proc-macro (support dependencies may also be build-only) | [texts/metadata](dependency-licences/cargo/zerofrom-derive@0.1.8/) |
| `zeroize` | 1.9.1 | Apache-2.0 OR MIT | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/zeroize@1.9.1/) |
| `zerotrie` | 0.2.5 | Unicode-3.0 | Unicode-3.0 | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/zerotrie@0.2.5/) |
| `zerovec` | 0.11.9 | Unicode-3.0 | Unicode-3.0 | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/zerovec@0.11.9/) |
| `zerovec-derive` | 0.11.7 | Unicode-3.0 | Unicode-3.0 | build-only proc-macro (support dependencies may also be build-only) | [texts/metadata](dependency-licences/cargo/zerovec-derive@0.11.7/) |
| `zmij` | 1.0.23 | MIT | MIT | core dependency candidate (target/features and build-support inclusion unverified) | [texts/metadata](dependency-licences/cargo/zmij@1.0.23/) |
