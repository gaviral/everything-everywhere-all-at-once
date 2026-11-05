import { AppMark } from "../../AppMark";
import { useCallback, useEffect, useRef, useState } from 'react';
import type { BrickProps } from '../contract';
import { useCatalog, enableFeature, enabledNow, type Feature } from './catalog';
import { Overview, Cluster } from './Map';
import { Surface } from './Surface';
import { openFeature } from './navigation';
import { useCommands } from './useCommands';
import { useReturnPlace, useVisit } from './useVisit';
import type { GroupId } from './groups';
import './catalog-canvas.css';

type Trial = { feature: Feature; wasOn: boolean; keep: boolean };

export default function CatalogCanvas({ map, actions, on }: BrickProps) {
  const features = useCatalog();
  const [visit, setVisit] = useVisit(map.visitKey ?? map.mapIdentity ?? 'local');
  const [mode, setMode] = useState<'browse' | 'try' | 'closed'>('browse');
  const [notice, setNotice] = useState('');
  const trial = useRef<Trial | null>(null);
  const stop = useRef<() => void>(() => {});
  const surface = useReturnPlace(`${mode}:${visit.group}`, visit.feature, visit.scroll);
  const group = visit.group;
  useEffect(() => () => { stop.current(); }, []);

  const choose = useCallback((group: GroupId) => {
    if (mode !== 'browse') return;
    setVisit({ group, feature: null, scroll: 0 }); setNotice('');
  }, [mode, setVisit]);
  const back = useCallback(() => {
    if (mode === 'try') {
      stop.current();
      const attempted = trial.current;
      if (attempted && !attempted.wasOn && !attempted.keep) enableFeature(attempted.feature, false);
      setNotice(attempted ? `${attempted.feature.name}${attempted.keep || attempted.wasOn ? ' stays on.' : ' tried. Back where you left off.'}` : '');
      trial.current = null; setMode('browse');
    } else if (group) setVisit({ group: null, feature: null, scroll: 0 });
    else setMode('closed');
  }, [mode, group, setVisit]);
  useCommands(on, choose, back, mode === 'browse');

  const tryFeature = (feature: Feature) => {
    if (!feature.available || feature.id === 'catalog-canvas') return;
    const wasOn = feature.on;
    enableFeature(feature, true);
    if (!enabledNow(feature)) { setNotice(`${feature.name} is unavailable in this session.`); return; }
    setVisit({ ...visit, feature: feature.id, scroll: surface.current?.scrollTop ?? 0 });
    trial.current = { feature, wasOn, keep: false };
    setMode('try'); setNotice('');
    stop.current = openFeature(feature, actions, () => {
      setNotice(`${feature.name} is on. Open its Show control in Features to continue.`);
    });
  };

  if (mode === 'closed') return <button className="catalog-canvas-reopen" onClick={() => setMode('browse')}>Explore everything ↗</button>;
  if (mode === 'try' && trial.current) return <aside className="catalog-canvas-return" aria-label="Return to feature map">
    <button onClick={back}>← Back to feature map <kbd>Esc</kbd></button>
    <span>Trying {trial.current.feature.name}</span>
    {!trial.current.wasOn && <button disabled={trial.current.keep} onClick={() => { if (trial.current) trial.current.keep = true; setNotice('Kept on'); }}> {trial.current.keep ? 'Kept on ✓' : 'Keep on'}</button>}
    <span className="catalog-canvas-trial-notice" role="status">{notice}</span>
  </aside>;
  return <Surface back={back} label="Every feature, one map">
    <div className="catalog-canvas-top"><button onClick={back} aria-label={group ? 'Back to all six groups' : 'Close feature map'}>{group ? '← Everything' : '← Your map'}</button><span><AppMark size="1.7em" /> / {features.length} possibilities</span><span className="catalog-canvas-instruction">Click a word. Follow a thought.</span></div>
    <div className="catalog-canvas-scroll" ref={surface}>
      {group ? <Cluster groupId={group} features={features} tryFeature={tryFeature} /> : <>
        <div className="catalog-canvas-heading"><h1>What do you want to <mark>do?</mark></h1><span className="catalog-canvas-hand">where to next?<svg viewBox="0 0 160 65" aria-hidden="true"><path d="M145 3 Q58 -4 21 51 M19 34 L19 54 L40 49" /></svg></span></div>
        <Overview features={features} choose={choose} />
      </>}
    </div>
    <div className="catalog-canvas-footer"><span role="status">{notice || (group ? 'Click a feature to try it. Esc brings you back here.' : 'One thought. A hundred ways forward.')}</span><span>Already listening? Say a big word. <kbd>Esc</kbd> back</span></div>
  </Surface>;
}
