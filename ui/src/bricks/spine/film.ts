// The filming bridge belongs to the spine; the app supplies its overlay independently.
import type { Viewport } from "./camera";

export const FILM = import.meta.env.VITE_E2A2O_FILM === "1"
  && typeof location !== "undefined" && new URLSearchParams(location.search).has("film");
export type FilmTarget = Viewport | { node: string; zoom?: number };
export type FilmOptions = { duration?: number; ease?: "linear" | "ease-in" | "ease-out" | "ease-in-out" | ((t: number) => number) };
export type Camera = (target: FilmTarget | null, options?: FilmOptions) => Promise<boolean>;
let camera: Camera | null = null;
let held = false;
export const filmHeld = () => FILM && held;
export function connectFilmCamera(next: Camera) {
  camera = next;
  return () => { if (camera === next) camera = null; };
}

export const driveFilmCamera: Camera = (target, options) => {
  held = target !== null;
  return camera?.(target, options) ?? Promise.resolve(false);
};
