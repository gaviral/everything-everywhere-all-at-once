// Runs before the standalone host normalizes its URL or lazily imports the brick.
// The ephemeral key stays in memory, outside URLs, storage and request logs.
(() => {
  const pair = new URLSearchParams(location.hash.slice(1)).get("pair");
  if (!pair) return;
  window.__phonePointerPair = pair;
  history.replaceState(null, "", location.pathname + location.search);
})();
