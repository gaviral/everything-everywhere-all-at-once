#!/usr/bin/env node
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs, validateFixture, connectionURL, nextDelay, schedulePlayback, startFeed } from "./demo-jobs.mjs";

const cli = fileURLToPath(new URL("./demo-jobs.mjs", import.meta.url));
// A cold Node start can exceed a few seconds while parallel gate runs compile Rust.
const cliTimeout = 60_000;
const fixture = JSON.parse(readFileSync(new URL("../samples/demo-jobs.json", import.meta.url), "utf8"));
const copy = (value) => structuredClone(value);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(test, description) {
  const end = performance.now() + cliTimeout;
  while (!test()) {
    assert.ok(performance.now() < end, `Timed out: ${description}`);
    await sleep(5);
  }
}

function controlledTime() {
  let now = 10000, id = 0;
  const timers = new Map();
  return {
    now: () => now,
    setTimeout(fn, ms) { const key = ++id; timers.set(key, { at: now + ms, fn, ms }); return key; },
    clearTimeout: (key) => timers.delete(key),
    get pending() { return timers.size; },
    get delay() { return [...timers.values()][0]?.ms; },
    advance(ms) {
      const end = now + ms;
      while ([...timers.values()].some((timer) => timer.at <= end)) this.next();
      now = end;
    },
    next(late = 0) {
      const [key, timer] = [...timers].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0] ?? [];
      assert.ok(timer, "expected a scheduled callback");
      timers.delete(key);
      now = Math.max(now, timer.at) + late;
      timer.fn();
    },
  };
}

function assertPaced(times) {
  for (let i = 4; i < times.length; i++) assert.ok(times[i] - times[i - 4] >= 1000, `five messages within a rolling second at ${i}`);
}

