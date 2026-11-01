import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { Room } from "./room";
import "./styles.css";

// `?recording` in the address dresses the page for a screen recording: big live words, every placing time, a take clock.
if (new URLSearchParams(location.search).has("recording")) document.documentElement.classList.add("recording");
// stand-in: `?look=ink` shows option 2 of the visual pick (pictures in black ink, no room colors); one look ships.
if (new URLSearchParams(location.search).get("look") === "ink") document.documentElement.classList.add("look-ink");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Room>
      <App />
    </Room>
  </StrictMode>,
);
