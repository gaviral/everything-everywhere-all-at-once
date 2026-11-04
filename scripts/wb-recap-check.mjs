// Synthetic Recap fixtures, using the same SSR helper as recap-check.mjs. No sockets, mic, downloads or native core.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import React from "../ui/node_modules/react/index.js";
import ReactDOMServer from "../ui/node_modules/react-dom/server.node.js";
import { uiServer } from "./ui-server.mjs";

globalThis.location = new URL("http://localhost/");
const base = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const before = execFileSync("git", ["show", `${base}:ui/src/Recap.tsx`], { encoding: "utf8" });
const baselineId = new URL("../ui/src/__wb_recap_baseline__.tsx", import.meta.url).pathname;
const server = await uiServer({ plugins: [{ name: "wb-recap-baseline", enforce: "pre",
  resolveId: id => id === baselineId ? id : null,
  load: id => id === baselineId ? before : null,
}] });
try {
  const { Recap } = await server.ssrLoadModule("/src/Recap.tsx");
  const { Recap: Before } = await server.ssrLoadModule(baselineId);
  const { SiteContext, LOCAL } = await server.ssrLoadModule("/src/site.ts");
  const through = Date.UTC(2026, 10, 3, 18, 20);
  const world = { threads: [{ id: "T1", title: "Book table", parent_id: null, status: "open", last_point: "",
    touched_ms: through, tags: [], picture: null, dropped_by: "" }],
    thoughts: [{ id: "P1", speaker: "you", text: "Use the blue cover", point: "Use the blue cover", thread_id: "T1",
      placed: true, complete: true, at_ms: through, place_ms: null }],
    active: "T1", active_by: { you: "T1" }, recaps: [], suggestions: [], actions: [], merged: {}, apps: [], apps_seeded: true };
  const recap = { period: "today", since_ms: through - 60000, through_ms: through, generated_ms: through + 1000,
    source_key: "synthetic", summary: "Keep twelve blue covers for the table.",
    decisions: [{ thread_id: "T1", text: "Use the blue cover" }], plans: [], questions: [],
    worked_on: [{ thread_id: "T1", text: "Compared cover colors." }], unfinished: [], actions: [],
    thought_count: 1, thread_count: 1, limited: false };
  const action = (status, extra = {}) => ({ id: "A1", thread_id: "T1", title: "Bring the covers", kind: "event",
    when: "2026-11-05", status, ...extra });
  const props = { view: { period: "today", recap, loading: false, message: "" }, world, connected: true,
    noKey: false, listening: false, onRequest() {}, onMark: () => true, onClose() {}, onFocus() {} };
  // Retain the rendered DOM elements too, so the actual row/request handlers can be exercised without effects.
  const render = (overrides = {}, site = LOCAL, Component = Recap) => {
    let tree;
    function Fixture() { tree = Component({ ...props, ...overrides }); return tree; }
    const html = ReactDOMServer.renderToStaticMarkup(React.createElement(SiteContext.Provider, { value: site }, React.createElement(Fixture)));
    const nodes = [];
    const walk = node => {
      if (!React.isValidElement(node)) return;
      nodes.push(node);
      React.Children.forEach(node.props.children, walk);
    };
    walk(tree);
    return { html, nodes };
  };
  const saved = JSON.stringify(recap);
  for (const overrides of [{}, { view: { ...props.view, loading: true } },
    { view: { ...props.view, period: "session", recap: { ...recap, period: "session" } } }]) {
    assert.equal(render(overrides).html, render(overrides, LOCAL, Before).html, "healthy recap stays byte-identical to main");
  }
  for (const resting of [false, true]) {
    const outage = render({ noKey: true, resting });
    assert.ok(outage.html.includes(`<p class="recap-summary">${recap.summary}</p>`), "exact saved summary");
    assert.ok(outage.html.includes(recap.decisions[0].text), "saved decision remains readable");
    const date = new Date(through).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const time = new Date(through).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    assert.ok(outage.html.includes(`${date} · last saved through ${time}`), "saved through time is labelled, never regenerated");
    assert.ok(outage.html.includes(resting ? "Recap is back tomorrow: today&#x27;s free tries are used up." : "Recap needs a working AI key."));
    assert.equal(outage.nodes.find(n => n.props.className === "recap-refresh").props.disabled, true, "Update remains disabled");
    const empty = { noKey: true, resting, view: { ...props.view, recap: null } };
    assert.equal(render(empty).html, render(empty, LOCAL, Before).html, "empty outage copy and controls unchanged");
  }
  const withActions = actions => ({ view: { ...props.view, recap: { ...recap, actions } } });
  const proposal = withActions([action("new", { when: "Thursday" })]);
  for (const calendarFile of [false, true]) {
    const site = { ...LOCAL, hosted: calendarFile, calendarFile };
    assert.equal(render(proposal, site).html, render(proposal, site, Before).html, "unapproved proposal markup unchanged");
    const kept = render(withActions([action("kept", { when: "Thursday" })]), site).html;
    assert.match(kept, />Adding <span>1<\/span>/);
    assert.ok(kept.includes("Adding to Reminders…"), "invalid date resolves to Reminders");
    assert.ok(!kept.includes("Pending approval"));
  }
  const hosted = { ...LOCAL, hosted: true, calendarFile: true };
  const file = render(withActions([action("done")]), hosted).html;
  assert.ok(file.includes("Saved as .ics") && !file.includes("Added to Calendar"), "file save claims no external arrival");
  for (const [when, app] of [["2026-11-05", "Calendar"], ["Thursday", "Reminders"], ["", "Reminders"]]) {
    for (const site of [LOCAL, hosted]) {
      const done = render(withActions([action("done", { when, done_ms: 1200 })]), site).html;
      assert.ok(done.includes(`Added to ${app}${site.calendarFile ? "" : " · 1.2 s"}`), "native receipt uses actionLine destination and timing");
      assert.ok(!done.includes("Saved as .ics"), "native receipt is not a file save");
    }
  }
  const callbacks = Component => {
    const calls = [];
    const result = render({ ...proposal, onRequest: period => calls.push(["recap", period]),
      onClose: () => calls.push(["close"]), onFocus: id => calls.push(["focus", id]) }, LOCAL, Component);
    result.nodes.find(n => n.props.className === "recap-refresh").props.onClick();
    for (const button of result.nodes.filter(n => n.type === "button" && "aria-pressed" in n.props && !n.props.className)) button.props.onClick();
    const row = result.nodes.find(n => n.props.className === "recap-actions");
    const link = row.props.children[0].props.children[0];
    link.props.onClick({ preventDefault: () => calls.push(["preventDefault"]) });
    return calls;
  };
  assert.deepEqual(callbacks(Recap), callbacks(Before), "proposal navigation and request callbacks unchanged");
  assert.deepEqual(callbacks(Recap), [["recap", "today"], ["recap", "session"], ["recap", "today"], ["preventDefault"], ["close"], ["focus", "T1"]]);
  assert.equal(JSON.stringify(recap), saved, "saved data unchanged");
  console.log(`wb-recap-check: passed (saved/empty outage, healthy main ${base.slice(0, 8)}, proposal markup/callbacks, Adding, file/native receipts; no native effects)`);
} finally {
  await server.close();
}
