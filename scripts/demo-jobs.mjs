#!/usr/bin/env node
// Prepared, explicitly simulated helper work. No model calls, bookings or payments.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const usage = `Usage: node scripts/demo-jobs.mjs [--port PORT] [--room CODE] [--speed N]
Plays a labeled, simulated helper feed from samples/demo-jobs.json.
Defaults: port 4321, speed 1 (60 seconds). Speed must be finite and positive.
Relay pacing may stretch fast playback. Jobs and holds share four messages/second.
After the final event, stays connected for answers. Press Ctrl+C to close cleanly.
--help  Show this help without connecting.`;

export function parseArgs(args) {
  const options = { port: 4321, speed: 1 };
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (!["--port", "--room", "--speed", "--help"].includes(flag) || seen.has(flag)) {
      throw new Error(`Unknown or repeated argument: ${flag}`);
    }
    seen.add(flag);
    if (flag === "--help") { options.help = true; continue; }
    const value = args[++i];
    if (!value || value.startsWith("--")) throw new Error(`${flag} needs a value.`);
    if (flag === "--room") {
      if (!value.trim() || value !== value.trim()) throw new Error("--room needs a nonempty code without surrounding spaces.");
      options.room = value;
    } else if (flag === "--port") {
      if (!/^\d+$/.test(value)) throw new Error("--port must be an integer from 1 to 65535.");
      options.port = Number(value);
    } else {
      if (!/^[+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value)) throw new Error("--speed must be finite and positive.");
      options.speed = Number(value);
    }
  }
  validateOptions(options);
  return options;
}

function validateOptions({ port, speed, room }) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("--port must be an integer from 1 to 65535.");
  if (port === 4399) throw new Error("Port 4399 is reserved; choose another port.");
  if (!Number.isFinite(speed) || speed <= 0) throw new Error("--speed must be finite and positive.");
  if (room !== undefined && (typeof room !== "string" || !room.trim() || room !== room.trim())) throw new Error("Invalid room code.");
}

const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const fits = (value, max) => typeof value === "string" && value.trim().length > 0 && [...value].length <= max;
const name = (value) => fits(value, 100) && /^[a-z0-9:_.-]+$/i.test(value);

/** Validate the entire fixture before any connection or timer can be created. */
export function validateFixture(events) {
  if (!Array.isArray(events) || !events.length) throw new Error("Fixture must be a nonempty ordered array.");
  let previous = -1;
  for (const [i, event] of events.entries()) {
    const fail = (why) => { throw new Error(`Fixture event ${i}: ${why}`); };
    if (!object(event) || !Number.isFinite(event.at) || event.at < 0 || event.at < previous) fail("times must be finite, nonnegative and monotonic.");
    previous = event.at;
    const m = event.message;
    if (!object(m)) fail("message must be an object.");
    if (m.type === "job") {
      if (m.demo !== true) fail("every job must be labeled demo:true.");
      if (!name(m.id) || !fits(m.title, 80) || !["running", "done", "waiting", "failed"].includes(m.status)) fail("invalid job id, title or status.");
      if (m.parent !== undefined && !name(m.parent)) fail("invalid job parent.");
      if (m.result !== undefined && (typeof m.result !== "string" || [...m.result].length > 160)) fail("invalid job result.");
    } else if (m.type === "hold") {
      if (!fits(m.text, 140)) fail("hold needs a short question.");
      if (m.target !== undefined && m.target !== null && !name(m.target)) fail("invalid hold target.");
      if (m.urgent !== undefined && typeof m.urgent !== "boolean") fail("invalid hold urgency.");
    } else fail("only job and hold messages are allowed.");
  }
  if (events[0].at !== 0 || events.at(-1).at !== 60) throw new Error("Fixture must start at 0 and end at 60 seconds.");
  return events;
}

export function connectionURL(options) {
  validateOptions(options);
  const query = new URLSearchParams({ name: "agent", ai: "true" });
  if (options.room !== undefined) query.set("room", options.room);
  return `ws://127.0.0.1:${options.port}/ws?${query}`;
}

