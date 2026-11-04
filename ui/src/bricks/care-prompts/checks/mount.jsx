import React from "react";
import { createRoot } from "react-dom/client";
import CarePrompts, { styles } from "../index";
import { attachWaterProvider } from "../water";
import { defaults, isQuiet, storageKey } from "../state";

const NativeDate = Date;
let clock = new NativeDate(2026, 10, 4, 12).getTime();
window.Date = class extends NativeDate {
  constructor(...args) { super(...(args.length ? args : [clock])); }
  static now() { return clock; }
};
const style = document.createElement("style");
style.textContent = styles;
document.head.append(style);
const root = createRoot(document.getElementById("root"));
window.careCheck = {
  advance(minutes) { clock += minutes * 60_000; window.dispatchEvent(new Event("focus")); },
  hour(hour, minute = 0) { const next = new NativeDate(clock); next.setHours(hour, minute, 0, 0); if (next.getTime() < clock) next.setDate(next.getDate() + 1); clock = next.getTime(); window.dispatchEvent(new Event("focus")); },
  source: attachWaterProvider,
  storageKey,
  quiet: (start, end, hour) => isQuiet({ ...defaults(), start, end }, new NativeDate(2026, 10, 4, hour).getTime()),
  mount(person = "example-person") { root.render(<CarePrompts map={{ me: person }} />); },
};
window.careCheck.mount();
