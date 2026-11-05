import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** An isolated, silent renderer over pipes. No listening ports or existing browser profile. */
export async function iconBrowser() {
  const executable = [process.env.CHROME, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find(path => path && existsSync(path));
  if (!executable) throw new Error("Chrome is required to render the icon set");
  const profile = mkdtempSync(join(tmpdir(), "icon-set-"));
  const child = spawn(executable, ["--headless=new", "--remote-debugging-pipe", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--use-mock-keychain", "--password-store=basic", "--mute-audio", "about:blank"], { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
  let id = 0, pending = "";
  const requests = new Map(), events = new Map();
  child.stdio[4].on("data", data => {
    pending += data;
    let end;
    while ((end = pending.indexOf("\0")) >= 0) {
      const message = JSON.parse(pending.slice(0, end)); pending = pending.slice(end + 1);
      if (message.id) { requests.get(message.id)?.(message); requests.delete(message.id); }
      else events.get(message.method)?.(message.params);
    }
  });
  function command(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const current = ++id;
      requests.set(current, message => message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result));
      child.stdio[3].write(JSON.stringify({ id: current, method, params, sessionId }) + "\0");
    });
  }
  const { targetId } = await command("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await command("Target.attachToTarget", { targetId, flatten: true });
  const page = (method, params) => command(method, params, sessionId);
  await page("Page.enable");
  return { page, on: (name, listener) => events.set(name, listener), async evaluate(expression) {
    const result = await page("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  }, async close() {
    if (child.exitCode === null) { const stopped = once(child, "exit"); child.kill("SIGTERM"); await stopped; }
    // Leave this isolated rebuildable profile for the repository's cache-cleaning workflow.
  } };
}
