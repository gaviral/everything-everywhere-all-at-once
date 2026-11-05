import { useState } from "react";
import type { BrickProps } from "../contract";
import { roomPeople, roomTurns, sharedTopics } from "./context";
import { EXAMPLE_PEOPLE } from "./example";
import { DeveloperLane, SharedColumn } from "./parts";
import { usePlayback } from "./use-playback";
import pairRoomStyles from "./pair-room.css?inline";

export default function PairRoom({ map }: BrickProps) {
  const [example, setExample] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const playback = usePlayback(example);
  const available = roomPeople(map);
  const ids = selected.filter(id => available.some(person => person.id === id));
  const chosen = [...ids, ...available.map(person => person.id).filter(id => !ids.includes(id))].slice(0, 2);
  const people = example ? EXAMPLE_PEOPLE : chosen.map(id => available.find(person => person.id === id)!);
  const turns = example ? playback.turns : roomTurns(map);
  const shared = sharedTopics(turns, people);
  const indicatorClass = playback.playing ? "pair-room-dot pair-room-pulse" : "pair-room-dot";
  const changeMode = (value: boolean) => { playback.pause(); setExample(value); };

  return <div className="pair-room" data-guide="pair-room">
    <div className="pair-room-top"><span className="pair-room-wordmark">◌ &nbsp; pair session</span>
      <div className="pair-room-modes" aria-label="Conversation source">
        <button type="button" aria-pressed={example} onClick={() => changeMode(true)}>Example shared map</button>
        <button type="button" aria-pressed={!example} onClick={() => changeMode(false)}>Connected shared map</button>
      </div><span className="pair-room-model">Muse Voice → Muse Spark</span>
    </div>
    <div className="pair-room-intro"><div><span className="pair-room-eyebrow">Two developers. One shared map.</span><h1>Think together.<br /><em>Keep your own topic.</em></h1></div>
      <p>One mic, two voices.<br />Your words find your lane.<br />Your common ground travels with you.</p>
    </div>
    <div className="pair-room-session"><div><span className={indicatorClass} />
      <strong>{example ? "Shipping a payments API" : "Your connected conversation"}</strong><span>{example ? "Labelled example · mic-free playback" : "Completed speaker-labelled turns · no capture started"}</span></div>
      {example && <div className="pair-room-playback">
        {!playback.done && <button type="button" className="pair-room-play" onClick={playback.play}>{playback.playing ? "Ⅱ Pause" : "▶ Play conversation"}</button>}
        <button type="button" onClick={playback.replay}>{playback.done ? "↺ Play again" : "↺ Replay from start"}</button>
      </div>}
    </div>
    {example && <div className="pair-room-progress" role="progressbar" aria-label="Example conversation" aria-valuenow={Math.round(playback.progress * 100)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${playback.progress * 100}%` }} /></div>}
    {!example && <div className="pair-room-source-note"><p>{map.connected ? "Reading this map's completed turns. Shared context matches topic IDs, not similar words." : "Disconnected · showing the last available turns."} Spark handoffs are previews; this view makes no model requests.</p>
      {available.length > 2 && <div className="pair-room-people">{chosen.map((id, i) => <label key={i}>Developer {i + 1}<select value={id} onChange={event => setSelected(chosen.map((current, index) => index === i ? event.target.value : current))}>
        {available.filter(person => person.id === id || !chosen.includes(person.id)).map(person => <option key={person.id} value={person.id}>{person.name}</option>)}
      </select></label>)}</div>}
    </div>}
    <div className="pair-room-grid">
      {people.map((person, i) => <DeveloperLane key={`${example ? "example" : map.visitKey ?? map.mapIdentity ?? "room"}:${person.id}`} person={person} tone={i === 0 ? "peach" : "mint"} turns={turns} shared={shared} partial={example ? playback.partial : null} example={example} />)}
      {!example && people.length < 2 && <section className="pair-room-waiting"><h2>{people.length ? "Room for a second voice" : "Bring two voices together"}</h2><p>Completed turns from two named speakers will fill their lanes here. You can play the example without a microphone.</p><button type="button" onClick={() => changeMode(true)}>Open example shared map ↗</button></section>}
      <SharedColumn topics={shared} people={people} />
    </div>
    <div className="pair-room-footer"><span>◌ Separate topics. Shared momentum.</span><span>{example ? "Illustrative transcript and Spark outputs · nothing sent or executed" : "This view reads context only · start capture using the app's own controls"}</span></div>
  </div>;
}

export const styles = pairRoomStyles;
