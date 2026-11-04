type Note = { text: string; priority: number };

export const sampleNotes: readonly Note[] = [
  { text: "Open with the live Canvas demo.", priority: 1 },
  { text: "Keep one minute for questions.", priority: 3 },
  { text: "Show the pause and resume controls.", priority: 2 },
];

function collectNotes(): string[] {
  return sampleNotes.map(note => note.text);
}

function pickPriorities(notes: readonly string[]): string[] {
  return [...notes].sort((a, b) => priorityOf(a) - priorityOf(b)).slice(0, 2);
}

function priorityOf(text: string): number {
  return sampleNotes.find(note => note.text === text)?.priority ?? Infinity;
}

function buildBrief(priorities: readonly string[]): string[] {
  return priorities.map((text, index) => `${index + 1}. ${text}`)
    .concat("Finish with one minute of questions.");
}

export const steps = [
  { title: "Collect notes", detail: "Read the three example notes.", handoff: "3 notes collected", run: collectNotes },
  { title: "Pick priorities", detail: "Bring the two demo moments forward.", handoff: "2 priorities chosen", run: pickPriorities },
  { title: "Build brief", detail: "Turn the priorities into a run of show.", handoff: "Brief ready for review", run: buildBrief },
] as const;

/** Deliberate pacing for the example, not a claim about model execution time. */
export const stepDuration = 6_000;
