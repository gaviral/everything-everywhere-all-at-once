# Flow

Open `/?flow&rehearse` for the capture-and-boxes rehearsal. The map starts clear; Flow opens when you ask for boxes. The panel stays beside the map. At 4K the map uses larger reading size. Close Flow or say **close Flow** to see the whole map; **open Flow** brings it back.

Say a thought, then **run that through three boxes:** followed by the steps you want. **Take the garden thought. Run it through three boxes:** can choose a named topic. The last thought in that topic is the input. With existing boxes, **run that through** uses the latest thought again. Ordinary speech continues to land on the map while the boxes run, and **where was I?** keeps its usual meaning.

Every box calls Muse Spark 1.3 through the core's key, budget and status checks. Output streams from the service. The clocks measure active request time, including earlier requests when a box asks for clarification; they pause while waiting for you. A necessary question comes from Spark, turns the box amber and enters the existing held stack. After the existing natural pause, it appears in large text. Say the answer to resume. No questions or answers are scripted.

**Open the second box** shows its prompt and exact input. **Make it kinder** edits the selected box and reruns the same source, keeping its clarifications. **Stop the boxes** cancels the run in this window. The completed result is saved as an AI point on the original thought's topic. A changed or removed source refuses publication.

**Send that to NAME** puts the saved final result on the existing stoppable send card. **Stop** uses the existing cancellation path. Sending needs the Full preset and a matching name in private `MESSAGES_TO`. It is a dry run unless private `MESSAGES_SEND=on` explicitly enables sending. No recipient address belongs in the repository. The allow-list and host checks still apply.

Save writes only the graph and prompts to `flows.json` in the map's data directory. Share puts only those prompts in a link fragment. These boxes transform text; they cannot run arbitrary code. Refreshing retains the map result, but an unfinished run and its in-memory clarifications do not resume.

## Verification

`FILM_URL=http://localhost:4458 node scripts/film-chain-live.mjs` is an explicit live-service check on a temporary map with a dry-run contact named Phone. It sends synthetic turns through the existing core transport, tests capture, concurrent speech routing, a generated held question, answer/resume, original-topic return, edit, send card and Stop. It records screenshots in a temporary directory. It does not prove a human microphone, physical TV distance or phone delivery.

`FLOW_URL=http://localhost:4458 node scripts/flow-happy-live.mjs` exercises the standalone editor, variants and saved graphs. These explicit live checks are kept outside the automatic offline gate.

Initial base: commit `1af6ef1351f6225e20faf39983d9cdecfd157591`, verified on main. Contract snapshot: tree `5d077daca802c43913a2fc1ee10895d8aa8a2da0`.
