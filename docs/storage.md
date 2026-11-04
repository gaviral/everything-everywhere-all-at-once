# External map storage

Runtime data is kept outside source checkouts. The core owns the location rules; launchers ask the same resolver rather than constructing their own defaults.

| Platform | App-data root |
| --- | --- |
| macOS | `$HOME/Library/Application Support/e2a2o` |
| Linux | `$XDG_DATA_HOME/e2a2o`, or `$HOME/.local/share/e2a2o` when XDG is unset or empty |
| Windows | `$LOCALAPPDATA/e2a2o` |

Without a name, the map is the app-data root. A safe single-component name selects a child, such as `sample`, `demo`, `room` or `my map`. Windows launch through WSL uses the Linux default. Absolute names, separators, traversal, control characters and `.git` names are refused. Missing required home values and relative platform roots fail rather than falling back into the checkout.

`E2A2O_DATA` is a **complete map directory override**. Naming a map or selecting sample, founder sample, demo, room or trial never appends to or replaces this override. An explicitly empty override fails. A relative override is resolved from the caller's original physical working directory, captured as `E2A2O_CALLER_CWD` before launcher `cd`; the core receives that same base. Direct core invocation uses its own working directory unless this absolute base is supplied.

For example, from a directory outside the checkout:

```sh
E2A2O_DATA="maps/example with spaces" /path/to/clone/run.sh demo
```

The chosen map is `maps/example with spaces` beneath that original directory. Demo labels and fixture/replay selection remain demo/sample even when the directory has a different name.

## Read-only location check

```sh
e2a2o-core --data-path sample
E2A2O_DATA="maps/example" e2a2o-core --data-path demo
```

The executable prints only the absolute canonical map directory. It creates no directories or files, reads no environment files or keys, and connects/listens nowhere. A missing directory is reported using its validated existing ancestors and normalized missing suffix. Source users can first build the executable with `cargo build --manifest-path core/Cargo.toml`; build artifacts are separate from runtime data.

Targets inside any Git checkout/worktree are refused, including a `.git` file used by a linked worktree. Symlinked targets, existing ancestors (even with missing children) and symlinks within an existing map are refused before runtime writes. Use a physical directory path, rather than a symlink alias. Startup validates before creating a journal, lock, image directory, trace or TLS identity.

The map boundary contains `journal.jsonl`, its identity, the core lock, `images/`, optional `trace.jsonl`, `tls/`, sample markers/backups and trial claims/logs/link files. Trial uses a fresh named map by default. With an override, it uses exactly that directory; an existing trial claim refuses reuse so logs are not overwritten. Claims and logs remain as receipts after exit; choose a new directory for another trial.

## Samples and existing maps

`./run.sh sample` and `./run.sh sample founder` retain their public sample labels and selected fixture identity. A new empty destination may be seeded. An existing nonempty map must have a recognized versioned sample marker and matching journal identity; an override does not bypass this check. Switching between the student and founder fixtures is allowed only on that verified sample destination; its marker records the selected fixture after seeding. The core lock prevents resetting a map while a core has it open. Reset retains the prior journal, images and marker in a uniquely named `sample-backup-*` directory inside the selected map. No destructive reset is performed.

## Legacy checkout data

When a default launch finds legacy `data/` in the checkout, it stops with a manual-migration diagnostic instead of silently opening an empty external replacement. It does not open, move or migrate the legacy map. Preserve the source and use separate migration tooling to copy it into a new external directory, verify the copy, then explicitly select that directory with `E2A2O_DATA`. Do not move a live map. This app does not provide migration tooling or claim that a migration has happened.
