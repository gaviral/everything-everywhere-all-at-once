# Workshop

Open Workshop in Features or add `?workshop` to the address. It reads the core’s current model configuration and the saved Flow library. Bring a model or saved box to the desk, enter text, choose a mode, and Run. Take away returns it to the shelf. Results stay in this visit; the desk clears when the map or participant changes.

“Bring Spark here” selects the first configured Spark version. Use the full displayed name to choose another version. “Take this away” removes the most recently brought or focused desk part. Commands also work through the app’s existing speech connection when the person chooses to start listening. Workshop never starts a microphone. Transcription observes live words; its transcript span measures first live words to the end of a turn, not service latency.

Text and image trials call the configured Meta model through the core’s normal budget and accounting. Saved boxes use Flow’s real streaming runner and retain their exact prompts. Each completed run shows elapsed server time. Stop waiting or removing a part cancels the browser’s wait; an already accepted server request may finish. Taking a part away discards its trial result.

Set `E2A2O_HACKATHON_FILE` on the core to an external local JSON file. Refresh reloads it. No event document is bundled in the public app. The file has this shape:

```json
{"schema":1,"updated":"Local update time","sections":[{"title":"Rules","items":["Event rule"]},{"title":"Dates","items":["Event date"]},{"title":"Rubric","items":["Scoring criterion"]},{"title":"What’s left","items":["Submission requirement to verify"]}]}
```

The local exporter selects event facts from the working event document. The submission checklist lists requirements to verify; it does not infer completion. Missing, malformed or oversized data shows an unavailable state. No server path or parse excerpt reaches the page.
