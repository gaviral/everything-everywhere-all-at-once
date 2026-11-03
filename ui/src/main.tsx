import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { Crash } from "./Crash";
import { REMOTE } from "./remote/flag";
import { Room } from "./room";
import "./styles.css";
import "./legible.css";

// `?recording` in the address dresses the page for a screen recording: big live words, every placing time, a take clock.
if (new URLSearchParams(location.search).has("recording")) document.documentElement.classList.add("recording");

// `?remote` opens a phone's page for the AI helpers' work (ui/src/remote/) instead of the map, in the shell's look and in the
// same room as any window: its code loads only then.
const Remote = lazy(() => import("./remote/Remote"));
if (REMOTE) document.documentElement.classList.add("shell2");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Crash>
      <Room>
        {REMOTE ? <Suspense fallback={null}><Remote /></Suspense> : <App />}
      </Room>
    </Crash>
  </StrictMode>,
);