const clock = {
  now: () => performance.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
};
// A small margin keeps timer rounding / delivery jitter off the relay's one-second boundary.
const paceWindow = 1020;
export function nextDelay(at, speed, start, now, sent) {
  const due = start + at * 1000 / speed;
  const paced = sent.length >= 4 ? sent.at(-4) + paceWindow : -Infinity;
  return Math.max(0, Math.ceil(Math.max(due, paced) - now));
}

/** One absolute timeline, one shared rolling budget, and at most one pending timer.
 * Recalculate after every wake: a late callback must never release a catch-up flood. */
export function schedulePlayback(events, speed, send, { time = clock, log = console.log, onDone = () => {}, onError = () => {}, shouldSend = () => true } = {}) {
  if (!Number.isFinite(speed) || speed <= 0) throw new Error("--speed must be finite and positive.");
  const start = time.now(), sent = [], continuation = [];
  let index = 0, timer = null, cancelled = false, reported = false, done = false;
  const cancel = () => { cancelled = true; continuation.length = 0; if (timer !== null) time.clearTimeout(timer); timer = null; };
  // Answers can arrive during playback or after its last timer. Wake the same budget immediately.
  cancel.enqueue = (messages) => {
    if (cancelled) return;
    continuation.push(...messages);
    if (timer !== null) time.clearTimeout(timer);
    timer = time.setTimeout(step, 0);
  };
  function step() {
    timer = null;
    if (cancelled) return;
    try {
      while (index < events.length && !shouldSend(events[index].message)) index++;
      const replying = continuation.length > 0;
      if (!replying && index === events.length) {
        if (!done) { done = true; onDone(); }
        return;
      }
      // Continuations are due now, ahead of prepared events, with no extra delay.
      const event = replying ? { at: 0, message: continuation[0] } : events[index], now = time.now();
      const delay = nextDelay(event.at, speed, start, now, sent);
      if (!reported && sent.length >= 4 && sent.at(-4) + paceWindow > Math.max(now, start + event.at * 1000 / speed)) {
        reported = true;
        log("Relay pacing stretches playback to keep jobs and holds within four messages per second.");
      }
      if (delay > 0) {
        // Node clamps larger waits to 1 ms; split very slow playback into safe waits instead.
        timer = time.setTimeout(step, Math.min(delay, 2 ** 31 - 1));
        return;
      }
      send(event.message);
      sent.push(time.now());
      if (sent.length > 4) sent.shift();
      const m = event.message;
      log(`${replying ? "reply" : `${event.at.toFixed(1).padStart(5)} s`}  [simulated] ${m.type === "job" ? `${m.status} ${m.id}: ${m.title}${m.result ? ` — ${m.result}` : ""}` : `hold: ${m.text}`}`);
      if (replying) continuation.shift();
      else index++;
      timer = time.setTimeout(step, 0);
    } catch (error) { cancel(); onError(error); }
  }
  timer = time.setTimeout(step, 0);
  return cancel;
}

