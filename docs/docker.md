# Docker

From the repository root, with Docker Engine/Desktop and Docker Compose v2:

```sh
docker compose up --build --wait
```

Open **http://localhost:8080/?sample**. A fresh volume opens the student's week,
labelled **SAMPLE**, with eight topics, saved pictures and an unfinished thought.
No key or microphone is needed. Try **Where was I?** and **Pictures**. New thoughts
need a working Meta key for automatic placement.

The first build downloads Rust/npm dependencies and needs internet access. The
finished keyless sample runs without model access. The images build natively for
the Docker host; Linux containers also work through Docker Desktop on Mac or Windows.
Container builds and those platforms have not yet been verified for this change.

To enable Spark, supply `MODEL_API_KEY` in the launching shell through your secret
manager, then run the same command. Compose passes it only to the core at runtime;
the image contains no key. After changing or removing the variable, rerun
`docker compose up --build --wait` to recreate the app with the new environment.
The core uses its existing Meta model defaults; no GPT provider is added. Keyed
features require outbound HTTPS and a valid Meta key with model access. Never put
the key in the Dockerfile, build arguments, command history or tracked files.

The named `sample-data` volume keeps edits across restarts. The entrypoint seeds
only when there is no journal; restarting does not reset an existing map. Stop
with `docker compose down` (the volume stays). For a separate fresh example without
erasing the old one, use `docker compose -p e2a2o-fresh up --build --wait` after
stopping the first stack, since both use localhost port 8080.

## Container parts

- `ui-build`: installs the locked npm dependencies and builds both UI pages.
- `core-build`: builds and strips the locked Rust core, using Alpine's shared
  musl/OpenSSL libraries. Neither compiler nor Node is in the runtime image.
- `app`: a non-root Alpine runtime, the UI, public sample fixtures, and the core.
  `/app/LICENSE`, `/app/THIRD_PARTY_NOTICES.md` and `/app/dependency-licences/`
  retain the project's licence and the dependency notice bundle. The bundle's
  [documented gaps](../dependency-licences/UNRESOLVED.md) still require review
  before distributing affected components; including it is not release approval.
- `gateway`: a non-root TCP relay sharing the app's network namespace. It forwards
  port 8080 to the core's loopback-only port 4321, retaining Host/Origin checks and
  WebSocket upgrades. Only host loopback port 8080 is published. This is a local
  desktop setup, not a public/LAN deployment or shared-room configuration.

Compose waits for the core and relay health checks before returning. The
[Compose networking documentation](https://docs.docker.com/compose/how-tos/networking/)
describes sharing a service's network namespace. The
[Rust linking RFC](https://github.com/rust-lang/rfcs/blob/main/text/1721-crt-static.md)
describes the musl dynamic-linking flag used in the build.

## What cannot run inside these containers

- Crew and the local development routes: hosted mode intentionally disables them.
  Use the local launch described in the README for Crew.
- macOS automation: AppleScript, Reminders, Calendar.app, Notes, Messages,
  Mail.app, and login Keychain access. Calendar-file downloads can still work.
- Host-local speech tools, audio devices and installed OS voices. Browser speech
  playback uses voices on the computer opening the page, if available; the
  container provides none. Browser capture/Meta transcription still needs a user
  gesture, permission and a valid key. Startup never opens the microphone.
- Host CLI/repository integrations (such as `gh` or local coding helpers). No host
  filesystem, credentials or Docker socket is mounted.

## Verification on a Docker machine

Docker is absent on the implementation Mac: no image build, container startup,
browser run or live Spark request has been performed. Run these from a clean,
keyless shell on a Docker machine; do not start a microphone.

Local review checks: `sh -n docker/entrypoint.sh`, Ruby's `Psych.safe_load` of
`compose.yaml`, and `git diff --check` passed. The attempted Python YAML check
could not run because PyYAML is not installed; no package was installed for it.

1. Validate and build, then wait for both services to be healthy:

   ```sh
   unset MODEL_API_KEY
   docker compose config --quiet
   docker compose up --build --wait
   docker compose ps
   ```

2. Verify HTTP and the keyless capabilities through the published relay:

   ```sh
   curl --fail --silent --show-error 'http://localhost:8080/?sample' > /dev/null
   curl --fail --silent --show-error http://localhost:8080/room |
     python3 -c 'import json,sys; r=json.load(sys.stdin); assert r["sample"] and r["member"] and not r["room"] and r["models"] == []; print("keyless sample ready")'
   ```

3. Open **http://localhost:8080/?sample**. Confirm the **SAMPLE** label, eight
   topics, connected status and **No AI key**. Use **Where was I?** to reach the
   unfinished thought and **Pictures** to see saved pictures. These interactions
   exercise the WebSocket and image routes. Keep the microphone off.

4. Confirm an edit survives restarting: rename a sample topic, then run
   `docker compose restart app gateway`, rerun the HTTP checks, and reload the
   page. The changed topic should remain. Inspect runtime contents and image size:

   ```sh
   docker compose exec app sh -c 'test "$(id -u)" = 10001 && ! command -v node && ! command -v cargo && ! command -v rustc && test -s /app/LICENSE && test -s /app/THIRD_PARTY_NOTICES.md && test -s /app/dependency-licences/inventory.json'
   docker image inspect "$(docker compose images -q app)" --format '{{.Size}} bytes'
   docker compose logs --tail=40 app gateway
   ```

5. Optional, with your Meta key supplied securely in the shell: rerun the launch
   command, verify `/room` lists Spark models, and type a new thought. Wait for it
   to land and for the status line to name Spark. A refused key or failed request
   is a failure, not evidence that live Spark works. This may incur Meta usage.

6. Stop with `docker compose down`. Do not add `--volumes`; the map is retained.
