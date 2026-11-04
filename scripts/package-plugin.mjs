import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join, basename, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { buildUi as build } from "./ui-server.mjs";
const [source, option, target] = process.argv.slice(2);
if (!source || option !== "--out" || !target) throw new Error("Usage: node scripts/package-plugin.mjs <source-brick-folder> --out <prepared-folder>");
const root = resolve(new URL("..", import.meta.url).pathname);
const info = JSON.parse(await readFile(join(source, "brick.json"), "utf8"));
if (basename(resolve(target)) !== info.id) throw new Error("Prepared folder name must match the brick ID");
const bridges = { react: "React", "react-dom": "ReactDOM", "react/jsx-runtime": "jsx", "react/jsx-dev-runtime": "jsxDev" };
await build({ configFile: false, publicDir: false, root: join(root, "ui"), logLevel: "error", plugins: [{ name: "plugin-host-bridge", enforce: "pre",
  async resolveId(id, importer) {
    if (basename(resolve(source)) === "spine" && id === "../../StayHere") return "\0bridge:stay";
    if (basename(resolve(source)) === "spine" && id === "../live-outline/outline") return this.resolve(id, importer, { skipSelf: true });
    if (["motion/react", "@xyflow/react", "@xyflow/react/dist/base.css", "@xyflow/react/dist/base.css?inline"].includes(id)) return this.resolve(id, join(root, "ui/src/plugin-api.ts"), { skipSelf: true });
    if (bridges[id] || /(?:^|\/)contract(?:\.ts)?$/.test(id)) return "\0bridge:" + (bridges[id] || "contract");
    if (importer?.startsWith(resolve(source) + "/")) {
      const own = (id.startsWith(".") || id.startsWith("/")) && resolve(dirname(importer), id.split("?")[0]).startsWith(resolve(source) + "/");
      if (!own && !id.startsWith("\0")) throw new Error(`Brick import is outside its contract: ${id}`);
    }
  },
  async load(id) {
    if (!id.startsWith("\0bridge:")) return;
    const name = id.slice(8);
    const entry = ["contract", "stay"].includes(name) ? await readFile(join(root, name === "contract" ? "ui/src/bricks/contract.ts" : "ui/src/StayHere.tsx"), "utf8") : null;
    let exports;
    if (entry) exports = [...new Set([
      ...[...entry.matchAll(/export (?:const|function|class) (\w+)/g)].map(m => m[1]),
      ...[...entry.matchAll(/export\s*\{([^}]+)\}/g)].flatMap(m => m[1].split(",").map(name => name.trim().split(/\s+as\s+/).at(-1))),
    ])];
    else exports = Object.keys(await import(pathToFileURL(join(root, "ui/node_modules", Object.keys(bridges).find(k => bridges[k] === name), name === "React" || name === "ReactDOM" ? "index.js" : "" )).href).catch(() => ({})));
    // Resolve package entry through the UI toolchain for JSX runtimes.
    if (!exports?.length) exports = name === "jsxDev" ? ["Fragment", "jsxDEV"] : ["Fragment", "jsx", "jsxs"];
    return `const api = globalThis.__E2A2O_PLUGIN_V1__.${name};\nexport default api;\n` + exports.filter(k => k !== "default" && /^[A-Za-z_$][\w$]*$/.test(k)).map(k => `export const ${k} = api.${k};`).join("\n");
  }
}], build: { outDir: resolve(target), emptyOutDir: false, minify: false, lib: { entry: resolve(source, "index.tsx"), formats: ["es"], fileName: () => "index.js", cssFileName: "style" }, rollupOptions: { onwarn(warning, warn) { if (warning.code === "UNRESOLVED_IMPORT") throw new Error(warning.message); warn(warning); }, output: { codeSplitting: false } } }, esbuild: { jsx: "automatic" } });
await mkdir(target, { recursive: true });
await writeFile(join(target, "brick.json"), JSON.stringify({ ...info, defaultOn: false }, null, 2));
const css = await readFile(join(target, "style.css")).then(() => "style.css", () => undefined);
await writeFile(join(target, "plugin.json"), JSON.stringify({ apiVersion: 1, entry: "index.js", ...(css ? { css } : {}) }));
console.log(`package-plugin: prepared ${info.id}`);
