import records from "./parts.json?raw";

export type PromptPart = { id: string; name: string; job: string; takes: string; gives: string; group: string; mark: string; prompt: string };
export const PARTS: readonly PromptPart[] = JSON.parse(records);
export const INPUT_LIMIT = 12_000;
export const partById = (id: string) => PARTS.find(part => part.id === id) ?? PARTS[0];
export const EXAMPLE_INPUT = `diff --git a/src/cache.ts b/src/cache.ts
@@ function readCached(key: string) {
-  return cache.get(key)?.value;
+  const entry = cache.get(key);
+  if (!entry) return undefined;
+  if (entry.expiresAt <= Date.now()) {
+    cache.delete(key);
+    return undefined;
+  }
+  return entry.value;
 }`;
export const EXAMPLE_ANSWERS = [
  "Cached values now expire when read.\n\nBefore: readCached returned a stored value without checking its expiry.\n\nAfter: missing or expired entries return undefined. Expired entries are removed; fresh values are returned as before.\n\nCheck the boundary: an entry expiring exactly now is treated as expired. The diff does not show how callers handle a cache miss.",
  "Summary\nPrevent readCached from returning expired values. Reads now remove entries whose expiry is at or before the current time and return undefined, preserving the cache-miss behavior.\n\nValidation\nNot provided. Suggested checks: missing entry, fresh entry, expired entry, and expiry exactly at the current time."
];