function checkFixtureAndArguments() {
  assert.equal(validateFixture(fixture), fixture);
  assert.equal(fixture[0].at, 0);
  assert.equal(fixture.at(-1).at, 60);
  assertPaced(fixture.map((e) => e.at * 1000));
  const jobs = fixture.map((e) => e.message).filter((m) => m.type === "job");
  assert.ok(jobs.every((m) => m.demo === true));
  const pottery = jobs.filter((m) => m.title === "Find the pottery class on Main Street");
  assert.deepEqual(pottery.map((m) => m.status), ["running", "done"]);
  assert.match(pottery[1].result, /Saturdays at 10 AM.*\$45/);
  assert.match(jobs[0].title, /Mom's birthday on Saturday/);
  const birthday = jobs.filter((m) => m.title === "Draft a birthday card for Mom");
  assert.deepEqual(birthday.map((m) => m.status), ["running", "waiting"]);
  assert.match(birthday[1].result, /\?$/);
  assert.ok(fixture.some((e) => e.message.type === "hold" && e.message.text === birthday[1].result));
  assert.ok(jobs.some((m) => m.parent && jobs.some((p) => p.id === m.parent)));
  // Every job is marked demo (above), so the Work spine labels the whole feed simulated, failures included.
  assert.ok(jobs.some((m) => m.status === "failed" && m.result));
  assert.ok(jobs.some((m) => /rent/i.test(m.title)));
  assert.ok(jobs.some((m) => /study plan/i.test(m.title)));

  assert.deepEqual(parseArgs([]), { port: 4321, speed: 1 });
  assert.deepEqual(parseArgs(["--speed", "2.5", "--room", "A&B ?", "--port", "5000"]), { port: 5000, speed: 2.5, room: "A&B ?" });
  assert.equal(parseArgs(["--speed", "1e2"]).speed, 100);
  assert.equal(parseArgs(["--port", "65535"]).port, 65535);
  const url = new URL(connectionURL(parseArgs([])));
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.pathname, "/ws");
  assert.deepEqual([...url.searchParams], [["name", "agent"], ["ai", "true"]]);
  assert.equal(new URL(connectionURL(parseArgs(["--room", "A&B ?"]))).searchParams.get("room"), "A&B ?");

  const badArgs = [
    ["--unknown"], ["file.json"], ["--port"], ["--room"], ["--speed"], ["--room", ""], ["--room", " "], ["--room", " x"],
    ["--port", "--speed", "2"], ["--port", "0"], ["--port", "65536"], ["--port", "4399"], ["--port", "4.5"],
    ["--port", "NaN"], ["--port", "1e3"], ["--port", "0x10"], ["--speed", "0"], ["--speed", "-1"],
    ["--speed", "Infinity"], ["--speed", "NaN"], ["--speed", "1e999"], ["--speed", "1e-999"], ["--speed", "0x10"],
    ["--speed", "2x"], ["--speed=2"], ["--speed", "2", "--speed", "3"], ["--help", "extra"],
  ];
  for (const args of badArgs) assert.throws(() => parseArgs(args), undefined, JSON.stringify(args));
  for (const invalid of [null, [], {}, [{ at: 0, message: {} }]]) assert.throws(() => validateFixture(invalid));
  let constructions = 0;
  class MustNotConnect { constructor() { constructions++; throw new Error("opened socket before validation"); } }
  for (const mutate of [
    (f) => { delete f[0].message.demo; }, (f) => { f[0].message.demo = false; }, (f) => { f[0].message.demo = "true"; },
    (f) => { f[2].at = 1; }, (f) => { f[0].at = -1; }, (f) => { f[0].at = 1; }, (f) => { f.at(-1).at = 61; },
    (f) => { f[1].at = NaN; }, (f) => { f[1].at = Infinity; }, (f) => { f[1].at = "5"; },
    (f) => { f[0].message = null; }, (f) => { f[0].message.type = "text"; }, (f) => { f[0].message.status = "ready"; },
    (f) => { f[0].message.id = "has spaces"; }, (f) => { f[0].message.title = ""; }, (f) => { f[0].message.title = "x".repeat(81); },
    (f) => { f[0].message.result = "x".repeat(161); }, (f) => { f[0].message.result = null; },
    (f) => { f[0].message.parent = 1; }, (f) => { f[5].message.text = "x".repeat(141); },
  ]) {
    const invalid = copy(fixture); mutate(invalid);
    assert.throws(() => startFeed(invalid, parseArgs([]), { WebSocketImpl: MustNotConnect }));
  }
  for (const options of [{ port: 0, speed: 1 }, { port: 4321, speed: NaN }]) {
    assert.throws(() => startFeed(fixture, options, { WebSocketImpl: MustNotConnect }));
  }
  assert.equal(constructions, 0);
  // Each invocation exits without a server, including help; import above also had no side effects.
  const help = spawnSync(process.execPath, [cli, "--help"], { encoding: "utf8", timeout: cliTimeout });
  assert.equal(help.status, 0); assert.match(help.stdout, /Usage:/); assert.match(help.stdout, /simulated/); assert.match(help.stdout, /Ctrl\+C/);
  for (const args of badArgs) {
    const child = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", timeout: cliTimeout });
    assert.equal(child.status, 1, `${JSON.stringify(args)}: ${child.error?.message ?? child.stderr}`);
    assert.ok(child.stderr.trim());
    assert.doesNotMatch(child.stdout + child.stderr, /Connection failed|Connected as/);
  }
}

function checkScheduler() {
  assert.equal(nextDelay(12, 2, 1000, 2000, []), 5000);
  for (const speed of [0.5, 1, 2, 1000]) {
    const time = controlledTime(), start = time.now(), sent = [], logs = [];
    let done = 0;
    schedulePlayback(fixture, speed, (message) => sent.push({ at: time.now() - start, message }), { time, log: (s) => logs.push(s), onDone: () => done++ });
    for (let steps = 0; time.pending; steps++) { assert.ok(steps < 100); time.next(); }
    assert.deepEqual(sent.map((e) => e.message), fixture.map((e) => e.message));
    assertPaced(sent.map((e) => e.at)); // Includes the hold in the same budget.
    assert.equal(done, 1);
    if (speed <= 2) {
      assert.deepEqual(sent.map((e) => e.at), fixture.map((e) => e.at * 1000 / speed));
      assert.ok(!logs.some((s) => /stretches/.test(s)));
    } else {
      assert.ok(sent.at(-1).at > 60000 / speed);
      assert.equal(logs.filter((s) => /stretches/.test(s)).length, 1);
    }
  }
  // Ordinary callback overhead must not accumulate: the last event is still at 60 seconds.
  const time = controlledTime(), start = time.now(), times = [];
  schedulePlayback(fixture, 1, () => times.push(time.now() - start), { time, log: () => {} });
  while (time.pending) time.next(17);
  assert.ok(times.at(-1) <= 60017);
  // A stalled event loop can make all events overdue. Catch-up still shares the rolling budget.
  const late = controlledTime(), caught = [];
  schedulePlayback(fixture, 1000, () => caught.push(late.now()), { time: late, log: () => {} });
  late.next(70000);
  while (late.pending) late.next();
  assertPaced(caught);
  const slow = controlledTime();
  const cancel = schedulePlayback(fixture, Number.MIN_VALUE, () => {}, { time: slow, log: () => {} });
  slow.next(); slow.next();
  assert.equal(slow.delay, 2 ** 31 - 1);
  cancel(); assert.equal(slow.pending, 0);
}

