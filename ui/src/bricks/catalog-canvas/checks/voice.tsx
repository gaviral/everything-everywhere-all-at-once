import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { BrickOn } from '../../contract';
import { useCommands } from '../useCommands';
import { GROUPS } from '../groups';
import { BRICKS } from '../../../bricks-core';
import { BUILT_INS } from '../../../shell/features';

const listeners = new Set<(words: string) => void>();
const on: BrickOn = (name, callback) => {
  if (name !== 'words') return () => {};
  const hear = callback as (words: string) => void;
  listeners.add(hear); return () => { listeners.delete(hear); };
};
Object.assign(window, {
  catalogWords: (words: string) => listeners.forEach(hear => hear(words)),
  catalogRegistry: [...BRICKS.map(brick => brick.info.id), ...BUILT_INS.map(feature => feature.id)],
  catalogGroups: GROUPS,
});
function VoiceCheck() {
  const [group, setGroup] = useState('all');
  const [visits, setVisits] = useState(0);
  const [active, setActive] = useState(true);
  useCommands(on, id => { setGroup(id); setVisits(count => count + 1); }, () => setGroup('all'), active);
  return <><output data-group={group} data-visits={visits}>{group}</output><button onClick={() => setActive(value => !value)}>Toggle navigation</button></>;
}
createRoot(document.getElementById('root')!).render(<VoiceCheck />);
