import { connectionPath, messageText, nodes } from './topology';
import type { Flight } from './useMessages';
import { useEffect, useRef } from 'react';

const observed = ['speech', 'placer', 'refiner', 'flow', 'journal', 'helpers', 'browser', 'agents'] as const;
function Connections() {
  return <g className="sv-connections">{observed.map(id => <path key={id} d={connectionPath('core', id)} />)}
    <path className="sv-snapshot-link" d={connectionPath('git', 'core')} />
    <text className="sv-snapshot-label" x="300" y="455" textAnchor="middle">local git snapshot</text>
    <path className="sv-snapshot-link" d={connectionPath('helpers', 'agents')} />
  </g>;
}
function Components() {
  return <>{nodes.map(node => <g key={node.id} className={`sv-node sv-node-${node.id}`} transform={`translate(${node.x - 124},${node.y - 44})`}>
    <rect width="248" height="88" rx="14" />
    <text x="124" y="36" textAnchor="middle" className="sv-node-name">{node.name}</text>
    <text x="124" y="63" textAnchor="middle" className="sv-node-detail">{node.detail}</text>
  </g>)}</>;
}
function TravellingMessage({ flight }: { flight: Flight }) {
  const label = messageText(flight);
  return <g className="sv-flight" data-from={flight.from} data-to={flight.to} aria-hidden="true">
    <animateMotion dur="2.8s" repeatCount="1" fill="freeze" path={connectionPath(flight.from, flight.to)} />
    <circle r="6" /><rect x="12" y="-17" width={Math.max(88, label.length * 8.2 + 16)} height="32" rx="6" />
    <text x="20" y="5">{label}</text>
  </g>;
}
export function SystemDiagram({ flights }: { flights: Flight[] }) {
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = scroll.current;
    if (!node) return;
    const center = () => { node.scrollLeft = Math.max(0, (node.scrollWidth - node.clientWidth) / 2); };
    const observer = new ResizeObserver(center);
    observer.observe(node); center();
    return () => observer.disconnect();
  }, []);
  return <div ref={scroll} className="sv-diagram-scroll" tabIndex={0} aria-label="System connections. Scroll horizontally on smaller screens.">
    <svg className="sv-diagram" viewBox="0 0 1200 620" role="img" aria-labelledby="sv-diagram-title sv-diagram-desc">
      <title id="sv-diagram-title">Browser, Rust core and its connected parts</title>
      <desc id="sv-diagram-desc">Read from the browser upwards. The core routes thoughts to the placer, refiner, speech and Flow; saves transactions in the journal; coordinates helpers and agent jobs. Solid lines carry observed events. Dashed lines show structure only. Git lanes come from the existing local snapshot.</desc>
      <Connections /><Components />{flights.map(flight => <TravellingMessage key={flight.id} flight={flight} />)}
    </svg>
  </div>;
}