// Same dependency-free HTTP upgrade and masked-frame pattern as headless.mjs, with close replies.
function frame(body, opcode = 1) {
  body = Buffer.from(body);
  const n = body.length;
  const head = n < 126 ? Buffer.from([0x80 | opcode, n]) : Buffer.from([0x80 | opcode, 126, n >> 8, n & 255]);
  return Buffer.concat([head, body]);
}
function unframe(buffer) {
  const frames = [];
  let at = 0;
  while (buffer.length - at >= 2) {
    const opcode = buffer[at] & 15, masked = buffer[at + 1] & 128;
    let n = buffer[at + 1] & 127, head = 2;
    if (n === 126) { if (buffer.length - at < 4) break; n = buffer.readUInt16BE(at + 2); head = 4; }
    else if (n === 127) { if (buffer.length - at < 10) break; n = Number(buffer.readBigUInt64BE(at + 2)); head = 10; }
    const mask = masked ? buffer.subarray(at + head, at + head + 4) : null;
    head += masked ? 4 : 0;
    if (buffer.length - at < head + n) break;
    const body = Buffer.from(buffer.subarray(at + head, at + head + n));
    if (mask) for (let i = 0; i < n; i++) body[i] ^= mask[i % 4];
    frames.push({ opcode, body }); at += head + n;
  }
  return { frames, rest: buffer.subarray(at) };
}
async function fakeEndpoint({ refuse = false, now = () => performance.now() } = {}) {
  const sockets = new Set(), urls = [], heard = [], times = [];
  const server = createServer((req, res) => res.writeHead(404).end());
  server.on("upgrade", (req, socket, head) => {
    sockets.add(socket); urls.push(new URL(req.url, "http://local"));
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
    socket.on("end", () => socket.end());
    if (refuse) { socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"); return; }
    const accept = createHash("sha1").update(req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    let pending = Buffer.alloc(0);
    function receive(data) {
      const decoded = unframe(Buffer.concat([pending, data])); pending = Buffer.from(decoded.rest);
      for (const { opcode, body } of decoded.frames) {
        if (opcode === 1) { heard.push(JSON.parse(body)); times.push(now()); }
        if (opcode === 8) socket.end(frame(body, 8));
        if (opcode === 9) socket.write(frame(body, 10));
      }
    }
    socket.on("data", receive);
    if (head.length) receive(head);
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  return {
    port: server.address().port, urls, heard, times,
    connected: () => sockets.size,
    send: (message) => { for (const socket of sockets) socket.write(frame(JSON.stringify(message))); },
    drop: () => { for (const socket of sockets) socket.destroy(); },
    close: async () => { for (const socket of sockets) socket.destroy(); await new Promise((resolve) => server.close(resolve)); },
  };
}

async function checkLifecycle() {
  for (const failure of ["timeout", "error", "disconnect", "send", "stop", "stuck close"]) {
    const time = controlledTime(), logs = [], errors = [];
    let ws;
    class Socket {
      readyState = 0; closes = 0;
      constructor() { ws = this; }
      send() { if (failure === "send") throw new Error("test write failure"); }
      close() { this.closes++; this.readyState = 3; if (failure !== "stuck close") this.onclose?.({ code: 1000 }); }
    }
    const feed = startFeed(fixture, parseArgs([]), { WebSocketImpl: Socket, time, log: (s) => logs.push(s), error: (s) => errors.push(s) });
    if (failure === "timeout") time.next();
    else if (failure === "error") ws.onerror();
    else if (failure === "stuck close") { feed.stop(); time.next(); }
    else {
      ws.readyState = 1; ws.onopen();
      if (failure === "disconnect") { ws.readyState = 3; ws.onclose({ code: 1006 }); }
      else if (failure === "send") time.next();
      else feed.stop();
    }
    assert.equal(await feed.closed, ["stop", "stuck close"].includes(failure) ? 0 : 1);
    assert.equal(time.pending, 0, `${failure} must cancel every timer`);
    assert.equal(ws.onopen, null); assert.equal(ws.onmessage, null);
    if (failure !== "disconnect") assert.equal(ws.closes, 1);
    if (!["stop", "stuck close"].includes(failure)) assert.ok(errors.length);
    feed.stop(); assert.equal(time.pending, 0);
  }
  for (const failure of ["stop", "disconnect", "send"]) {
    const time = controlledTime(), sent = [], errors = [];
    let ws, failSend = false;
    class Socket {
      readyState = 0;
      constructor() { ws = this; }
      send(data) {
        if (failSend) throw new Error("continuation write failure");
        sent.push(JSON.parse(data));
      }
      close() { this.readyState = 3; this.onclose?.({ code: 1000 }); }
    }
    const feed = startFeed(fixture, { port: 4321, speed: 1000 }, { WebSocketImpl: Socket, time, log: () => {}, error: (s) => errors.push(s) });
    ws.readyState = 1; ws.onopen();
    while (!sent.some((m) => m.id === "demo-card" && m.status === "waiting")) time.next();
    ws.onmessage({ data: JSON.stringify({ type: "answer", by: "Parent", text: "Keep it a surprise" }) });
    const count = sent.length;
    time.next(); // The continuation is now waiting for the shared relay budget.
    assert.equal(sent.length, count);
    assert.equal(time.pending, 1);
    if (failure === "stop") feed.stop();
    else if (failure === "disconnect") { ws.readyState = 3; ws.onclose({ code: 1006 }); }
    else { failSend = true; time.next(); }
    assert.equal(await feed.closed, failure === "stop" ? 0 : 1);
    assert.equal(time.pending, 0, `${failure} cancels a pending continuation and timeline`);
    time.advance(100000);
    assert.equal(sent.length, count, "shutdown sends no remaining continuation or prepared work");
    if (failure === "send") assert.match(errors[0], /continuation write failure/);
  }
}

async function checkWireWithControlledTime() {
  const endpoint = await fakeEndpoint(), time = controlledTime(), logs = [], errors = [];
  const feed = startFeed(fixture, { port: endpoint.port, speed: 2, room: "ROOM &?" }, { time, log: (s) => logs.push(s), error: (s) => errors.push(s) });
  try {
    await until(() => logs.some((s) => /Connected as/.test(s)), "open fake socket");
    assert.deepEqual([...endpoint.urls[0].searchParams], [["name", "agent"], ["ai", "true"], ["room", "ROOM &?"]]);
    let sent = 0;
    for (let steps = 0; !logs.some((s) => /feed complete/.test(s)); steps++) {
      assert.ok(steps < 100); time.next();
      const progress = logs.filter((s) => /\[simulated\]/.test(s)).length;
      if (progress > sent) { sent = progress; await until(() => endpoint.heard.length === sent, "outbound job/hold frame"); }
    }
    assert.deepEqual(endpoint.heard, fixture.map((e) => e.message));
    assert.equal(time.pending, 0);
    assert.equal(endpoint.connected(), 1, "final event keeps socket open for answers");
    endpoint.send({ type: "answer", by: "Parent", text: "Please say Mom." });
    endpoint.send({ type: "notice", message: "Test notice from fake relay." });
    await until(() => logs.includes("Answer from Parent: Please say Mom.") && errors.includes("Notice: Test notice from fake relay."), "incoming answer and notice printing");
    feed.stop(); assert.equal(await feed.closed, 0); assert.equal(time.pending, 0);
    await until(() => endpoint.connected() === 0, "clean close frame");
    console.log(`demo-jobs-check: ${sent} outbound jobs/holds verified; ${logs.find((s) => s.startsWith("Answer from"))}`);
  } finally { feed.stop(); await endpoint.close(); }

  const card = fixture.find((e) => e.message.id === "demo-card" && e.message.status === "waiting").message;
  const birthday = fixture[0].message;
  const hold = fixture.find((e) => e.message.type === "hold").message;
  for (const speed of [2, 1000]) {
    for (const phase of ["waiting", "hold", "final"]) {
      for (const [text, result] of [
        ["KEEP IT A SURPRISE", "Keeps the class a surprise"],
        ["mention the pottery class in mom's CARD", "Mentions the pottery class"],
        ["keep it a surprise, thanks", "Keeps the class a surprise"],
      ]) {
        const time = controlledTime(), start = time.now(), logs = [], errors = [];
        const endpoint = await fakeEndpoint({ now: time.now });
        const feed = startFeed(fixture, { port: endpoint.port, speed }, { time, log: (s) => logs.push(s), error: (s) => errors.push(s) });
        async function tick() {
          time.next();
          const sent = logs.filter((s) => /\[simulated\]/.test(s)).length;
          await until(() => endpoint.heard.length === sent, "controlled continuation wire frames");
        }
        async function drain() {
          for (let steps = 0; time.pending; steps++) { assert.ok(steps < 100); await tick(); }
        }
        async function answer(text) {
          const count = logs.filter((s) => s.startsWith("Answer from")).length;
          endpoint.send({ type: "answer", by: "Parent", text });
          await until(() => logs.filter((s) => s.startsWith("Answer from")).length === count + 1, "answer logged");
          assert.ok(logs.includes(`Answer from Parent: ${text}`));
        }
        try {
          await until(() => logs.some((s) => /Connected as/.test(s)), "open continuation socket");
          await tick();
          await answer(text); // A recognized choice before the card is waiting is only logged.
          assert.equal(endpoint.heard.length, 1);
          while (!endpoint.heard.some((m) => m.id === card.id && m.status === "waiting")) await tick();
          assert.deepEqual(endpoint.heard, fixture.slice(0, 5).map((e) => e.message), "early answer invents no choice");
          await answer("Thanks for the options.");
          await answer("Keep it a surprise next week");
          await answer(null);
          assert.equal(endpoint.heard.length, 5, "unrelated, unrecognized and non-text answers only log");
          if (phase === "hold") while (!endpoint.heard.some((m) => m.type === "hold" && m.text === hold.text)) await tick();
          if (phase === "final") await drain();
          const before = endpoint.heard.length, answeredAt = time.now();
          const expectedTimes = endpoint.times.slice(-4), continuationTimes = [];
          let due = answeredAt;
          for (let i = 0; i < 3; i++) {
            due += nextDelay(0, speed, start, due, expectedTimes);
            continuationTimes.push(due);
            expectedTimes.push(due);
            if (expectedTimes.length > 4) expectedTimes.shift();
          }
          await answer(text);
          await answer(text === "KEEP IT A SURPRISE" ? "Mention the pottery class in Mom's card" : "Keep it a surprise");
          assert.equal(time.pending, 1, "one shared scheduler handles the continuation");
          await drain();
          const continuation = [
            { ...card, status: "done", result },
            { ...birthday, status: "done", result: "Class found · card ready" },
            { type: "hold", text: "" },
          ];
          const prepared = fixture.map((e) => e.message);
          const remaining = prepared.slice(before).filter((m) => m !== hold && !(m.id === birthday.id && m.status === "waiting"));
          assert.deepEqual(endpoint.heard, [...prepared.slice(0, before), ...continuation, ...remaining], `${speed}/${phase}/${text}: exact continuation and remaining work`);
          assert.deepEqual(endpoint.times.slice(before, before + 3), continuationTimes, "continuation uses the first available budget slots");
          assertPaced(endpoint.times); // Prepared jobs, holds, completion and withdrawal all share it.
          assert.deepEqual(endpoint.heard.filter((m) => m.type === "hold").at(-1), { type: "hold", text: "" }, "question withdrawn without a later hold restoring it");
          for (const id of [card.id, birthday.id]) {
            assert.equal(endpoint.heard.filter((m) => m.id === id && m.status === "done").length, 1);
            assert.equal(endpoint.heard.filter((m) => m.id === id).at(-1).status, "done", "later prepared events cannot reverse completion");
          }
          if (phase !== "final" && speed === 2) assert.ok(endpoint.times[before] < start + 60000 / speed, "answer continues before the timeline endpoint");
          assert.equal(logs.filter((s) => /feed complete/.test(s)).length, 1);
          assert.equal(time.pending, 0);
          assert.equal(endpoint.connected(), 1, "socket stays open after continuation");
          await answer(text);
          time.advance(100000);
          assert.equal(time.pending, 0);
          assert.equal(endpoint.heard.length, before + 3 + remaining.length, "duplicate after completion sends nothing");
          assert.deepEqual(errors, []);
          feed.stop(); assert.equal(await feed.closed, 0); assert.equal(time.pending, 0);
        } finally { feed.stop(); await endpoint.close(); }
      }
    }
  }
  console.log("demo answer continuation: ok");
}

function childFeed(port, extra = []) {
  const child = spawn(process.execPath, [cli, "--port", String(port), ...extra], { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  child.stdout.on("data", (data) => { stdout += data; });
  child.stderr.on("data", (data) => { stderr += data; });
  const exited = new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", (code, signal) => resolve({ code, signal })); });
  const watchdog = setTimeout(() => child.kill("SIGKILL"), cliTimeout * 2);
  exited.finally(() => clearTimeout(watchdog));
  return { child, exited, out: () => stdout, err: () => stderr };
}

async function checkCLI() {
  const endpoint = await fakeEndpoint();
  let run;
  try {
    // Actual CLI, built-in WebSocket, real pacing, and SIGINT after the full feed.
    run = childFeed(endpoint.port, ["--speed", "1000"]);
    await until(() => /feed complete/.test(run.out()), "full CLI playback");
    await until(() => endpoint.heard.length === fixture.length, "all CLI wire payloads");
    assert.deepEqual(endpoint.heard, fixture.map((e) => e.message));
    assert.deepEqual([...endpoint.urls[0].searchParams], [["name", "agent"], ["ai", "true"]]);
    // The scheduler/lifecycle fixtures above verify the exact send budget with controlled time. A busy parent
    // can receive several already-paced socket frames together, so receipt timestamps cannot measure send pacing.
    assert.match(run.out(), /pacing stretches/);
    assert.equal(run.child.exitCode, null);
    endpoint.send({ type: "answer", by: "Reader", text: "Thanks for the options." });
    await until(() => /Answer from Reader: Thanks for the options\./.test(run.out()), "CLI answer printing");
    run.child.kill("SIGINT");
    assert.deepEqual(await run.exited, { code: 0, signal: null });
    assert.match(run.out(), /Closing simulated feed/);
    await until(() => endpoint.connected() === 0, "CLI Ctrl+C socket cleanup");

    run = childFeed(endpoint.port);
    await until(() => /Connected as/.test(run.out()), "CLI connected before unexpected drop");
    endpoint.drop();
    assert.equal((await run.exited).code, 1);
    assert.match(run.err(), /Unexpected disconnect/);
  } finally { if (run?.child.exitCode === null) run.child.kill("SIGKILL"); await endpoint.close(); }

  const refused = await fakeEndpoint({ refuse: true });
  try {
    run = childFeed(refused.port);
    assert.equal((await run.exited).code, 1);
    assert.match(run.err(), /Connection failed/);
    assert.equal(refused.heard.length, 0);
    await until(() => refused.connected() === 0, "failed connection cleanup");
  } finally { if (run?.child.exitCode === null) run.child.kill("SIGKILL"); await refused.close(); }
}

checkFixtureAndArguments();
checkScheduler();
await checkLifecycle();
await checkWireWithControlledTime();
await checkCLI();
console.log("demo-jobs-check: ok");
