import { useEffect } from "react";
import { attachQuietScreen } from "./idle";
import "./quiet-screen.css";

/** The shell owns the default; discovery also makes this usable in the playground. */
export default function QuietScreen() {
  useEffect(attachQuietScreen, []);
  return null;
}
