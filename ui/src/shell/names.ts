// Every name the shell puts on screen, in one place: a rename (a naming study, a judge's word) is one edit here. Plain
// words, the industry term beside a feature's name where there is one (`aka`); "features" on screen, never "bricks".

export const NAMES = {
  wordmark: "E2A2O",
  map: { alone: "Your map", call: "Shared map" },
  stamp: { guest: "GUEST", sample: "SAMPLE", call: "CALL", demo: "DEMO" },
  stampSays: {
    guest: "A guest map: try everything; nothing needs an account.",
    sample: "An example map: its thoughts were said for the sample, not by you.",
    call: "A call: everyone here sees this map and hears what's said.",
    demo: "A scripted demo: the talk comes from a script, not live.",
  },
  find: "Find",
  findPlaceholder: "Find a topic or words",
  findNone: "Nothing found. Try different words.",
  catalog: "Catalog",
  recap: "Recap",
  export: "Export",
  close: "Close",
  backToMap: "Back to the Canvas",
  show: "Show",
  tabs: { talk: "Talk", history: "History", catalog: "Catalog", settings: "Settings" },
  composer: { idle: "Type a thought · Enter adds it", firstTap: "Tap to talk", firstType: "or type a thought", call: "Type to the call" },
  held: { label: "Held for a pause", asks: "asks when you stop", answer: "Answer", later: "Later" },
  history: {
    empty: "Nothing yet. What the AI does and every notice show here, newest first, each with what takes it back.",
    undo: "Undo",
    undone: "Undone",
  },
  catalogTab: {
    lead: (on: number, all: number) => `Features you can switch on · ${on} of ${all} on`,
    core: "Built in",
    missing: "Missing one? Say “make an app that…” and it's made for you to keep or not.",
  },
  /** The status line's one line of help after a state that needs something (the AI key, the mic's permission). */
  stateHelp: {
    nokey: "Listening and placing need MODEL_API_KEY in .env; you can still type.",
    nokeyHosted: "You can still type; what you type is placed once it's back.",
    refused: "Check MODEL_API_KEY in .env, then restart; you can still type.",
    refusedHosted: "You can still type.",
    resting: "Placed after midnight Pacific; you can still type.",
    blocked: "Allow the microphone for this page in the address bar, or type.",
  },
  tips: {
    ai: "Done by the AI. Undo takes it back where it still can.",
    friend: "An AI on this map. It holds its questions for your pause.",
  },
  settings: {
    say: "What you can say",
    keys: "Keys",
  },
} as const;

/** A feature as the Catalog names it: its name, the industry term it's also known by, its one line and where it shows. */
export type FeatureName = { name: string; aka?: string; does?: string; lives?: string };

/** The app's features by id (a feature's folder name, or a built-in's own id): what the shell calls each. A feature
 *  missing here shows its brick.json name and line. */
export const FEATURE_NAMES: Record<string, FeatureName> = {
  // Built in: switched here, as the features are.
  cards: { name: "Cards", aka: "List view", does: "Every topic as a card of its points, in a list you scroll and search.", lives: "A view" },
  pictures: { name: "Pictures", aka: "Gallery", does: "Every topic as its picture, side by side.", lives: "A view" },
  listening: { name: "Listening", aka: "Voice input", does: "The mic: tap it or press ⌘D, and your words land as you talk.", lives: "The input box" },
  recap: { name: "Recap", aka: "Summary", does: "A short summary of this session, on R or “recap”.", lives: "Top right" },
  import: { name: "Import chats", aka: "Import", does: "Brings an exported chat in as thoughts on your map.", lives: "Top right" },
  export: { name: "Export", aka: "Markdown export", does: "Saves the whole map as a Markdown file.", lives: "Top right" },
  // Features in their own folders.
  spine: { name: "Canvas", aka: "Infinite canvas", does: "Your talk as a canvas: each topic a column, tangents beside their words.", lives: "The map" },
  "bubble-flight": { name: "Bubble flight", aka: "Motion trail", does: "Carries your words from the input box to the topic where they land.", lives: "The Canvas" },
  "tiny-transcript": { name: "Tiny transcript", aka: "Live captions", does: "Your words as you say them, very small, at the bottom.", lives: "The status line" },
  "notice-timeline": { name: "Notice history", aka: "Activity log", does: "Every notice kept, each with what takes it back.", lives: "History" },
  "read-progress": { name: "Read progress", aka: "Read marker", does: "Keeps your place in other people's thoughts.", lives: "Talk" },
  bubbles: { name: "Bubbles", aka: "Bubble chart", does: "Each topic floats as a bubble, sized by its points.", lives: "A view" },
  keys: { name: "Keys", aka: "Keyboard navigation", does: "Arrows or h j k l move between topics and points.", lives: "Everywhere" },
  level: { name: "Level meter", aka: "VU meter", does: "Every loudness reading, to set a volume feature's level.", lives: "Bottom left" },
  "brick-chip": { name: "Feature chip", aka: "Provenance badge", does: "Marks each point a feature added, on hover or tap.", lives: "The Canvas" },
};

/** What a kind of feature is called, as the Catalog groups them. */
export const KIND_NAMES = {
  view: "Views",
  card: "Cards",
  panel: "Panels",
  input: "Inputs",
  app: "Your apps",
} as const;
