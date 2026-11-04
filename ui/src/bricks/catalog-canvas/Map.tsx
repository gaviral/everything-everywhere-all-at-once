import type { CSSProperties } from 'react';
import { GROUPS, type GroupId } from './groups';
import { featuresIn, type Feature } from './catalog';

const ink = (color: string) => ({ '--catalog-ink': color }) as CSSProperties;

function OverviewTree({ features, choose }: { features: Feature[]; choose: () => void }) {
  const rows = Math.ceil(features.length / 2);
  return <svg className="catalog-canvas-tree" viewBox="0 0 600 320" aria-hidden="true">
    {features.map((feature, index) => {
      const left = index % 2 === 0;
      const row = Math.floor(index / 2);
      const y = 28 + row * (265 / Math.max(rows - 1, 1)) + (left ? 0 : 9);
      const x = left ? 246 : 354;
      return <g key={feature.id}>
        <path d={`M300 0 C${left ? 280 : 325} ${y * .45}, ${left ? 285 : 310} ${y - 9}, ${x} ${y}`} />
        <text x={left ? 235 : 365} y={y + 5} textAnchor={left ? 'end' : 'start'}>{feature.name}</text>
      </g>;
    })}
    <rect width="600" height="320" fill="transparent" onClick={choose} />
  </svg>;
}

export function Overview({ features, choose }: { features: Feature[]; choose: (id: GroupId) => void }) {
  return <div className="catalog-canvas-overview" aria-label="Six ways to explore every feature">
    {GROUPS.map((group, index) => {
      const items = featuresIn(features, group.id);
      return <section className="catalog-canvas-cluster" key={group.id} style={ink(group.color)}>
        <button className="catalog-canvas-word" data-group={group.id} onClick={() => choose(group.id)} aria-label={`Explore ${group.name}, ${items.length} features`}>
          <span className="catalog-canvas-number">0{index + 1}</span><span>{group.name}</span>
          <svg viewBox="0 0 400 24" aria-hidden="true"><path d="M8 17 Q140 3 278 13 T393 9 M21 20 Q204 9 365 15" /></svg>
        </button>
        <p className="catalog-canvas-why">{group.why} <span>{items.length} ways ↗</span></p>
        <OverviewTree features={items} choose={() => choose(group.id)} />
      </section>;
    })}
  </div>;
}

function FeatureBranch({ feature, index, tryFeature }: { feature: Feature; index: number; tryFeature: (feature: Feature) => void }) {
  const self = feature.id === 'catalog-canvas';
  return <button className="catalog-canvas-leaf" data-feature={feature.id} style={{ '--catalog-offset': `${(index % 3) * 14}px` } as CSSProperties}
    onClick={() => tryFeature(feature)} disabled={!feature.available || self}>
    <span className="catalog-canvas-feature-name">{feature.name} <span aria-hidden="true">{self ? '●' : '↗'}</span></span>
    <span className="catalog-canvas-description">{feature.does}</span>
    <span className="catalog-canvas-feature-state">{self ? 'You are here' : !feature.available ? 'Unavailable in this session' : feature.on ? 'Already on · explore' : 'Try it on your map'}</span>
  </button>;
}

export function Cluster({ groupId, features, tryFeature }: { groupId: GroupId; features: Feature[]; tryFeature: (feature: Feature) => void }) {
  const group = GROUPS.find(item => item.id === groupId)!;
  const items = featuresIn(features, groupId);
  return <section className="catalog-canvas-detail" style={ink(group.color)} aria-label={`${group.name} features`}>
    <div className="catalog-canvas-root"><p>{group.why}</p><h2>{group.name}<span className="catalog-canvas-root-dot">.</span></h2><p>{items.length} ways to start. Choose a feature.</p></div>
    <div className="catalog-canvas-branches">
      {items.map((feature, index) => <div className="catalog-canvas-branch" key={feature.id}>
        <svg viewBox="0 0 140 160" preserveAspectRatio="none" aria-hidden="true"><path d={index % 2 === 0 ? 'M140 0 C139 110 105 80 0 109' : 'M0 0 C2 98 32 100 140 84'} /></svg>
        <FeatureBranch feature={feature} index={index} tryFeature={tryFeature} />
      </div>)}
    </div>
  </section>;
}
