# Flow

Open `/?flow`, or enable **Flow** in Features. Flow is an opt-in panel that keeps the pipeline, its prompts and its live results together. Close returns to the underlying map; Open Flow brings it back.

Describe a pipeline in the command field, then say or type **Let's test it** and the text to transform. **Open the enrich box** expands its prompt and exact inputs. A change such as **Make it shorter** edits the selected box and reruns the same input. **Show me two versions** runs two takes beside each other. Asking to add a box after a named step changes the pipeline in place.

Every box calls Muse Spark 1.3 through the core's key, rolling-hour budget and status checks. The planner returns one to six serial prompt steps. Streaming output is real; elapsed times come from the running call. A failed step retains its partial output, says why it stopped and leaves subsequent steps waiting. Pipelines execute text prompts only; they cannot run shell commands or arbitrary code.

Save writes the graph and prompts to `flows.json` in the current map's data directory using an atomic replacement. Saved pipelines reopen after reload. Inputs and outputs are not in that file. Share copies a link containing the graph and prompts in its fragment; recipients need access to a running copy of the app. It does not publish a hosted application or copy test input.

The voice button uses the existing speech capture. While the panel is open, fresh turns from its speaker reach an opt-in live stream before map navigation interprets them. Closing the panel returns turns to the map. The normal capture and microphone stop behavior remains in place. Historical turns are never replayed as commands. Nothing modifies the capture implementation or the existing Canvas feature.

## Verification

With the UI built and the core running on a fresh temporary map, run `FLOW_URL=http://localhost:4457 node scripts/flow-happy-check.mjs`. This explicit live-service check creates the graph, observes incremental output and sequential inputs, edits a box, compares versions, inserts a step, saves and reopens. It also records TV and phone screenshots in a temporary directory without deleting them. `FLOW_COMMANDS=turns` sends those commands through the existing core turn path instead of the feature’s text field. It does not verify a physical microphone or distance legibility with a human observer.

Initial build base: commit `1af6ef1351f6225e20faf39983d9cdecfd157591`, verified on main. Contract snapshot: tree `5d077daca802c43913a2fc1ee10895d8aa8a2da0`.
