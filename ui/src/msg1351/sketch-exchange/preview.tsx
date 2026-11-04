import { createRoot } from 'react-dom/client';
import { SketchExchange } from './index';
import type { HostAdapter, Session } from './contract';
// A real browser channel for synthetic preview only. It never claims LAN reachability.
const sessions: Session[] = [{ id:'tablet', label:'Sketch tablet' }, { id:'tv', label:'Main display' }, { id:'other', label:'Second display' }];
const adapters = sessions.map(self => {
  const channel = new BroadcastChannel('msg1351-sketch-exchange-preview');
  const adapter: HostAdapter = { self, targets: sessions.filter(s => s.id !== self.id),
    send: m => channel.postMessage(m),
    subscribe: hear => { const listener = (e: MessageEvent) => hear(e.data); channel.addEventListener('message', listener); return () => channel.removeEventListener('message', listener); },
  };
  return adapter;
});
createRoot(document.getElementById('root')!).render(<main style={{maxWidth:1500,margin:'auto',padding:16,fontFamily:'system-ui'}}>
  <h1>Sketch exchange</h1><p>Same-browser preview · synthetic content · enable each intended session. No LAN connection or model service.</p>
  <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,340px),1fr))',gap:16,alignItems:'start'}}>
    {adapters.map((adapter,i) => <SketchExchange key={adapter.self.id} adapter={adapter} role={i === 0 ? 'capture' : 'display'} />)}
  </div></main>);
