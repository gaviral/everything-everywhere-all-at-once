import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { BrickActions, BrickProps, MapSnapshot } from '../contract';
import TopicReshape from './index';

const map: MapSnapshot = { threads: [], thoughts: [], active: null, suggestions: [], reminders: [], apps: [], notes: {},
  points: new Map(), rooms: new Map(), speakers: new Map(), topics: [], positions: {}, me: 'Example participant',
  partial: '', connected: false, usage: null, jobs: [], questions: [], visitKey: 'isolated-example' };
const actions = new Proxy({ closeView: () => {} }, { get: (object, key) => {
  if (key === 'closeView') return object.closeView;
  return () => { throw new Error('Rehearsal must not invoke host actions'); };
} }) as BrickActions;
const props: BrickProps = { map, actions, on: () => () => {}, brick: { id: 'topic-reshape', name: 'Reshape topics', does: 'Local rehearsal', kind: 'view', defaultOn: false, demoSafe: true } };
function Fixture() {
  const [visit, setVisit] = useState('isolated-example');
  return <><button id="change-visit" onClick={() => setVisit(value => `${value}-next`)}>Change visit</button>
    <TopicReshape {...props} map={{ ...map, visitKey: visit }} /></>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
