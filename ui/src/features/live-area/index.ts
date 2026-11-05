export { LiveArea } from "./LiveArea";
export type { LiveAreaProps } from "./LiveArea";
export type { ActivityEvent, BuildEvent, VersionEvent, EventStamp, RunIdentity, Connection, StatusSource, SourceObserver, LiveAreaAdapters } from "./contracts";
export const liveAreaFeature = Object.freeze({
  id: "intake1411-live-area", label: "Live development area", defaultEnabled: false,
  description: "Read-only activity with matching build and version references.",
});
