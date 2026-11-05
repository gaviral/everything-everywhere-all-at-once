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
# Optional: in-RAM thought index, focused model context and exact answer reuse (default off).
# E2A2O_MEMORY=1
# Optional: JSON allowances for the Usage feature; no file keeps the meter hidden. Read every 60 seconds.
# USAGE_FILE=
# Optional: draw no thread pictures (no Muse Image calls); threads keep their letter tiles.
# PICTURES=off
# Optional: the preset. demo (the default) is the core alone; full adds every connector (Messages, Email, GitHub, Notes) and thinking helpers.
# PRESET=full
# Optional, Full and local host only: cap voice-started thinking helpers (default 12).
# Helpers start on; switch Thinking helpers off in Features to keep those requests as talk.
# HELPERS_MAX=12
# Optional: coding requests (including README) get one isolated branch/worktree per helper; Git is required.
# Off by default: lists what would start without running a command or changing a repo.
# HELPERS_RUN=on
# HELPERS_REPO=/path/to/repository
# Leave HELPERS_CMD unset: the built-in runner calls Muse through the core's Meta API client.
# No separate coding CLI, provider account or key is required. MODEL_API_KEY supplies the Meta key.
# HELPERS_CMD=builtin-meta
# Custom command adapters are outside the submitted Meta-only runtime configuration.
# Optional, Full only: who "ask Recipient to …" may message, as name=handle (a phone number or Apple ID email), comma-separated.
# MESSAGES_TO=Recipient=+15551234567, Colleague=colleague@example.com
# Optional, Full only: really send through Messages when the 5-second countdown ends. Off, every message is a dry run.
# MESSAGES_SEND=on
# Optional, Full only: email allow-list, name=address. Addresses stay in the core. Features > Email can turn it off.
# EMAIL_TO=Recipient=recipient@example.com, Colleague=colleague@example.com
# Optional, Full only: send via this laptop's Mail.app after the countdown. Off is a dry run; hosted stays talk.
# EMAIL_SEND=on
# Optional, Full only: the GitHub card ("show me the open pull requests") reads gh on this laptop, never writes.
# With no repo named it asks GITHUB_REPO, else the repo where the core runs. Repos by a name you'd say:
# GITHUB_REPO=owner/name
# GITHUB_REPOS=garden=owner/garden-planner, site=owner/site
# Optional, Full only: "save this thread as a note" really writes a new note into Apple Notes. Off, it's a dry run.
# NOTES_WRITE=on
```

The [Memory feature](memory.md) can also be enabled from Features for the current
connection. Its card reports lookup time, context bytes saved and answer reuse.

## Containers

The optional [Compose setup](../compose.yaml) requires Docker Engine/Desktop and Compose v2. It builds the UI and Rust core from the [Dockerfile](../Dockerfile):

```sh
docker compose config --quiet
docker compose up --build --wait
```

Open `http://localhost:8080/?sample`. The keyless sample is labelled SAMPLE; a named volume keeps edits across restarts. `docker compose down` stops the stack and retains that volume. Supply `MODEL_API_KEY` through the launching shell to enable live Meta calls, then rerun the launch command after changing or removing it. Compose passes the key to the core at runtime; keep it out of the image and build arguments.

The runtime is non-root, without Node or Rust compilers. A relay shares the core's network namespace and publishes only host loopback port 8080, preserving the core's Host/Origin checks and WebSocket traffic. macOS automation, host CLI integrations and host audio devices are unavailable inside the container. Browser speech still depends on the computer opening the page.

The image includes `/app/LICENSE`, `/app/THIRD_PARTY_NOTICES.md` and `/app/dependency-licences/`. The bundle's [documented gaps](../dependency-licences/UNRESOLVED.md) still require review before distributing affected components; including it is not release approval. On a Docker machine, verify the runtime and bundled notices with:

```sh
docker compose exec app sh -c 'test "$(id -u)" = 10001 && ! command -v node && ! command -v cargo && ! command -v rustc && test -s /app/LICENSE && test -s /app/THIRD_PARTY_NOTICES.md && test -s /app/dependency-licences/inventory.json'
```

Container builds remain unverified. Verify HTTP, sample pictures and an edit surviving `docker compose restart app gateway` before relying on this setup. Live Spark calls require separate verification with a working Meta key.
