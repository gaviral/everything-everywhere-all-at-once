// node scripts/icon-set/export.mjs — deterministic derivatives of the committed mirrored icon.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { iconBrowser } from "./browser.mjs";
import { svgVariants, repaintPixels } from "./variants.mjs";
import { paintSheet } from "./sheet.mjs";

const root = new URL("../../", import.meta.url);
const read = path => readFileSync(new URL(path, root));
const write = (path, data) => writeFileSync(new URL(path, root), data);
const svg = svgVariants(read("ui/public/icon.svg").toString());
for (const [name, contents] of Object.entries(svg)) write(`ui/public/icons/icon-${name}.svg`, contents);
const uri = (bytes, type) => `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;
const savePng = (path, data) => write(path, Buffer.from(data.split(",")[1], "base64"));
const browser = await iconBrowser();
try {
  const raster = async (source, size, appearance) => browser.evaluate(`(async () => {
    const image = new Image(); image.src = ${JSON.stringify(source)}; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = ${size};
    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0, ${size}, ${size});
    const pixels = context.getImageData(0, 0, ${size}, ${size});
    if (${JSON.stringify(appearance)} !== null) (${repaintPixels})(pixels.data, ${JSON.stringify(appearance)});
    context.putImageData(pixels, 0, 0); return canvas.toDataURL('image/png');
  })()`);
  for (const appearance of ["dark", "tinted"]) {
    for (const size of [192, 512]) {
      savePng(`ui/public/icons/icon-${appearance}-${size}.png`, await raster(uri(read(`ui/public/icons/icon-${size}.png`), "image/png"), size, appearance));
    }
    for (const [file, source, size] of [
      [`apple-touch-icon-${appearance}.png`, "apple-touch-icon.png", 180],
      [`maskable-${appearance}-512.png`, "maskable-512.png", 512],
      [`icon-${appearance}-1024.png`, "maskable-512.png", 1024],
    ]) savePng(`ui/public/icons/${file}`, await raster(uri(read(`ui/public/icons/${source}`), "image/png"), size, appearance));
  }
  savePng("ui/public/icons/icon-default-1024.png", await raster(uri(read("ui/public/icons/maskable-512.png"), "image/png"), 1024, null));
  savePng("ui/public/icons/icon-transparent-1024.png", await raster(uri(svg.transparent, "image/svg+xml"), 1024, null));
  const images = ["icon-512.png", "icon-dark-512.png", "icon-tinted-512.png", "icon-transparent-1024.png"].map(path => uri(read(`ui/public/icons/${path}`), "image/png"));
  const sheet = await browser.evaluate(`(${paintSheet})(${JSON.stringify(images)})`);
  mkdirSync(new URL("docs/looks/", root), { recursive: true });
  savePng("docs/looks/icon-set.png", sheet);
} finally { await browser.close(); }
console.log("Exported dark, tinted, transparent icons and docs/looks/icon-set.png");
