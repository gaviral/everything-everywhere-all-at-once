import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { PhoneRemoteHost, RememberedRemote } from "./remote/Host";
import { Crash } from "./Crash";
import { REMOTE } from "./remote/flag";
import { Room } from "./room";
import "./styles.css";
import "./legible.css";
import { FILM, startFilm } from "./film";
import "./film.css";

// `?recording` in the address dresses the page for a screen recording: big live words, every placing time, a take clock.
if (FILM || new URLSearchParams(location.search).has("recording")) document.documentElement.classList.add("recording");
if (FILM) startFilm();

// `?remote` opens a phone's page for the AI helpers' work (ui/src/remote/) instead of the map, in the shell's look and in the
// same room as any window: its code loads only then.
const Remote = lazy(() => import("./remote/Remote"));
const CodeCanvas = lazy(() => import("./code-canvas/CodeCanvas"));
const codeCanvas = new URLSearchParams(location.search).get("canvas") === "code";
if (REMOTE) document.documentElement.classList.add("shell2");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Crash>
      {!REMOTE && !codeCanvas && <RememberedRemote />}
      {codeCanvas ? <Suspense fallback={<p>Opening code canvas…</p>}><CodeCanvas /></Suspense> :
      <Room>
        {REMOTE ? <Suspense fallback={null}><Remote /></Suspense> : <PhoneRemoteHost><App /></PhoneRemoteHost>}
      </Room>}
    </Crash>
  </StrictMode>,
);
