import { useState } from "react";
import { createRoot } from "react-dom/client";
import PlaceholderMode, { styles } from "../index";

const example = Object.freeze({ name: "Alex Morgan", email: "alex.morgan@example.com", phone: "+44 20 7946 0958", recipient: "Unlisted Recipient" });
declare global { interface Window { fixture: { source: typeof example; sent: unknown[]; errors: string[] } } }
window.fixture = { source: example, sent: [], errors: [] };
window.addEventListener("error", event => window.fixture.errors.push(event.message));

function Fixture() {
  const [on, setOn] = useState(true);
  const [edited, setEdited] = useState<string>(example.email);
  const [revision, setRevision] = useState(0);
  return <main>
    <h1>Filming fixture · example content</h1>
    <button id="toggle" onClick={() => setOn(value => !value)}>{on ? "Disable" : "Enable"} placeholders</button>
    <button id="update" onClick={() => setRevision(value => value + 1)}>Update example</button>
    <article key={revision}>
      <h2 id="person">{example.name}</h2>
      <p id="contact">Write to <a href={`mailto:${example.email}`} title={example.email}>{revision ? "updated@example.com" : example.email}</a> or call {example.phone}.</p>
      <p id="date">Meeting: 2026-11-04 · 42 items</p>
      <div className="send-card">
        <div className="send-card-head">Message to {revision ? "Different Recipient" : example.recipient} · dry run</div>
        <button id="send" onClick={() => window.fixture.sent.push({ to: example.recipient, email: example.email, edited, selected: window.getSelection()?.toString() })}>Simulate send</button>
      </div>
      <label>Email draft<input id="email" value={edited} onChange={event => setEdited(event.target.value)} /></label>
      <label>Message draft<textarea id="draft" defaultValue={`Call ${example.phone}`} /></label>
      <p id="editable" contentEditable suppressContentEditableWarning>{example.email}</p>
    </article>
    {on && <PlaceholderMode />}
  </main>;
}

document.head.insertAdjacentHTML("beforeend", `<style>${styles}</style><style>
  :root { --bg:#101720; --card:#17202b; --ink:#f3f5f8; --muted:#acb9c8; --line:#394a5a; }
  body { margin:0; background:var(--bg); color:var(--ink); font:20px/1.5 system-ui; }
  main { max-width:920px; margin:40px auto; padding:20px; } article { padding:24px 0; } h1 { font-size:32px; }
  button { color:inherit; background:#283544; border:1px solid #53677b; border-radius:10px; padding:10px; margin:4px; font:inherit; }
  a { color:#83dcc2; } label { display:block; margin:15px 0; } input,textarea { display:block; box-sizing:border-box; max-width:100%; width:540px; font:20px/1.5 system-ui; padding:12px; background:#1b2938; color:white; border:1px solid #53677b; border-radius:12px; }
  @media(max-width:480px) { main { margin:0; padding:16px; } h1 { font-size:26px; } }
</style>`);
createRoot(document.getElementById("root")!).render(<Fixture />);
