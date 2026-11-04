# Placeholders

Off by default. Enable **Placeholders** in Features, or use `?placeholders`.
The card labels its example content and shows when the screen mask is on.
Open **Names to mask** to enter up to twelve names. Entries use a password field;
the list shows only `Person 1`, `Person 2`, etc. Names live in component memory
and are discarded when the feature unmounts. No storage or network calls.

Email addresses become `you@example.com`, phone numbers become
`+1 (555) 010-0100`, and the send card's recipient becomes `Example recipient`
even if that name was not configured. Configured names match whole words,
case-insensitively. Dates and short ordinary numbers remain readable.

The text pass finds sensitive text nodes and paints inert, masked copies over
their containing elements. It preserves the original nodes for React, text
selection and existing handlers. Editable fields get separate visual covers;
their native values and input events are unchanged. Labels and tooltips are
masked and restored on unmount. Links keep their original destinations.
This is a screen presentation feature: sending, copying and exporting continue
to use originals. It does not redact files, images or browser-owned UI.

`index.tsx` orchestrates settings, `mask-rules.ts` identifies replacements,
`text-pass.ts` owns text presentation, and `field-pass.ts` owns editable covers.
Both passes clean up on switch-off. All work stays in this feature folder.

Run the focused offline fixture from the repository root:

```sh
node ui/src/bricks/placeholder-mode/fixture/check.mjs
```

It type-checks only this feature, bundles its fixture in memory and uses an
isolated headless Chrome through a debugging pipe. It starts no server and uses
no microphone, model or actual sender. Desktop and phone screenshots stay in
the temporary directory reported by the check.
