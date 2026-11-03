// Browser-free pagination rules, using the same module loader as guide-check.mjs.
import assert from "node:assert/strict";
import { uiServer } from "./ui-server.mjs";

const server = await uiServer();
try {
  const { pages } = await server.ssrLoadModule("/src/guide-core.ts");
  const visible = (text) => text.replace(/\*\*|\*|`/g, "");
  const wordsOf = (text) => visible(text).split(/\s+/).filter(Boolean);
  const ten = (text) => text.length * 10;

  // An independent layout oracle: take the longest prefix that fits in each row's available space.
  // The supplied name occupancy belongs to row one, even when it leaves no room for caption text.
  // An indivisible overwide word gets a row of its own, as in the existing pagination contract.
  function rowsOf(text, width, measure, first) {
    const remaining = wordsOf(text), rows = [];
    let occupied = first;
    while (remaining.length) {
      let take = 0;
      for (let end = 1; end <= remaining.length; end++) {
        if (occupied + measure(remaining.slice(0, end).join(" ")) > width) break;
        take = end;
      }
      // A full name row consumes a line; an overwide word on an empty row still makes progress.
      rows.push({ occupied, words: remaining.splice(0, take || (occupied ? 0 : 1)) });
      occupied = 0;
    }
    return rows;
  }

  function check(text, width, first = 0, lines = 2, measure = ten) {
    const paged = pages(text, width, measure, first, lines);
    assert.ok(paged.length && paged.every((page) => page.trim()), "every page contains words");
    assert.deepEqual(wordsOf(paged.join(" ")), wordsOf(text), "every word, once, in order");
    for (const [i, page] of paged.entries()) {
      assert.equal((page.match(/\*\*/g) ?? []).length % 2, 0, "each page balances its bold spans");
      const rows = rowsOf(page, width, measure, i ? 0 : first);
      assert.ok(rows.every((row) => row.words.length <= 1 || row.occupied + measure(row.words.join(" ")) <= width), "only an indivisible word may overflow a row");
      const overwide = wordsOf(page).length === 1 && measure(wordsOf(page)[0]) > width;
      assert.ok(rows.length <= lines || overwide,
        `${width}px, first=${first}, limit=${lines}: ${rows.length} rows in ${JSON.stringify(page)}`);
    }
    return paged;
  }

  // Regression: "a" wraps to row two and is narrower than the name's 90px occupancy.
  // Three more words need a third row; the original counter keeps using 90 as its wrapping sentinel.
  const regression = "wide a tiny tiny tiny";
  assert.equal(rowsOf(regression, 140, ten, 90).length, 3);
  assert.deepEqual(check(regression, 140, 90), ["wide a tiny tiny", "tiny"]);

  const long = `${Array(45).fill("a tiny word").join(" ")}.`;
  for (const width of [140, 600]) {
    for (const first of [0, width / 2, width, width + 40]) {
      for (const lines of [2, 3]) {
        const paged = check(long, width, first, lines);
        assert.ok(paged.length > 1, "a long sentence spans multiple pages");
        if (first >= width) {
          assert.equal(rowsOf(paged[0], width, ten, first)[0].words.length, 0, "a name-filled first row is counted");
        }
        const bold = `Start **${Array(50).fill("bold a tiny").join(" ")}** end.`;
        const split = check(bold, width, first, lines);
        assert.ok(split[0].endsWith("**") && split[1].startsWith("**"), "a split bold span closes and reopens");
        check(`a ${"x".repeat(Math.ceil(width / 10) + 1)} tiny ${long}`, width, first, lines);
      }
    }
    assert.deepEqual(check("Short.", width), ["Short."]);
    assert.deepEqual(check("x".repeat(width / 10 + 1), width), ["x".repeat(width / 10 + 1)], "a single overwide word stays intact");
    const fullLine = Array(Math.floor((width / 10 + 1) / 5)).fill("word").join(" ");
    for (const first of [width, width + 40]) {
      assert.deepEqual(check(`${fullLine} a`, width, first), [fullLine, "a"], "the name uses row one; row two has its full width");
    }
    // Each sentence fits alone, but the pair cannot share a two-line page, even at 600px.
    const sentence = `${Array(Math.floor(width / 50) + 1).fill("word").join(" ")}.`;
    assert.deepEqual(check(`${sentence} ${sentence}`, width), [sentence, sentence], "prefer whole sentences");
  }
  assert.deepEqual(check("one two three four", 140, 0, 1), ["one two three", "four"], "honor an explicit line limit");
  assert.deepEqual(check("wide a tiny tiny", 140, 0), ["wide a tiny tiny"], "zero-indent wrapping stays ordinary");
  console.log("guide-page-indent-check: ok");
} finally {
  await server.close();
}
