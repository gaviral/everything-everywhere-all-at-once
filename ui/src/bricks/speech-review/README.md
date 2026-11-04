# Word review

An optional card for reviewing **pasted recognition text**, discovered from `brick.json`, off by default. It opens with a labelled example containing “pair”; a person can change it to “pier”, preview the exact result, and explicitly release the example to the map.

This is a bounded review surface, not the earlier branch's server-side live-speech hold. The current brick contract exposes live words only as observations; it cannot stop their placement. The card says that the live mic still sends directly. No microphone, capture handler, protocol, model or shared app file is changed.

Parts: `review.ts` owns draft creation and validation; `parts.tsx` owns source disclosure, pasted input, editing and release preview; `index.tsx` orchestrates them. `addThought` receives only the reviewed text, after the final click, using normal typed-command interpretation. Its acknowledgement means submitted, not saved or placed. Refusal retains the words for explicit retry. Original words stay available. Set aside / Restore previous review is reversible until another review is set aside.

Close preserves the tray. Switching off, reloading, or changing map/person clears its active state. There is no storage or automatic retry. Maximum release size: 6,000 Unicode characters; over-limit input is preserved with a visible explanation.

Focused check: `node scripts/speech-review-check.mjs`. It uses synthetic props and a private headless page, never a microphone, model or live map. It exercises edits, exact release, duplicate activation, disconnection, refusal/retry, source retention, close/reopen, reversible set-aside, map changes and narrow layout. It does not prove live-speech interception or durable core storage.
