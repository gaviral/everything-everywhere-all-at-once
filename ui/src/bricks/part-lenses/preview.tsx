import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PluginStateContext, type PluginState } from '../contract';
import { PartLenses, styles } from './index';
import { exampleTree } from './example';
import type { Contribution } from '../../features/part-dimensions';
import type { PartTree } from './tree';

const memory = new Map<string, unknown>();
const state: PluginState = { scope: 'part-lenses-example', get: <T,>(key: string) => memory.get(key) as T | undefined,
  set: (key, value) => { memory.set(key, value); } };

function fixture(condition: string): PartTree {
  if (condition === 'empty') return { ...exampleTree, tree: [] };
  if (condition === 'unwritten') return { ...exampleTree, explanations: undefined };
  if (condition === 'cycle') {
    const branch: { part: Contribution['part']; children: Contribution[] } = { part: { id: 'example:map', version: 1 }, children: [] };
    branch.children.push(branch);
    return { ...exampleTree, tree: [branch] };
  }
  const parts = exampleTree.graph.parts ?? [];
  if (condition === 'missing') return { ...exampleTree, graph: { parts: parts.filter(part => part.id !== 'example:card') } };
  if (condition === 'duplicate') return { ...exampleTree, graph: { parts: [...parts, parts.find(part => part.id === 'example:card')!] } };
  if (condition === 'revision') return { ...exampleTree, graph: { parts: parts.map(part => part.id === 'example:card' ? { ...part, version: 2 } : part) } };
  return exampleTree;
}

function Preview() {
  const [condition, setCondition] = useState('example');
  const [mounted, setMounted] = useState(true);
  return <PluginStateContext value={state}>
    <style>{styles}</style>
    {mounted && <PartLenses data={fixture(condition)} />}
    <fieldset style={{ margin: 24, font: '16px system-ui', padding: 16 }}><legend>Isolated preview conditions</legend>
      <label>Tree condition <select value={condition} onChange={event => setCondition(event.target.value)} id="fixture">
        {['example', 'empty', 'missing', 'duplicate', 'revision', 'unwritten', 'cycle'].map(name => <option key={name}>{name}</option>)}
      </select></label>{' '}
      <button type="button" id="mount" onClick={() => setMounted(value => !value)}>{mounted ? 'Hide' : 'Show'} part lenses</button>
    </fieldset>
  </PluginStateContext>;
}

createRoot(document.getElementById('root')!).render(<Preview />);
