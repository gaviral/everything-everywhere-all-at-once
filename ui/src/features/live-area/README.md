# Live development area

Switch: `intake1411-live-area`, `defaultEnabled: false`. `index.ts` exports the feature descriptor, component and typed source contracts. Host wiring is pending. The host supplies a controlled `enabled` value, `onEnabledChange`, stable `adapters`, and optional `selected` run/branch/build identity. There are no other feature imports, producers, network adapters or runtime model dependencies.

## Parts and behavior

`ActivitySource` observes the external feed owner's permitted redacted events through `StatusSource<ActivityEvent>`. `BuildStatusSlot` and `VersionStatusSlot` receive exact matching records. `StatusJoin` joins immutable run/branch/build identities, keeping agents separate. `SelectedStatus` also presents build/version status before matching activity arrives. `LiveArea` composes the view, source summary and off control.

Each injected source must announce its connection state and return an unsubscribe function that releases its resources. Sequence numbers increase per record over reconnects, including replay; new runs use new run IDs. Lower/equal sequence numbers and regressing timestamps cannot replace accepted records. Connection epochs keep retained identities stale until newer matching records arrive. Records older than 30 seconds display as stale; an idle source also becomes stale. Missing adapters or matching references display unavailable. Source text and identifiers must already be redacted for display; worktree references are labels, never local paths.

Turning off releases the three observers and freshness timer. Late callbacks cannot update the consumer. Accepted records remain in memory while the component stays mounted; each source ledger is bounded to 200 records. No user data or producer files are written or erased. Replacing the adapter object creates a new consumer, so hosts should keep adapters stable.
