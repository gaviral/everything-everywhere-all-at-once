import { useState } from "react";
import type { Input } from "./transport";

export function Keyboard({ disabled, send }: { disabled: boolean; send: (input: Input) => Promise<boolean> }) {
  const [modifiers, setModifiers] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const key = async (value: string) => { if (await send({ kind: "key", key: value, modifiers })) setModifiers([]); };
  const type = async () => {
    setSending(true);
    try { if (await send({ kind: "text", text })) setText(""); } finally { setSending(false); }
  };
  return <fieldset className="phone-pointer-keyboard" disabled={disabled || sending}>
    <legend>Keyboard <small>Modifiers apply to the next key</small></legend>
    <div className="phone-pointer-keyrow">{["command", "control", "option", "shift"].map(modifier =>
      <button type="button" key={modifier} aria-pressed={modifiers.includes(modifier)} onClick={() => setModifiers(old => old.includes(modifier) ? old.filter(item => item !== modifier) : [...old, modifier])}>
        {{ command: "⌘", control: "⌃", option: "⌥", shift: "⇧" }[modifier]}
        <span className="phone-pointer-sr">{modifier}</span>
      </button>)}</div>
    <div className="phone-pointer-keyrow">{["Escape", "Tab", "Enter", "Backspace", "ArrowLeft", "ArrowUp", "ArrowDown", "ArrowRight"].map(value =>
      <button type="button" key={value} aria-label={value} onClick={() => void key(value)}>
        {{ Escape: "Esc", Backspace: "⌫", ArrowLeft: "←", ArrowUp: "↑", ArrowDown: "↓", ArrowRight: "→" }[value] ?? value}
      </button>)}</div>
    <form onSubmit={event => { event.preventDefault(); if (text) void type(); }}>
      <label>Type on the Mac<input value={text} maxLength={500} autoComplete="off" placeholder="Your words…"
        onChange={event => setText(event.target.value)} /></label><button type="submit" disabled={!text}>Send text</button>
    </form>
    <label className="phone-pointer-shortcut">Shortcut key<input aria-label="Shortcut key" maxLength={1} value="" placeholder="Tap, then type a letter"
      autoComplete="off" onChange={event => { const value = event.target.value.toLowerCase(); if (/^[a-z0-9]$/.test(value)) void key(value); }} /></label>
  </fieldset>;
}
