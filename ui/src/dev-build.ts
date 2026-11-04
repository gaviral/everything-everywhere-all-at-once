// Reload a served build only after this page has finished speaking, typing and sending.
import { useEffect, useRef } from "react";
import { pageSpeaking } from "./page-speech";

export function useDevBuild(busy: () => boolean) {
  const busyNow = useRef(busy);
  busyNow.current = busy;
  useEffect(() => {
    const tab = crypto.randomUUID();
    let current: string | null = import.meta.env.VITE_BUILD_ID || null;
    let available: string | null = null;
    let lastInput = Date.now();
    let ended = false;
    let checking = false;
    const activeDraft = () => [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('textarea,input:not([type]),input[type="text"],input[type="search"],[contenteditable="true"]')]
      .some(field => !field.readOnly && (field.isContentEditable ? field.textContent : field.value)?.trim());
    const isBusy = () => busyNow.current() || pageSpeaking() || activeDraft() || Date.now() - lastInput < 3000;
    const report = async () => {
      await fetch('/build-activity', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tab, busy: isBusy() }), keepalive: true });
    };
    const check = async () => {
      if (checking || ended) return;
      checking = true;
      try {
        const response = await fetch('/build-id', { cache: 'no-store' });
        if (!response.ok) return;
        const value = await response.json();
        if (!value.id || ended) return;
        if (current === null) current = value.id;
        if (value.id !== current) available = value.id;
        await report();
        if (!ended && available && available !== current && !isBusy()) location.reload();
      } catch { /* Reconnect will check again; an offline page keeps its draft. */ }
      finally { checking = false; }
    };
    const interacted = () => { lastInput = Date.now(); if (current) void report().catch(() => {}); };
    const close = () => { if (current) navigator.sendBeacon('/build-activity', new Blob([JSON.stringify({ tab, busy: false, closed: true })], { type: 'application/json' })); };
    for (const event of ['input', 'keydown', 'pointerdown']) document.addEventListener(event, interacted, true);
    window.addEventListener('e2a2o-build', check);
    window.addEventListener('online', check);
    window.addEventListener('pagehide', close);
    document.addEventListener('visibilitychange', check);
    const timer = window.setInterval(check, 2000);
    void check();
    return () => {
      ended = true;
      window.clearInterval(timer);
      close();
      for (const event of ['input', 'keydown', 'pointerdown']) document.removeEventListener(event, interacted, true);
      window.removeEventListener('e2a2o-build', check);
      window.removeEventListener('online', check);
      window.removeEventListener('pagehide', close);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);
}
