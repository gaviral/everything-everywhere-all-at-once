// Job identity and observed timing, through the real store without a browser.
import assert from "node:assert/strict";
import { uiServer } from "./ui-server.mjs";

const server = await uiServer();
try {
  const { receiveJob, resetJobs, useJobs } = await server.ssrLoadModule("/src/work-jobs.ts");
  const { createElement } = await import("../ui/node_modules/react/index.js");
  const { renderToString } = await import("../ui/node_modules/react-dom/server.node.js");
  const readJobs = () => {
    let jobs;
    renderToString(createElement(() => { jobs = useJobs(); return null; }));
    return jobs;
  };
  const job = (by, id, status, at_ms) => ({ type: "job", by, id, title: id, status, at_ms, demo: false });
  const identities = () => readJobs().map(({ by, id }) => [by, id]);

  resetJobs();
  assert.equal(receiveJob(job("First", "shared", "running", 1000)), true);
  assert.equal(receiveJob(job("Second", "shared", "done", 2000)), true);
  assert.equal(receiveJob(job("First", "later", "waiting", 3000)), true);
  const order = [["First", "shared"], ["Second", "shared"], ["First", "later"]];
  assert.deepEqual(identities(), order, "two senders sharing an id stay separate");
  assert.equal(readJobs()[0].started_ms, 1000);
  assert.equal(readJobs()[0].ended_ms, undefined);
  assert.equal(readJobs()[1].started_ms, undefined, "a second sender inherits no start time");
  assert.equal(readJobs()[1].ended_ms, 2000);

  const second = readJobs()[1];
  receiveJob(job("First", "shared", "waiting", 4000));
  assert.equal(readJobs()[0].status, "waiting");
  assert.equal(readJobs()[0].started_ms, 1000);
  assert.equal(readJobs()[0].ended_ms, undefined);
  assert.strictEqual(readJobs()[1], second, "updating one preserves the other's status and timing");
  assert.deepEqual(identities(), order, "same-sender updates keep their first position");

  const first = readJobs()[0];
  receiveJob(job("Second", "shared", "running", 5000));
  assert.equal(readJobs()[1].started_ms, 5000, "a completed job running again starts over");
  assert.equal(readJobs()[1].ended_ms, undefined);
  assert.strictEqual(readJobs()[0], first);
  receiveJob(job("Second", "shared", "failed", 6000));
  assert.equal(readJobs()[1].started_ms, 5000);
  assert.equal(readJobs()[1].ended_ms, 6000);
  assert.strictEqual(readJobs()[0], first);
  assert.deepEqual(identities(), order);

  const before = readJobs();
  assert.equal(receiveJob({ ...job("First", "shared", "done", 7000), at_ms: NaN }), true);
  assert.equal(receiveJob({ ...job("First", "shared", "done", 7000), parent: 42 }), true);
  assert.equal(receiveJob({ type: "notice" }), false);
  assert.strictEqual(readJobs(), before, "invalid messages preserve the store");
  resetJobs();
  assert.deepEqual(readJobs(), []);
  console.log("job-identity-check: ok");
} finally {
  await server.close();
}
