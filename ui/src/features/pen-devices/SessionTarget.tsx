import type { SessionDestination } from "./contracts";

export function SessionTarget({ sessions, selected, onSelect }: {
  sessions: readonly SessionDestination[]; selected: string; onSelect: (id: string) => void;
}) {
  return <label>Destination session<select value={selected} onChange={event => onSelect(event.target.value)}>
    <option value="">Choose a session</option>
    {sessions.map(session => <option key={session.id} value={session.id}>
      {session.name}{session.connected ? "" : " — disconnected"}
    </option>)}
  </select></label>;
}
