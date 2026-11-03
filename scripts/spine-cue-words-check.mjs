// Populated playground arrivals: words and controls stay readable beside Shelf on a phone.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openPage, ready, sleep, standInCore } from "./headless.mjs";

const why = ready();
if (why) { console.log(`SKIP spine-cue-words-check: ${why}`); process.exit(3); }
const shots = process.env.SHOTS;
if (shots) mkdirSync(shots, { recursive: true });
const core = await standInCore(() => []);
try {
  for (const [width, height] of [[1440, 900], [390, 844]]) for (const theme of ["light", "dark"]) {
    const scene = await openPage(`http://127.0.0.1:${core.port}/bricks.html?brick=spine&sample=student-week`, { width, height });
    try {
      await scene.page("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 600 });
      await scene.page("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }, { name: "prefers-reduced-motion", value: "no-preference" }] });
      assert.ok(await scene.until(`!!document.querySelector(".spine-ready")`, 8000), "Spine becomes ready");
      await sleep(500);
      await scene.evaluate(`document.querySelector('.spine-point [aria-label="Keep on the shelf"]').click()`);
      assert.ok(await scene.until(`document.querySelector(".spine-shelf-count")?.textContent === "1"`), "Shelf populated through its control");
      const from = await scene.evaluate(`(() => { const f = document.querySelector(".spine-frame").getBoundingClientRect();
        for (let y = f.top + 80; y < f.bottom - 80; y += 16) for (let x = f.right - 20; x > f.left + 20; x -= 16)
          if (document.elementFromPoint(x, y)?.classList.contains("react-flow__pane")) return { x, y }; })()`);
      assert.ok(from, "empty canvas for pan");
      await scene.page("Input.dispatchMouseEvent", { type: "mouseMoved", x: from.x, y: from.y });
      for (let i = 0; i <= 12; i++) {
        await scene.page("Input.dispatchMouseEvent", { type: i === 0 ? "mousePressed" : "mouseMoved", x: from.x - i * 100, y: from.y, button: "left", buttons: 1, clickCount: 1 });
        await sleep(20);
      }
      await scene.page("Input.dispatchMouseEvent", { type: "mouseReleased", x: from.x - 1200, y: from.y, button: "left", buttons: 0, clickCount: 1 });
      assert.ok(await scene.until(`document.querySelector(".spine-follow")?.getAttribute("aria-pressed") === "false"`), "pan holds camera");
      await sleep(300);
      const held = await scene.evaluate(`document.querySelector(".react-flow__viewport").style.transform`);
      const labels = await scene.evaluate(`[...document.querySelectorAll('.spine-head [aria-label^="Open "]')].map((b) => b.getAttribute("aria-label"))`);
      assert.equal(labels.length, 4, "four distinct arrival threads");
      for (const label of labels) {
        await scene.evaluate(`document.querySelector('[aria-label=' + ${JSON.stringify(JSON.stringify(label))} + ']').click()`);
        assert.ok(await scene.until(`document.querySelector(".playground-map").textContent.includes(${JSON.stringify(`· on ${label.slice(5, -11)}`)})`), "arrival thread becomes active");
        await scene.evaluate(`[...document.querySelectorAll(".playground-bar button")].find((b) => b.textContent === "The Friend says one").click()`);
        assert.ok(await scene.until(`!!document.querySelector(".spine-cue")`), "real arrival creates a cue");
        await sleep(1350);
      }
      let closed;
      for (const open of [false, true]) {
        if (open) {
          await scene.evaluate(`document.querySelector(".spine-shelf-head").click()`);
          assert.ok(await scene.until(`!!document.querySelector(".spine-shelf-list")`), "populated Shelf opens beside arrivals");
        }
        const geometry = await scene.evaluate(`(() => {
          const box = (e) => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
          return { width: innerWidth, height: innerHeight, dark: matchMedia("(prefers-color-scheme: dark)").matches,
            overflow: document.documentElement.scrollWidth > innerWidth, held: document.querySelector(".react-flow__viewport").style.transform,
            shelf: box(document.querySelector(".spine-shelf-head")),
            list: document.querySelector(".spine-shelf-list") && box(document.querySelector(".spine-shelf-list")),
            chips: [...document.querySelectorAll(".spine-cue")].map((b) => {
              const prefix = b.querySelector(".spine-cue-new"), title = b.querySelector(".spine-cue-title"), count = b.querySelector(".spine-cue-count");
              const arrow = b.querySelector(".spine-cue-way"), dot = b.querySelector(".spine-cue-dot");
              return { box: box(b), name: b.getAttribute("aria-label"), text: b.textContent,
                prefix: prefix && { text: prefix.textContent, box: box(prefix), color: getComputedStyle(prefix).color },
                muted: getComputedStyle(arrow).color, title: title && { text: title.textContent, box: box(title), ellipsis: getComputedStyle(title).textOverflow },
                count: count && { text: count.textContent, box: box(count), fits: count.scrollWidth <= count.clientWidth },
                arrow: box(arrow), rotation: arrow.style.rotate, dot: box(dot) };
            }) };
        })()`);
        assert.equal(geometry.width, width, "actual device width");
        assert.equal(geometry.height, height, "actual device height");
        assert.equal(geometry.dark, theme === "dark", "theme");
        assert.equal(geometry.held, held, "arrivals leave held camera in place");
        assert.ok(!geometry.overflow, "no sideways page overflow");
        const separate = (a, b) => a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;
        const inside = (a, b) => a.width > 0 && a.height > 0 && a.left >= b.left - 0.5 && a.right <= b.right + 0.5 && a.top >= b.top - 0.5 && a.bottom <= b.bottom + 0.5;
        const individuals = geometry.chips.filter((c) => c.title);
        assert.ok(individuals.length >= 2, "multiple individual arrivals remain readable");
        assert.deepEqual(individuals.map((c) => c.title.text), labels.slice(-individuals.length).reverse().map((l) => l.slice(5, -11)), "newest arrivals first");
        for (const c of geometry.chips) {
          assert.ok(inside(c.box, { left: 0, top: 0, right: width, bottom: height }), "chip within viewport");
          assert.ok(inside(c.dot, c.box) && c.dot.width === 8, "thread dot visible");
          assert.ok(inside(c.arrow, c.box) && c.rotation, "direction arrow visible and aimed");
          for (const other of geometry.chips) if (c !== other) assert.ok(separate(c.box, other.box), "chip hit areas do not overlap");
          if (width < 600) {
            assert.ok(separate(c.box, geometry.shelf), "chips do not overlap Shelf");
            if (geometry.list) assert.ok(separate(c.box, geometry.list), "open Shelf list does not overlap chips");
          }
          if (c.title) {
            assert.equal(c.prefix?.text, "New · ", "individual prefix at both widths");
            assert.equal(c.prefix.color, c.muted, "prefix uses muted color");
            assert.ok(inside(c.prefix.box, c.box), "prefix remains visible outside title ellipsis");
            assert.ok(inside(c.title.box, c.box) && c.title.box.width >= 12, `nonzero readable title space: ${JSON.stringify(c)}`);
            assert.equal(c.title.ellipsis, "ellipsis", "only title truncates");
          } else {
            assert.match(c.count?.text ?? "", /^\+\d+$/, "overflow displays +N");
            assert.ok(c.count.fits && inside(c.count.box, c.box), "overflow count fully visible");
            assert.ok(c.name.startsWith(`${c.count.text.slice(1)} more new`), "overflow accessible count matches");
          }
        }
        if (width < 600) {
          assert.equal(geometry.chips.length, 3, "two individual phone chips and one aggregate");
          assert.equal(geometry.chips.find((c) => c.count)?.count.text, "+2", "phone overflow counts both hidden arrivals");
          if (open) {
            assert.ok(inside(geometry.list, { left: 0, top: 0, right: width, bottom: height }), "open Shelf list inside phone viewport");
            assert.deepEqual(geometry.chips.map((c) => c.box), closed.chips.map((c) => c.box), "opening Shelf preserves phone cue space");
            assert.deepEqual(geometry.shelf, closed.shelf, "opening Shelf preserves button position");
          }
        } else assert.ok(geometry.chips[0].text.endsWith("N"), "newest desktop cue keeps N shortcut");
        if (!open) closed = geometry;
      }
      assert.equal(await scene.evaluate(`document.querySelector(".playground").dataset.errors`), "0", "no playground errors");
      if (shots) {
        const shot = await scene.page("Page.captureScreenshot", { format: "png" });
        writeFileSync(join(shots, `spine-cue-words-${width}-${theme}.png`), Buffer.from(shot.data, "base64"));
      }
      // Exercise both a direct arrival and, when present, overflow navigation.
      for (const aggregate of [true, false]) {
        const target = await scene.evaluate(`(() => {
          const button = [...document.querySelectorAll(".spine-cue")].find((b) => !!b.querySelector(".spine-cue-count") === ${aggregate});
          if (!button) return null;
          const title = button.querySelector(".spine-cue-title")?.textContent ?? ${JSON.stringify(labels[0].slice(5, -11))};
          const head = [...document.querySelectorAll(".spine-head")].find((n) => n.querySelector(".spine-title")?.textContent === title);
          const node = [...document.querySelectorAll(".spine-point")].filter((n) => n.dataset.thread === head?.dataset.thread).at(-1)?.closest(".react-flow__node");
          return { name: button.getAttribute("aria-label"), node: node?.dataset.id, view: document.querySelector(".react-flow__viewport").style.transform };
        })()`);
        if (!target) { assert.ok(!aggregate || width >= 600, "phone aggregate available to navigate"); continue; }
        await scene.evaluate(`[...document.querySelectorAll(".spine-cue")].find((b) => b.getAttribute("aria-label") === ${JSON.stringify(target.name)}).click()`);
        assert.ok(await scene.until(`document.querySelector(".react-flow__viewport").style.transform !== ${JSON.stringify(target.view)}`), "click navigates");
        assert.ok(await scene.until(`![...document.querySelectorAll(".spine-cue")].some((b) => b.getAttribute("aria-label") === ${JSON.stringify(target.name)})`), "reached arrival removes its chip");
        await sleep(500);
        assert.ok(await scene.evaluate(`(() => {
          const f = document.querySelector(".spine-frame").getBoundingClientRect();
          const n = [...document.querySelectorAll(".react-flow__node")].find((n) => n.dataset.id === ${JSON.stringify(target.node)});
          const r = n?.getBoundingClientRect();
          return r && r.left + r.width / 2 > f.left && r.left + r.width / 2 < f.right && r.top + Math.min(r.height, 44) / 2 > f.top && r.top + Math.min(r.height, 44) / 2 < f.bottom;
        })()`), "navigation reaches an actual arrival");
      }
    } finally { await scene.close(); }
  }
} finally { core.close(); }
console.log("spine-cue-words-check: ok");
