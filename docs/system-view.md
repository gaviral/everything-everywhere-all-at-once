# Live system design

Open **Agent work** from the map, then **Show system view** above the existing git lanes. The switch starts off on every visit. The local code canvas must already be enabled with `E2A2O_CODE_CANVAS=1`.

Read from Browser upwards: the Rust core holds the world, queues placement, refines the map, runs Flow boxes, journals transactions and coordinates helpers and agent jobs. Speech sessions appear only when someone explicitly starts them elsewhere. This view never starts a microphone, model call, job or git action.

Dots carry fixed event names from real core boundaries. Matching events are counted in 800 ms batches; busy animations queue and combine counts. Model starts travel outwards; completions, failures and cancellations return. Browser frames, map changes, live job states and confirmed core journal transactions have their own labels. Direct journal writes outside the core transaction and record methods are not traced. Unrecognized features and demonstration jobs are excluded.

Dashed lines explain structure only. Git lanes continue to use the existing code-canvas snapshot and branch board. The map does not infer model messages from agent counts or git changes.

**Pause messages** disconnects the observer and retains the last observed batch. Hiding the tab also disconnects it. Reconnection observes new events without replay. A stream gap reports missed counts without inventing dots. Reduced motion keeps the same text and counts with no moving packets. Small screens have a keyboard-focusable horizontal diagram; message text and controls fit the page.

The local-only stream carries fixed labels, directions, counts and observation times. It contains no thought text, prompts, task names, identities, source bodies, paths, audio or journal contents. No extra runtime dependency is required.
