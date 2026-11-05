# Local configuration

The tracked `.env.example` is intentionally empty to satisfy the tree guard. Copy it to `.env`, then add `MODEL_API_KEY=` with your own key locally. The complete configuration reference below preserves the available options; uncomment only the options you need. Keep credentials in the ignored `.env` file.

```dotenv
# Copy to .env and add your Meta Model API key (dev.meta.ai).
MODEL_API_KEY=
# Optional: the models a placement's racing calls ask, lane i the (i mod n)th (default below). A slow spell mostly
# hits one model at a time, so two models ride through more of them than two calls to one.
# PLACER_MODELS=muse-spark-1.3,muse-spark-1.2
# Optional: one model for every placing call, and the one that explains selected words (default muse-spark-1.2).
# Contributor mode is a little faster and cheaper (median 3.0 s vs 3.3 s in our test), but Meta may keep
# what it reads to improve its products. A model set here is used as is.
# PLACER_MODEL=muse-spark-1.2-contributor
# Optional: Conversation partner in Features (off by default); private Meta model, no Contributor fallback.
# PARTNER_MODEL=muse-spark-1.2
# Optional: how many placement calls race, the first good answer winning (default 2; 1 halves placement spend).
# PLACER_RACE=1
# Optional: the model that tidies the map and runs apps, and the one for Recap (defaults to REFINER_MODEL).
# REFINER_MODEL=muse-spark-1.3
# RECAP_MODEL=muse-spark-1.3
# (Contributor mode is slower for Recap: drafts took a median 13.3 s vs 3.0 s in our test.)
# Optional: the model that sorts threads under themes (defaults to REFINER_MODEL, then muse-spark-1.3).
# TOPICS_MODEL=muse-spark-1.3
# PORT=4321
# Optional: open a room on the local network with this code (./run.sh room makes a fresh one).
# ROOM_CODE=
# Optional: HTTPS for ROOM_CODE rooms; ./run.sh room enables it by default. Ignored alone.
# ROOM_HTTPS=1
# Optional: models for importing past chats (never Contributor mode by default: chats are private).
# IMPORT_EXTRACT_MODEL=muse-spark-1.2
# IMPORT_MERGE_MODEL=muse-spark-1.3
# Optional: the most model calls the core makes in any hour (default 400; 0 turns the cap off).
# MODEL_CALLS_PER_HOUR=400
# Optional: JSON allowances for the Usage feature; no file keeps the meter hidden. Read every 60 seconds.
# USAGE_FILE=
# Optional: draw no thread pictures (no Muse Image calls); threads keep their letter tiles.
# PICTURES=off
# Optional: the preset. demo (the default) is the core alone; full adds every connector (Messages, Email, GitHub, Notes) and thinking helpers.
# PRESET=full
# Optional, Full and local host only: cap voice-started thinking helpers (default 12).
# Helpers start on; switch Thinking helpers off in Features to keep those requests as talk.
# HELPERS_MAX=12
# Optional: coding requests (including README) get one isolated branch/worktree per helper.
# Off by default: lists what would start without running a command or changing a repo.
# HELPERS_RUN=on
# HELPERS_REPO=/path/to/repository
# No shell: a whitespace-separated command, or a JSON argv array for paths/args with spaces.
# --json and --prompt-file are appended; brief text is only written to the prompt file.
# HELPERS_CMD=muse exec
# For an offline runner check: HELPERS_CMD=muse exec --provider echo
# Optional, Full only: who "ask Mia to …" may message, as name=handle (a phone number or Apple ID email), comma-separated.
# MESSAGES_TO=Mia=+15551234567, Sam=sam@example.com
# Optional, Full only: really send through Messages when the 5-second countdown ends. Off, every message is a dry run.
# MESSAGES_SEND=on
# Optional, Full only: email allow-list, name=address. Addresses stay in the core. Features > Email can turn it off.
# EMAIL_TO=Mia=mia@example.com, Sam=sam@example.com
# Optional, Full only: send via this laptop's Mail.app after the countdown. Off is a dry run; hosted stays talk.
# EMAIL_SEND=on
# Optional, Full only: the GitHub card ("show me the open pull requests") reads gh on this laptop, never writes.
# With no repo named it asks GITHUB_REPO, else the repo where the core runs. Repos by a name you'd say:
# GITHUB_REPO=owner/name
# GITHUB_REPOS=garden=owner/garden-planner, site=owner/site
# Optional, Full only: "save this thread as a note" really writes a new note into Apple Notes. Off, it's a dry run.
# NOTES_WRITE=on
```

## Containers

The optional [Compose setup](../compose.yaml) builds the UI and Rust core from the [Dockerfile](../Dockerfile). Run `docker compose up --build --wait`, then open `http://localhost:8080/?sample`. The keyless sample is labelled SAMPLE; a named volume keeps edits across restarts. `docker compose down` stops the stack and retains that volume. Container builds remain unverified. macOS automation and host CLI integrations are unavailable inside the container.
