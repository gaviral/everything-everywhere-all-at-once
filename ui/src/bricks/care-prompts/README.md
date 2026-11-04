# Care prompts

An off-by-default panel. Enable **Care prompts** in Features, open the corner
mark, then explicitly choose **Yes, turn on my prompts**. The example works
without consent and is always labelled. Scheduled prompts alternate between
“Take a break” and “Had some water?” at the chosen 30, 60 or 90 minute interval.
Tap a prompt once to dismiss it. **Stop** immediately cancels scheduled prompts.

Quiet hours follow this device's local clock, including overnight ranges.
Matching start/end times mean quiet all day. Quiet hours hide a visible prompt;
missed intervals never accumulate into multiple prompts. Changing the schedule
starts a fresh interval. No notification permissions, sound, microphone, network,
model calls or map actions are used.

Consent, settings and manual glass counts live in session storage, separately for
each `map.me`. They survive reloads in this tab. If storage is unavailable, the
feature works in memory and says that reloading will reset it. Manual glass
counts reset with the device's local calendar day. Nothing is shared with the map.

## Parts

- `index.tsx`: composes the corner mark, prompt and settings.
- `parts.tsx`: prompt, settings, timing controls and manual water card.
- `use-care.ts`: local preferences and clock lifecycle.
- `state.ts`: consent storage, quiet hours, scheduling and manual water count.
- `water.ts`: optional local water provider and reading lifecycle.

## Local water seam

`attachWaterProvider(provider)` accepts an adapter with
`getWater(): WaterReading | null | Promise<WaterReading | null>`. A reading has
`total` (today's glass count), `time` (Unix milliseconds), and optional `stale`.
The returned function detaches that adapter. Until a provider exists, or if it
fails or returns an invalid reading, the UI says **Phone water: Unavailable**.
Readings older than 30 minutes are visibly stale. Phone and manual counts stay
separate. Only an open settings panel polls the adapter, every 30 seconds;
closing it or removing the feature ends polling. An adapter must use already
authorized browser-local data; this feature does not connect a phone itself.

## Focused check

From the repository root:

```sh
node ui/src/bricks/care-prompts/checks/check.mjs
```

Runs the installed TypeScript compiler against this feature, then an isolated
React page in headless Chrome with a synthetic clock and local provider. Checks
opt-in, examples, frequency, dismissal and focus, quiet hours, immediate stop,
manual water, stale/detached provider, person separation and phone bounds. It
uses an ephemeral loopback HTTP port and DevTools pipes, never a microphone or
real core. It stops only its own Chrome PID and server. Throwaway screenshots,
browser profile and Vite cache are retained in the reported temporary folder.
