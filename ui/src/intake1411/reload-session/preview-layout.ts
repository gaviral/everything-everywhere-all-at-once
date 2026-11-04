export function renderPreviewLayout(root: HTMLElement): void {
  root.innerHTML = `
    <header class="reload-session-header">
      <div><p class="reload-session-eyebrow">PART PREVIEW / SYNTHETIC EVENTS</p>
        <h1>Pick up where you left off.</h1>
        <p>Keep an unsent draft, your selection and your place through a reload.</p></div>
      <label class="reload-session-toggle"><input id="recovery-enabled" type="checkbox" />
        <span>Reload recovery</span></label>
    </header>
    <section class="reload-session-status" aria-label="Recovery status">
      <p id="recovery-status" role="status" aria-live="polite"></p>
      <p id="checkpoint-status"></p>
    </section>
    <div class="reload-session-columns">
      <section class="reload-session-workspace" aria-label="Synthetic workspace">
        <div class="reload-session-toolbar">
          <label>View <select id="selected-view"><option value="map">Map</option>
            <option value="outline">Outline</option><option value="focus">Focus</option></select></label>
          <button id="pan-left" type="button">Pan left</button>
          <button id="pan-right" type="button">Pan right</button>
          <button id="zoom-in" type="button">Zoom in</button>
        </div>
        <div id="preview-scene" class="reload-session-scene" aria-label="Selected view">
          <div id="scene-content" class="reload-session-scene-content">
            <span class="reload-session-card">A small garden</span>
            <span class="reload-session-card">Plan the next step</span>
          </div>
        </div>
        <p class="reload-session-place"><span id="view-readout"></span> · <span id="revision-readout">Initial preview</span></p>
        <label class="reload-session-draft-label" for="unsent-draft">Unsent draft</label>
        <textarea id="unsent-draft" rows="5" placeholder="Try a synthetic thought…" spellcheck="false"></textarea>
        <p id="selection-readout" class="reload-session-selection">Selection 0–0</p>
      </section>
      <aside class="reload-session-controls" aria-label="Controlled driver">
        <h2>Try the loop</h2>
        <p>Turn recovery on. Type and select some text, choose a view, then pan.</p>
        <button id="reload-page" type="button">Reload preview</button>
        <div class="reload-session-control-group"><h3>Connection</h3>
          <button id="disconnect" type="button">Disconnect</button>
          <button id="connect" type="button">Connect only</button>
          <button id="matching-snapshot" type="button">Matching snapshot</button></div>
        <div class="reload-session-control-group"><h3>Build</h3>
          <button id="build-start" type="button">Start build</button>
          <button id="build-fail" type="button">Build error</button>
          <button id="build-recover" type="button">Recover build</button></div>
        <details><summary>Identity controls</summary>
          <label>Next snapshot <select id="snapshot-identity"><option value="matching">Matching</option>
            <option value="mapId">Other map</option><option value="sessionId">Other session</option>
            <option value="buildId">Other build</option></select></label>
          <button id="emit-snapshot" type="button">Deliver selected snapshot</button>
          <label>Open session <select id="open-session"><option value="sample">Sample</option>
            <option value="other">Other</option></select></label>
          <button id="switch-session" type="button">Open selected session</button>
        </details>
        <p class="reload-session-note">Controlled events verify this part in isolation. Source-edit recovery awaits the owner driver.</p>
        <output id="recovery-metrics" class="reload-session-metrics" aria-label="Recovery activity"></output>
      </aside>
    </div>`;
}

export function previewElement<T extends HTMLElement>(root: HTMLElement, id: string): T {
  const element = root.querySelector<T>(`#${id}`);
  if (!element) throw new Error(`Preview element missing: ${id}`);
  return element;
}
