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
    // Availability is a fixture expectation, independent of whether placement returned any chips.
    const check = (cues, area, avoid = [], legalSlot = [area.x0, area.y0, area.x1, area.y1].every(Number.isFinite)
      && Number.isFinite(area.x1 - area.x0) && Number.isFinite(area.y1 - area.y0) && area.x1 > area.x0 && area.y1 > area.y0) => {
      const result = placeCues(cues, area, avoid);
      for (let i = 0; i < 5; i++) assert.deepEqual(placeCues(cues, area, avoid), result, "deterministic placement");
      const { chips, hidden } = result;
      const direct = chips.filter((p) => !p.extra);
      const accounted = [...direct.map((p) => p.cue), ...hidden];
      assert.deepEqual(accounted.map((c) => c.key).sort(), cues.map((c) => c.key).sort(), "every arrival direct or hidden exactly once");
      for (const cue of accounted) assert.ok(cues.includes(cue), "only actual arrivals are represented");
      const aggregates = chips.filter((p) => p.extra);
      assert.equal(aggregates.length, hidden.length && legalSlot ? 1 : 0, "a legal slot represents every hidden arrival with one aggregate");
      if (aggregates.length) {
        assert.equal(aggregates[0].extra, hidden.length, "aggregate counts all hidden arrivals, including displaced chips");
        assert.ok(hidden.includes(aggregates[0].cue), "aggregate targets a hidden arrival");
      }
      if (!legalSlot) assert.deepEqual(chips, [], "no illegal fallback when no slot exists");
      assert.deepEqual(direct.map((p) => p.cue.at), direct.map((p) => p.cue.at).sort((a, b) => b - a));
      for (const p of chips) {
        assert.ok([p.x, p.y, p.width, p.height].every(Number.isFinite));
        assert.ok(p.x >= area.x0 && p.y >= area.y0 && p.x + p.width <= area.x1 + 1e-8 && p.y + p.height <= area.y1 + 1e-8, JSON.stringify(p));
        for (const q of chips) if (p !== q) assert.ok(p.x + p.width <= q.x || q.x + q.width <= p.x || p.y + p.height <= q.y || q.y + q.height <= p.y, "hit areas overlap");
        for (const o of avoid) assert.ok(p.x + p.width <= o.x0 || o.x1 <= p.x || p.y + p.height <= o.y0 || o.y1 <= p.y, `a chip sits under what floats over the area: ${JSON.stringify([p, o])}`);
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
    // Mixed directions exceed the four direct chips. Cover each edge in turn, then two adjacent edges;
    // the uncovered edges still have legal slots, so overflow must remain represented there.
    const crowdedArea = { x0: 0, y0: 0, x1: 1000, y1: 400 };
    const crowded = Array.from({ length: 17 }, (_, i) => {
      const [cx, cy] = [[-10000, 200], [10000, 200], [500, -10000], [500, 10000]][i % 4];
      return { key: `mixed-${i}`, thread: `t${i}`, title: "Mixed arrival", at: i, cx, cy };
    });
    const edges = [
      { x0: 0, y0: 0, x1: 260, y1: 400 }, { x0: 740, y0: 0, x1: 1000, y1: 400 },
      { x0: 0, y0: 0, x1: 1000, y1: 60 }, { x0: 0, y0: 340, x1: 1000, y1: 400 },
    ];
    for (const blocked of [[], ...edges.map((edge) => [edge]), [edges[0], edges[2]], [edges[1], edges[3]]]) {
      check(crowded, crowdedArea, blocked, true);
    }
    // A left aggregate displaces the top chip, then retargets to that chip's freed top slot. With
    // fixed arrivals, area and controls, that original slot remains legal and no surviving chip
    // overlaps it: the retry can reuse it without another displacement. Cover all four ranks.
    const short = { x0: 0, y0: 0, x1: 1440, y1: 80 };
    for (let rank = 0; rank < 4; rank++) {
      const points = [[-57680, -2360], [10000, 40], [720, -10000], [-28480, 2440]];
      const order = [1, 2, 3];
      order.splice(rank, 0, 0);
      const direct = order.map((point, i) => ({ key: `direct-${point}`, thread: `t${point}`, title: "Direct arrival", at: 4 - i,
        cx: points[point][0], cy: points[point][1] }));
      const before = check(direct, short);
      assert.equal(before.chips.length, 4, "all four direct chips occupied before displacement");
      assert.equal(before.hidden.length, 0);
      assert.equal(before.chips[rank].cue.key, "direct-0", "victim occupies the intended direct position");
      for (const n of [1, 3, 9]) {
        const arrivals = [...direct, ...Array.from({ length: n }, (_, i) => ({ key: `overflow-${i}`, thread: `o${i}`, title: "Overflow arrival",
          at: -i, cx: -10000, cy: 40 }))];
        const after = check(arrivals, short);
        assert.deepEqual(after.chips.filter((p) => !p.extra).map((p) => p.cue.key), direct.filter((c) => c.key !== "direct-0").map((c) => c.key));
        const aggregate = after.chips.find((p) => p.extra);
        assert.equal(aggregate.cue.key, "direct-0", "displacement retargets to the newer hidden arrival");
        assert.equal(aggregate.edge, "top", "retargeting moves the aggregate from left to top");
        assert.equal(aggregate.extra, n + 1, "displaced arrival joins every original hidden arrival");
        const victim = before.chips[rank];
        for (const field of ["edge", "x", "y", "width", "height"]) {
          assert.equal(aggregate[field], victim[field], `the retry reuses the displaced arrival's freed slot: ${field}`);
        }
        assert.deepEqual(after.chips.filter((p) => !p.extra), before.chips.filter((p) => p !== victim),
          "retargeting preserves every other direct chip and its slot");
      }
    }
    // No legal slot: neither a full cover nor four edge controls may cause a fallback under controls.
    for (const blocked of [[crowdedArea], edges]) check(crowded, crowdedArea, blocked, false);
    for (const area of [
      { x0: 0, y0: 0, x1: 0, y1: 400 }, { x0: 0, y0: 0, x1: 1000, y1: 0 },
      { x0: 1000, y0: 400, x1: 0, y1: 0 },
      ...[NaN, Infinity, -Infinity].flatMap((value) => [
        { x0: value, y0: 0, x1: 1000, y1: 400 }, { x0: 0, y0: value, x1: 1000, y1: 400 },
        { x0: 0, y0: 0, x1: value, y1: 400 }, { x0: 0, y0: 0, x1: 1000, y1: value },
      ]),
    ]) check(crowded, area, [], false);
    // What floats over the area (the corners' controls, a pill under them): arrivals toward the corner never get a slot under
    // it, so no chip can be covered; the next slot along the edge takes each.
    const wide = { x0: 0, y0: 0, x1: 1440, y1: 800 };
    const floating = [{ x0: 1160, y0: 0, x1: 1440, y1: 60 }, { x0: 1370, y0: 70, x1: 1440, y1: 110 }, { x0: 0, y0: 0, x1: 180, y1: 60 }];
    for (const [cx, cy] of [[10000, -10000], [10000, 0], [0, -10000], [-10000, -10000], [3000, -3000]]) {
      for (const n of [1, 2, 4, 6]) {
        const cues = Array.from({ length: n }, (_, i) => ({ key: `f${i}`, thread: "t", title: "title", at: i, cx: cx + i, cy: cy + i }));
        const result = check(cues, wide, floating);
        assert.ok(result.chips.length >= Math.min(n, 2), `the arrivals toward (${cx}, ${cy}) still get chips`);
      }
    }
    // An edge the page covers all along (a panel down the right side): its arrivals take the nearest slot on another edge.
    const panel = check(Array.from({ length: 3 }, (_, i) => ({ key: `p${i}`, thread: "t", title: "title", at: i, cx: 10000, cy: 100 * i })), wide, [{ x0: 1100, y0: 0, x1: 1440, y1: 800 }]);
    assert.ok(panel.chips.length === 3 && panel.chips.every((p) => p.edge !== "right"), "a covered edge gives its arrivals another edge");
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
