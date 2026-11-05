// Run after `cd core && cargo build`: real core, no key, no Mail.app, isolated temporary maps and free ports.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("../", import.meta.url).pathname;
const scratch = mkdtempSync(join(tmpdir(), "e2a2o-email-"));
const turn = "Email Recipient that the cut is ready";
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(test, ms = 15_000) {
  const start = Date.now();
  while (Date.now() - start < ms) { if (await test()) return; await pause(30); }
  throw new Error("email dry run timed out");
}
async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  assert.ok(![4360, 4399].includes(port));
  return port;
}

// Retain synthetic scratch maps for inspection; do not delete files.
{
  for (const mode of ["full", "unset", "hosted"]) {
    const dir = join(scratch, mode); mkdirSync(dir);
    const port = await freePort();
    const env = { ...process.env, PORT: String(port), MODEL_API_KEY: "", E2A2O_DATA: dir, E2A2O_UI: join(root, "ui/dist"),
      EMAIL_TO: "Recipient=recipient@example.com", EMAIL_SEND: "off", MESSAGES_SEND: "off", NOTES_WRITE: "off", PICTURES: "off",
      E2A2O_TRACE: "1", E2A2O_HOSTED: mode === "hosted" ? "1" : "0" };
    delete env.ROOM_CODE; delete env.ROOM_HTTPS; delete env.TUNNEL_ORIGIN;
    if (mode === "unset") delete env.PRESET; else env.PRESET = "full";
    const child = spawn(join(root, "core/target/debug/e2a2o-core"), [], { cwd: dir, env, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (data) => { stderr += data; });
    let ws;
    try {
      await until(async () => {
        if (child.exitCode !== null) throw new Error(`core exited: ${stderr.slice(-500)}`);
        try { return (await fetch(`http://127.0.0.1:${port}/room`)).ok; } catch { return false; }
      });
      const door = await (await fetch(`http://127.0.0.1:${port}/room`)).json();
      assert.equal(door.email, mode === "full");
      const messages = [];
      ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      ws.addEventListener("message", (event) => messages.push(JSON.parse(event.data)));
      await once(ws, "open");
      await until(() => messages.some((m) => m.type === "snapshot"));
      const send = (message) => ws.send(JSON.stringify(message));
      send({ type: "text", text: turn });
      if (mode === "full") {
        await until(() => messages.some((m) => m.type === "send_card"));
        const card = messages.find((m) => m.type === "send_card");
        assert.equal(card.channel, "email");
        assert.equal(card.to, "Recipient"); assert.equal(card.subject, "the cut is ready");
        assert.equal(card.text, "Hi Recipient, the cut is ready."); assert.equal(card.live, false);
        await until(() => messages.some((m) => m.type === "send_card" && m.state === "dry_run"));
        assert.ok(messages.some((m) => m.message?.includes("EMAIL_SEND=on")));
        send({ type: "text", text: turn });
        await until(() => messages.some((m) => m.type === "send_card" && m.id === 2));
        send({ type: "text", text: "Stop" });
        await until(() => messages.some((m) => m.type === "send_card" && m.id === 2 && m.state === "stopped"));
        send({ type: "email", on: false }); send({ type: "text", text: turn });
        await until(() => readFileSync(join(dir, "journal.jsonl"), "utf8").includes(turn));
        const trace = readFileSync(join(dir, "trace.jsonl"), "utf8");
        assert.ok(trace.includes('"event":"card"') && trace.includes('"event":"dry_run"'));
        assert.ok(!trace.includes("recipient@example.com"));
      } else {
        await until(() => readFileSync(join(dir, "journal.jsonl"), "utf8").includes(turn));
        assert.ok(!messages.some((m) => m.type === "send_card"), `${mode} stays talk`);
      }
      assert.ok(!JSON.stringify(messages).includes("recipient@example.com"), "address stays in core");
      console.log(`email-dry-run: ${mode} on ${port}: ${mode === "full" ? "card → dry run; typed Stop; Features off → talk" : "words stay talk"}`);
    } finally {
      ws?.close();
      if (child.exitCode === null) {
        const exited = once(child, "exit");
        child.kill("SIGTERM");
        await exited;
      }
    }
  }
}
