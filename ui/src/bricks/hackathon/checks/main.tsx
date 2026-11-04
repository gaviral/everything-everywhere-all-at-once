import { createRoot } from "react-dom/client";
import Hackathon, { styles } from "../index";
import { PluginStateContext, type BrickProps, type PluginState } from "../../contract";
import { content, itemState, draftValue, timeRemaining } from "../model";

const style = document.createElement("style");
style.textContent = `${styles}
  :root { color-scheme: light dark; --bg: #f1eee8; --card: #fffdf9; --ink: #292820; --muted: #626054; }
  body { margin: 0; background: var(--bg); font-family: system-ui, sans-serif; }
  #root { max-width: 1180px; margin: auto; padding: 28px 32px; }
  @media (prefers-color-scheme: dark) { :root { --bg: #161a1c; --card: #232a2c; --ink: #f1ede5; --muted: #bab9af; } }
  @media (max-width: 560px) { #root { padding: 16px; } }
`;
document.head.append(style);
const store: PluginState = {
  scope: "hackathon-focused-check",
  get<T>(key: string) { return JSON.parse(localStorage.getItem(key) ?? "null") as T | undefined; },
  set<T>(key: string, value: T) { localStorage.setItem(key, JSON.stringify(value)); },
};
const props = { map: { connected: false }, actions: new Proxy({}, { get() { throw Error("The area must not use host actions"); } }) } as BrickProps;
const root = createRoot(document.getElementById("root")!);
function mount() { root.render(<PluginStateContext.Provider value={store}><Hackathon {...props} /></PluginStateContext.Provider>); }
Object.assign(window, { hackathonCheck: { content, itemState, draftValue, timeRemaining, mount, unmount: () => root.render(null) } });
mount();
