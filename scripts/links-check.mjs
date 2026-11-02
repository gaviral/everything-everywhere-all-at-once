// No extra dependencies: run with `node scripts/links-check.mjs`.
// A judge clicks through the README: every link inside the repo must land, a file that exists and, for `#section`, a
// heading that's there (GitHub's anchor rule). Web links need a network; scripts/release.sh checks those.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";

const root = new URL("..", import.meta.url).pathname;
// The pages a visitor reads on GitHub: the README and the Markdown it links into.
const pages = execFileSync("git", ["ls-files", "README.md", "CHANGELOG.md", "docs/*.md"], { cwd: root, encoding: "utf8" })
  .split("\n").filter(Boolean);

// GitHub's anchors: lowercase, punctuation dropped (hyphens and underscores kept), spaces to hyphens, repeats get -1, -2.
export const anchors = (markdown) => {
  const seen = new Map(), out = new Set();
  for (const [, title] of markdown.replace(/```[\s\S]*?```/g, "").matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
    const base = title.replace(/<[^>]+>/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").toLowerCase().trim()
      .replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s/g, "-");
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.add(n ? `${base}-${n}` : base);
  }
  return out;
};
assert.ok(anchors("## What you'll see\n## How it works\n## How it works").has("how-it-works-1"), "anchor rule");
assert.ok(anchors("### Did you mean, and confident auto-fix").has("did-you-mean-and-confident-auto-fix"), "anchor rule");

export const links = (markdown) => [...markdown.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "")
  .matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)|<(?:img|a|source)\b[^>]*?\b(?:src|href|srcset)="([^"]+)"/g)]
  .map((m) => m[1] ?? m[2]);

const broken = [];
for (const page of pages) {
  const text = readFileSync(join(root, page), "utf8");
  for (const link of links(text)) {
    if (/^(https?:|mailto:)/.test(link)) continue;
    const [path, hash] = link.split("#");
    const target = path ? normalize(join(dirname(page), decodeURIComponent(path))) : page;
    if (!existsSync(join(root, target))) { broken.push(`${page}: ${link} (no ${target})`); continue; }
    if (hash && target.endsWith(".md") && !anchors(readFileSync(join(root, target), "utf8")).has(hash.toLowerCase())) {
      broken.push(`${page}: ${link} (no heading "#${hash}" in ${target})`);
    }
  }
}
assert.deepEqual(broken, [], `links that land nowhere:\n  ${broken.join("\n  ")}`);
console.log(`links-check: every link inside the repo lands (${pages.length} pages)`);
