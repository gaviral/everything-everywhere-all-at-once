// This demo, as parts: the film's steps left to right, and under each the real files and functions it stands on.
// Which file serves which step is a person's reading of the code; every name, version and place comes from the source map.
import type { Contribution, Dimension, Presentation } from "../../features/part-dimensions";
import type { CodePart } from "../../code-canvas/types";

type Step = { id: string; title: string; description: string } & Record<Dimension, readonly string[]>;

const STEPS: readonly Step[] = [
  { id: "say", title: "Say it", description: "Your words land in place while you talk.",
    ui: ["ui/src/MicButton.tsx", "ui/src/bricks/spine/index.tsx"], functionality: ["core/src/asr.rs", "core/src/placer.rs"], data: ["core/src/world.rs", "core/src/storage.rs"] },
  { id: "keep", title: "Keep the unfinished", description: "A stopped thought stays saved, exactly, in its place.",
    ui: ["ui/src/StayHere.tsx"], functionality: ["core/src/stay.rs"], data: ["core/src/world.rs"] },
  { id: "draw", title: "Draw it", description: "Pen on the screen, names by voice, Spark reading along.",
    ui: ["ui/src/bricks/draw/index.tsx", "ui/src/bricks/draw/InkSheet.tsx", "ui/src/bricks/draw/Notes.tsx"], functionality: ["core/src/draw.rs", "ui/src/bricks/draw/labels.ts", "ui/src/bricks/draw/spoken.ts"], data: ["ui/src/bricks/draw/ink.ts", "ui/src/bricks/draw/kept.ts"] },
  { id: "build", title: "Run the boxes", description: "A sentence or a sketch becomes boxes that run on Muse Spark.",
    ui: ["ui/src/bricks/flow-canvas/index.tsx"], functionality: ["core/src/flow.rs"], data: ["core/src/protocol.rs"] },
  { id: "wait", title: "Wait for you", description: "A real question holds until you stop talking.",
    ui: ["ui/src/bricks/flow-canvas/index.tsx"], functionality: ["core/src/flow.rs", "core/src/conversation.rs"], data: ["core/src/protocol.rs"] },
  { id: "back", title: "Bring you back", description: "Where was I: the exact unfinished words return.",
    ui: ["ui/src/RecoveryPanel.tsx", "ui/src/StayHere.tsx"], functionality: ["core/src/stay.rs", "core/src/spoken.rs"], data: ["core/src/world.rs"] },
  { id: "send", title: "Send, with a stop", description: "The result goes out only past a visible Stop.",
    ui: ["ui/src/SendCard.tsx"], functionality: ["core/src/flow.rs", "ui/src/send-card.ts"], data: ["core/src/world.rs"] },
];

const FUNCTIONS_SHOWN = 5;
const isTest = (part: CodePart) => /tests?\b|_tests|\.test\./.test(part.file) || /^test|_test$/.test(part.name);

/** Files with no source map to read: just their names, so a clone without it still shows the shape. */
export function knownParts(snapshot: readonly CodePart[] | null): CodePart[] {
  if (snapshot?.length) return [...snapshot];
  const files = [...new Set(STEPS.flatMap(step => [...step.ui, ...step.functionality, ...step.data]))];
  return files.map(file => ({ id: file, name: file.split("/").pop() ?? file, file, line: 1, tags: [], version: 0, version_scope: "" }));
}

function presented(parts: readonly CodePart[], file: string): Contribution | null {
  const whole = parts.find(part => part.id === file);
  if (!whole) return null;
  const inside = parts.filter(part => part.file === file && part.id !== file && part.tags.includes("function") && !isTest(part)).slice(0, FUNCTIONS_SHOWN);
  return { part: { id: whole.id, version: whole.version }, children: inside.map(part => ({ part: { id: part.id, version: part.version } })) };
}

export function thisDemo(parts: readonly CodePart[]): Presentation {
  const under = (files: readonly string[]) => files.flatMap(file => presented(parts, file) ?? []);
  return {
    version: "this demo",
    steps: STEPS.map(({ id, title, description, ui, functionality, data }) => ({
      id, title, description, contributors: { ui: under(ui), functionality: under(functionality), data: under(data) },
    })),
  };
}
