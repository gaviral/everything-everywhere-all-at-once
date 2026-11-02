import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { Room } from "./room";
import "./styles.css";
import "./legible.css";

// `?recording` in the address dresses the page for a screen recording: big live words, every placing time, a take clock.
if (new URLSearchParams(location.search).has("recording")) document.documentElement.classList.add("recording");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Room>
      <App />
    </Room>
  </StrictMode>,
);
