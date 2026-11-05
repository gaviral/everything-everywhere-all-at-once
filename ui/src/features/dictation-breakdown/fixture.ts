import type { QueueHome } from "./contract";
// Invented demonstration text, unrelated to any captured conversation.
export const syntheticDictation = 'Build a reminder because the plants need water. On another topic, paint the planter blue. The label says "Next, stop. Back to work" and should stay together. Back to reminders, add a quiet alarm. The tiny leaf is lovely. Keep keyboard focus visible.';
export const syntheticHomes: readonly QueueHome[] = Object.freeze([
  { id: "demo-reminders", name: "Reminders", concepts: ["reminders"] },
  { id: "demo-appearance", name: "Appearance", concepts: ["appearance"] },
  { id: "demo-palette", name: "Palette ideas", concepts: ["appearance"] },
  { id: "demo-access", name: "Accessibility", concepts: ["access"] },
]);
