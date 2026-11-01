import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { Room } from "./room";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Room>
      <App />
    </Room>
  </StrictMode>,
);
