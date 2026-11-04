// Reading: turns the sheet into a picture Spark can see, and asks. Spark reads; Muse Image draws back.
import { boundsOf, paintStroke, type Stroke } from "./ink";
import type { Label } from "./labels";

export type Reading = {
  said: string;
  parts: { name: string; box: [number, number, number, number] }[];
  links: { from: string; to: string; label: string }[];
  unsure: { at: [number, number]; question: string }[];
  flow: { name: string; steps: { name: string; prompt: string }[] };
  draw_back: string;
};

const WIDTH = 1280;

function endpoint(path: string) {
  const url = new URL(path, location.origin);
  const room = new URLSearchParams(location.search).get("room");
  if (room) url.searchParams.set("room", room);
  return url;
}
async function ask<T>(path: string, body: unknown): Promise<T & { ms: number }> {
  const response = await fetch(endpoint(path), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`Core returned ${response.status}`);
  const value = await response.json();
  if (value.error) throw new Error(value.error);
  return value;
}

/** The sheet at reading size: ink on dark paper, each person's label written where they put it. */
export function pictureOf(strokes: readonly Stroke[], labels: readonly Label[], aspect: number) {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = Math.round(WIDTH / aspect);
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#16120e";
  context.fillRect(0, 0, canvas.width, canvas.height);
  for (const stroke of strokes) paintStroke(context, stroke, canvas.width, canvas.height);
  context.fillStyle = "#ffd84d";
  context.font = "32px 'Bradley Hand', 'Noteworthy', cursive";
  for (const label of labels) {
    const box = boundsOf(strokes.filter(stroke => label.strokes.includes(stroke.id)));
    if (box) context.fillText(label.text, box.left * canvas.width, Math.max(0.04, box.top - 0.02) * canvas.height);
  }
  return canvas.toDataURL("image/png");
}

const PAD = 22;
/** Spark's places are close, the ink is exact: each part it names takes the bounds of the ink it means. */
export function onTheInk(reading: Reading, strokes: readonly Stroke[], labels: readonly Label[]): Reading {
  const place = (part: Reading["parts"][number]) => {
    const said = labels.find(label => plainName(label.text) === plainName(part.name));
    const [left, top, right, bottom] = part.box;
    const near = strokes.filter(stroke => stroke.points.filter(point => {
      const x = point.x * 1000, y = point.y * 1000;
      return x >= left - PAD * 2 && x <= right + PAD * 2 && y >= top - PAD * 2 && y <= bottom + PAD * 2;
    }).length > stroke.points.length * 0.7);
    const box = boundsOf(said ? strokes.filter(stroke => said.strokes.includes(stroke.id)) : near);
    return box ? [box.left * 1000 - PAD, box.top * 1000 - PAD, box.right * 1000 + PAD, box.bottom * 1000 + PAD] as Reading["parts"][number]["box"] : part.box;
  };
  return { ...reading, parts: reading.parts.map(part => ({ ...part, box: place(part) })) };
}
const plainName = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export const readSketch = (sketch: string, labels: readonly Label[], said: string) =>
  ask<{ reading: Reading }>("/draw/read", { sketch, labels: labels.map(label => label.text), said });

export const drawBack = (asks: string) => ask<{ image: string }>("/draw/back", { asks });