/** The CLI and checks use the same socket lifecycle; injection only supplies time and output. */
export function startFeed(events, options, { WebSocketImpl = globalThis.WebSocket, time = clock, log = console.log, error = console.error } = {}) {
  validateFixture(events);
  const url = connectionURL(options);
  if (typeof WebSocketImpl !== "function") throw new Error("This script needs Node's built-in WebSocket support.");
  const ws = new WebSocketImpl(url);
  const card = events.find(({ message: m }) => m.type === "job" && m.id === "demo-card" && m.status === "waiting")?.message;
  const birthday = events.find(({ message: m }) => m.type === "job" && m.id === "demo-birthday")?.message;
  let cardWaiting = false, answered = false;
  let cancelPlayback = () => {}, connectTimer = null, closeTimer = null, stopping = null, finished = false;
  let resolveClosed;
  const closed = new Promise((resolve) => { resolveClosed = resolve; });
  const clearTimers = () => {
    cancelPlayback();
    if (connectTimer !== null) time.clearTimeout(connectTimer);
    if (closeTimer !== null) time.clearTimeout(closeTimer);
    connectTimer = closeTimer = null;
  };
  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimers();
    ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
    resolveClosed(stopping ?? 1);
  };
  function shutdown(code, message) {
    if (stopping !== null || finished) return;
    stopping = code;
    clearTimers();
    if (message) (code ? error : log)(message);
    if (ws.readyState === 3) { finish(); return; }
    // Bound shutdown even if a peer never acknowledges the close handshake.
    closeTimer = time.setTimeout(finish, 1000);
    try { ws.close(); } catch { finish(); }
  }
  connectTimer = time.setTimeout(() => shutdown(1, `Connection timed out on port ${options.port}.`), 10000);
  ws.onopen = () => {
    if (stopping !== null) return;
    time.clearTimeout(connectTimer); connectTimer = null;
    log(`Connected as agent (AI) on port ${options.port}. Playing simulated helper work at speed ${options.speed}.`);
    cancelPlayback = schedulePlayback(events, options.speed, (message) => {
      ws.send(JSON.stringify(message));
      if (message === card) cardWaiting = true;
    }, {
      time, log,
      shouldSend: (m) => !answered || !(
        (m.type === "hold" && m.text === card.result) ||
        (m.type === "job" && m.id === birthday.id && m.status === "waiting")
      ),
      onDone: () => log("Simulated feed complete. Listening for answers; press Ctrl+C to close."),
      onError: (e) => shutdown(1, `Could not send simulated work: ${e.message}`),
    });
  };
  ws.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      if (message?.type === "answer") {
        log(`Answer from ${message.by}: ${message.text}`);
        const choice = typeof message.text === "string" ? message.text.trim().toLowerCase() : "";
        const result = choice === "keep it a surprise" || choice === "keep it a surprise, thanks"
          ? "Keeps the class a surprise"
          : choice === "mention the pottery class in mom's card" ? "Mentions the pottery class" : null;
        if (cardWaiting && !answered && birthday && result && stopping === null && !finished) {
          answered = true;
          cardWaiting = false;
          cancelPlayback.enqueue([
            { ...card, status: "done", result },
            { ...birthday, status: "done", result: "Class found · card ready" },
            { type: "hold", text: "" },
          ]);
        }
      }
      if (message?.type === "notice") error(`Notice: ${message.message}`);
    } catch { error("Received an unreadable message from the core."); }
  };
  // Before it opens, an error means no connection; after, the close that follows says what happened.
  ws.onerror = () => { if (connectTimer !== null) shutdown(1, `Connection failed on port ${options.port}. Check the core and room code.`); };
  ws.onclose = (event) => {
    if (stopping === null) shutdown(1, `Unexpected disconnect on port ${options.port} (code ${event.code}${event.reason ? `: ${event.reason}` : ""}).`);
    finish();
  };
  return { closed, stop: () => shutdown(0, "Closing simulated feed.") };
}

export async function main(args = process.argv.slice(2)) {
  let feed;
  const stop = () => feed?.stop();
  try {
    const options = parseArgs(args);
    if (options.help) { console.log(usage); return 0; }
    const events = validateFixture(JSON.parse(readFileSync(new URL("../samples/demo-jobs.json", import.meta.url), "utf8")));
    feed = startFeed(events, options);
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    return await feed.closed;
  } catch (error) { console.error(error.message); return 1; }
  finally { process.off("SIGINT", stop); process.off("SIGTERM", stop); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Also bounds a close handshake with an unresponsive peer; all our timers are cleared first.
  process.exit(await main());
}
