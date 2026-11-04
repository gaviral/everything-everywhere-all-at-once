import { useEffect, useRef } from 'react';
import { useBrickEvent, type BrickOn } from '../contract';
import { GROUPS, type GroupId } from './groups';

export function useCommands(on: BrickOn, choose: (id: GroupId) => void, back: () => void, browsing: boolean) {
  const previous = useRef('');
  useBrickEvent(on, 'words', words => {
    const command = words.trim().toLowerCase().replace(/[.!?]+$/, '');
    if (!command) { previous.current = ''; return; }
    if (previous.current === command) return;
    previous.current = command;
    if (!browsing) return;
    const group = GROUPS.find(item => item.name.toLowerCase() === command);
    if (group) choose(group.id);
    else if (command === 'back') back();
  });
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault(); event.stopImmediatePropagation(); back();
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [back]);
}
