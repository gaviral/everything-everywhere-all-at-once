Faithful reading is an optional view, off by default. Enable it in Features or with `?bricks=i-compact`, then choose Faithful reading in the view switch.

Each collapsible topic shows its existing concise map points with unchanged originals one click away. Reasons, uncertainty and AI authorship stay visible. The view creates no model calls. Empty maps open a labelled example; Change example source demonstrates invalidation without writing to the map.

Personal syntheses and topic-local questions use feature-owned in-memory state, scoped by map identity/visit and participant. They survive leaving and returning to the view during that visit even with Plugins off, and are not shared or retained across reload. Exact source snapshots include title, parent, wording, uncertainty and authorship. Additions, removals or wording changes invalidate the synthesis; editing it does not silently clear that warning. Explicit review binds it to current wording, and is unavailable while disconnected or without source points. Questions retain the topic's stable heading ID and the source snapshot when recorded.

Run `node ui/src/bricks/i-compact/check.mjs` for the isolated visible-flow check, scoped TypeScript and feature build. It uses an owned browser with capture blocked, retained temporary artifacts and an ephemeral local test port.
