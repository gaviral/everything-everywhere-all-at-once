// No extra dependencies: run with `node scripts/palace-check.mjs`.
// The Palace after "Palace." (ui/src/Palace.tsx, rendered with React's server renderer): each family of threads is a
// room, rooms in the order they started with each thread's branches after it, threads on their own together last; and
// the span math that lets rooms sit side by side when they fit, so a session's rooms fit one screen. Not pixels.
import assert from "node:assert/strict";
import React from "../ui/node_modules/react/index.js";
import ReactDOMServer from "../ui/node_modules/react-dom/server.node.js";
import { createServer } from "../ui/node_modules/vite/dist/node/index.js";

// room.tsx reads the page's address as it loads: this is the app opened alone.
globalThis.location = new URL("http://localhost:4321/");
const server = await createServer({ root: new URL("../ui", import.meta.url).pathname,
  server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: "custom" });
try {
  const { Palace, columnsFor } = await server.ssrLoadModule("/src/Palace.tsx");
  const thread = (id, title, parent_id = null) => ({ id, title, parent_id, status: "open", last_point: "", touched_ms: 1,
    tags: [], picture: null, dropped_by: "" });
  // A demo-like session, in the order its threads started: 7 threads, 2 rooms and 3 on their own. The README branch
  // started after the birthday's room, and still belongs with the demo.
  const threads = [thread("T1", "Hackathon demo"), thread("T2", "Mom's birthday"), thread("T3", "Cooking class", "T2"),
    thread("T4", "README", "T1"), thread("T5", "Landlord lease"), thread("T6", "Electric bill"), thread("T7", "Nothing gets lost")];
  const html = ReactDOMServer.renderToStaticMarkup(React.createElement(Palace, { threads, active: "T1", onOpen() {} }));
  // Each room as shown: its label, its span in columns, and its pictures in order.
  const rooms = html.split('<section class="palace-room"').slice(1).map((room) => ({
    room: room.match(/aria-label="([^"]+)"/)[1].replace(/&#x27;/g, "'"),
    span: Number(room.match(/--span:(\d+)/)?.[1]),
    tiles: [...room.matchAll(/data-thread="([^"]+)"/g)].map(([, id]) => id),
  }));
  assert.deepEqual(rooms, [
    { room: "Room: Hackathon demo", span: 2, tiles: ["T1", "T4"] },
    { room: "Room: Mom's birthday", span: 2, tiles: ["T2", "T3"] },
    { room: "Threads on their own", span: 3, tiles: ["T5", "T6", "T7"] },
  ]);
  assert.ok(html.includes("On their own"), "threads on their own are set apart by their own heading");

  // The columns: a 1440 px window leaves the Palace 1,116 px (1,180 at most, less 32 px each side), so 6 pictures of
  // 171 px a row; narrower windows get fewer, never under 150 px, and never none.
  assert.deepEqual(columnsFor(1116), { count: 6, width: 171 });
  assert.deepEqual(columnsFor(960), { count: 5, width: 177.6 });
  assert.equal(columnsFor(100).count, 1);
  // A room is as wide as its own pictures, never wider than the row: a family of 9 takes the 6 columns.
  const nine = [thread("R", "Big room"), ...Array.from({ length: 8 }, (_, i) => thread(`R${i}`, `Branch ${i}`, "R"))];
  assert.match(ReactDOMServer.renderToStaticMarkup(React.createElement(Palace, { threads: nine, active: null, onOpen() {} })), /--span:6[;"]/);
  // Side by side: rooms are their pictures wide, with twice the pictures' gap between rooms (palace.css), so rooms
  // share a row while their spans add up to less than the columns. The demo's two rooms share the first row; the
  // threads on their own start the second: two rows of pictures instead of three.
  const { count } = columnsFor(1116);
  assert.ok(rooms[0].span + rooms[1].span < count, "the two rooms fit side by side");
  assert.ok(rooms[0].span + rooms[1].span + rooms[2].span >= count, "the threads on their own go on the next row");
  console.log("palace-check: ok");
} finally {
  await server.close();
}
