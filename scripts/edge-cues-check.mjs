// Run synchronous placement fixtures in a killable child: a collision loop must fail, not hang the check.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { uiServer } from "./ui-server.mjs";

if (!process.argv.includes("--fixtures")) {
  const child = spawn(process.execPath, [new URL(import.meta.url).pathname, "--fixtures"], { stdio: "inherit" });
  const timeout = setTimeout(() => { child.kill("SIGKILL"); console.error("edge-cues-check: placement timed out"); }, 15000);
  const code = await new Promise((resolve) => child.once("exit", (code) => resolve(code ?? 1)));
  clearTimeout(timeout);
  assert.equal(code, 0, "placement fixtures failed or timed out");
  console.log("edge-cues-check: ok");
} else {
  const server = await uiServer();
  try {
    const { placeCues } = await server.ssrLoadModule("/src/bricks/spine/cues.tsx");
    const check = (cues, area) => {
      const result = placeCues(cues, area);
      for (let i = 0; i < 5; i++) assert.deepEqual(placeCues(cues, area), result, "deterministic placement");
      const { chips, hidden } = result;
      const direct = chips.filter((p) => !p.extra);
      assert.equal(direct.length + hidden.length, cues.length, "every arrival accounted for");
      assert.equal(new Set([...direct.map((p) => p.cue.key), ...hidden.map((c) => c.key)]).size, cues.length);
      assert.equal(chips.filter((p) => p.extra).length, hidden.length && chips.length ? 1 : 0);
      assert.equal(chips.find((p) => p.extra)?.extra ?? 0, chips.length ? hidden.length : 0);
      assert.deepEqual(direct.map((p) => p.cue.at), direct.map((p) => p.cue.at).sort((a, b) => b - a));
      for (const p of chips) {
        assert.ok([p.x, p.y, p.width, p.height].every(Number.isFinite));
        assert.ok(p.x >= area.x0 && p.y >= area.y0 && p.x + p.width <= area.x1 + 1e-8 && p.y + p.height <= area.y1 + 1e-8, JSON.stringify(p));
        for (const q of chips) if (p !== q) assert.ok(p.x + p.width <= q.x || q.x + q.width <= p.x || p.y + p.height <= q.y || q.y + q.height <= p.y, "hit areas overlap");
      }
      return result;
    };
    for (const area of [{ x0: 20, y0: 40, x1: 1400, y1: 800 }, { x0: 10, y0: 20, x1: 510, y1: 100 },
      { x0: 0, y0: 0, x1: 240, y1: 34 }, { x0: 7, y0: 9, x1: 8, y1: 10 },
      { x0: 7, y0: 9, x1: 7, y1: 9 }, { x0: 10, y0: 10, x1: 0, y1: 0 }]) {
      const mx = (area.x0 + area.x1) / 2, my = (area.y0 + area.y1) / 2;
      for (const [dx, dy] of [[-10000, 0], [10000, 0], [0, -10000], [0, 10000]]) {
        for (const n of [2, 3, 4, 5, 12]) for (const offset of [-1, 0, 1]) {
          const cues = Array.from({ length: n }, (_, i) => ({ key: `c${i}`, thread: "thread", title: "Long title ".repeat(100), at: i,
            cx: mx + dx + (dy ? offset : 0), cy: my + dy + (dx ? offset : 0) }));
          const result = check(cues, area);
          if (area.x1 === 1400) {
            const edge = dx ? (dx < 0 ? "left" : "right") : dy < 0 ? "top" : "bottom";
            assert.ok(result.chips.every((p) => p.edge === edge), "arrival direction preserved");
            assert.equal(result.chips.length, Math.min(n, 5), "use available slots before overflowing");
            assert.equal(result.hidden.length, Math.max(0, n - 4));
            assert.equal(result.chips[0].cue.key, `c${n - 1}`, "newest gets the first chip");
          }
          const tied = cues.map((c, i) => ({ ...c, at: 1,
            cx: mx + dx + (dy ? (i % 2 ? -1 : 1) : 0),
            cy: my + dy + (dx ? (i % 2 ? -1 : 1) : 0) }));
          const straddled = check(tied, area);
          assert.deepEqual(straddled.chips.filter((p) => !p.extra).map((p) => p.cue.key),
            tied.filter((c) => !straddled.hidden.includes(c)).map((c) => c.key), "equal timestamps keep arrival order");
        }
      }
    }
    check(Array.from({ length: 20 }, (_, i) => ({ key: `${i}`, thread: "t", title: "title", at: i, cx: i % 2 ? -10000 : 10000, cy: i % 3 ? -10000 : 10000 })), { x0: 0, y0: 0, x1: 500, y1: 150 });
    // A top aggregate must displace the newer right chip in this short area.
    // Its target then becomes that newer arrival, so its slot must move right too.
    const mixed = check([
      { key: "new-right", thread: "r", title: "Right", at: 2, cx: 10000, cy: 40 },
      { key: "old-top", thread: "t", title: "Top", at: 1, cx: 250, cy: -10000 },
    ], { x0: 0, y0: 0, x1: 500, y1: 80 });
    assert.equal(mixed.hidden.length, 2, "aggregate accounts for displaced chip");
    assert.equal(mixed.chips.length, 1);
    assert.equal(mixed.chips[0].cue.key, "new-right", "aggregate reaches newest hidden arrival");
    assert.equal(mixed.chips[0].edge, "right", "aggregate slot agrees with its target");
    for (const horizontal of [-1, 1]) for (const vertical of [-1, 1]) {
      const displaced = check([
        { key: "new-side", thread: "s", title: "Side", at: 2, cx: 250 + horizontal * 10000, cy: 40 },
        { key: "old-end", thread: "e", title: "End", at: 1, cx: 250, cy: 40 + vertical * 10000 },
      ], { x0: 0, y0: 0, x1: 500, y1: 80 });
      assert.equal(displaced.chips[0].cue.key, "new-side");
      assert.equal(displaced.chips[0].edge, horizontal < 0 ? "left" : "right");
    }
    for (const value of [NaN, Infinity, -Infinity]) {
      check([{ key: "collapsed", thread: "t", title: "", at: 0, cx: 0, cy: 0 }], { x0: 0, y0: 0, x1: value, y1: 100 });
    }
    check([{ key: "bad", thread: "t", title: "", at: 0, cx: NaN, cy: Infinity }], { x0: 0, y0: 0, x1: 100, y1: 100 });
  } finally { await server.close(); }
}
