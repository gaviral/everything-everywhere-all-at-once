# Revision review

An opt-in view. Enable **Revision review** in Features, or open the playground
at `bricks.html?brick=revision-review`. No shared app files change.

The opening artifact is explicitly an interactive example, never actual completed
work. **Bring your own work** creates a real local artifact from text or an exact
copy of a placed thought's original words. A working copy is independent of its
source; **Open original map words** uses the host's exact-thought navigation.

Each artifact contains immutable numbered content revisions, with three distinct
records:

- Passage comments carry the exact quote, UTF-16 start/end offsets, author and
  revision. Duplicate passages remain distinct. Select words with a pointer, or
  open **Choose exact words by keyboard**, type the literal passage and choose
  its occurrence. Each match names its offsets and surrounding words.
- **Ready for review** invites a human decision. Approval requires an explicit
  checkbox and button; reading, commenting and acknowledging cannot approve.
  Request changes requires a review note. A decision stays on that revision.
- **Completed · human verified** requires approval, an observed resulting effect,
  concrete evidence, and a human verification checkbox. The receipt displays the
  verifier, time, effect and evidence. It is a person's attestation; no external
  execution or automated verification is claimed. AI participants cannot make
  approval or completion decisions.

Editing even the title creates a new draft revision. Comments, decisions and
receipts remain inspectable in history and never carry forward. Mutation commands
include the observed revision, so a stale action cannot approve newer content.

State belongs to this page visit, map and participant through the host's plugin
state. Selection, revisions and saved records survive a source jump and return or
feature remount; a page reload ends this scope. Unsent revision edits are retained
within the visit. **Export review record** hands a complete plain-text JSON record
to the browser through the host; a browser handoff is not proof of a disk save.
No map mutation, microphone, model, connection or external request is started.

`node ui/src/bricks/revision-review/check.mjs` runs only this feature's scoped
TypeScript check, isolated production bundle and headless browser flow, with
temporary screenshots kept for inspection. It uses an isolated browser profile,
synthetic map and ephemeral HTTP port. It does not test the live core or external
effects.

The isolated host fixtures live in `ui/checks/revision-review/`, outside the
feature's runtime files.

Parts: `index.tsx` orchestrates; `useWorkspace.ts` owns visit state; `model.ts` guards
revision transitions; `ArtifactIntake`, `PassageComments`, `RevisionEditor`,
`PassagePicker`, `ReviewDecision`, `CompletionEvidence` and `RevisionHistory` each own one visible
step. CSS is scoped and attached by the host.
