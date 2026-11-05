/** Review all appearances at home-screen and chrome sizes on a single exportable sheet. */
export async function paintSheet(images) {
  const load = src => new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = src; });
  const icons = await Promise.all(images.map(load));
  const canvas = document.createElement("canvas"); canvas.width = 1600; canvas.height = 940;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#f4f1e9"; ctx.fillRect(0, 0, 1600, 940);
  ctx.fillStyle = "#182331"; ctx.font = "600 54px system-ui"; ctx.fillText("One icon. Every appearance.", 56, 92);
  ctx.fillStyle = "#65717c"; ctx.font = "22px system-ui"; ctx.fillText("E2A2O  /  Mirrored ribbon + bead", 58, 136);
  const labels = ["Default", "Dark", "Tinted · mono", "Transparent"];
  const notes = ["Original blue + warm gold", "Subdued plate + warm gold", "Grayscale for system tinting", "Blue ribbon + gold, no plate"];
  for (let i = 0; i < 4; i++) {
    const x = 56 + i * 382, dark = i === 1;
    ctx.fillStyle = dark ? "#111c2c" : "#ffffff";
    ctx.beginPath(); ctx.roundRect(x, 186, 344, 620, 28); ctx.fill();
    ctx.fillStyle = dark ? "#f1f5fc" : "#182331"; ctx.font = "600 24px system-ui"; ctx.fillText(labels[i], x + 24, 231);
    if (i === 3) {
      for (let cy = 272; cy < 528; cy += 16) for (let cx = x + 44; cx < x + 300; cx += 16) {
        ctx.fillStyle = ((cx - x - 44) / 16 + (cy - 272) / 16) % 2 ? "#e0e5e9" : "#f4f6f8"; ctx.fillRect(cx, cy, 16, 16);
      }
    }
    ctx.drawImage(icons[i], x + 44, 272, 256, 256);
    ctx.fillStyle = dark ? "#b7c6da" : "#65717c"; ctx.font = "16px system-ui"; ctx.fillText(notes[i], x + 24, 579);
    for (const [index, size] of [16, 24, 32, 64].entries()) {
      const left = x + 26 + index * 74;
      ctx.drawImage(icons[i], left, 626 + (64 - size) / 2, size, size);
      ctx.font = "14px system-ui"; ctx.fillText(`${size} px`, left, 725);
    }
    ctx.fillStyle = dark ? "#f1f5fc" : "#182331"; ctx.font = "17px system-ui";
    ctx.drawImage(icons[i], x + 24, 757, 28, 28); ctx.fillText("Your map", x + 65, 778);
  }
  ctx.fillStyle = "#65717c"; ctx.font = "18px system-ui";
  ctx.fillText("Same silhouette. Same orientation.   •   SVG + PNG   •   Light / dark browser links   •   Opaque Apple touch icons", 58, 866);
  return canvas.toDataURL("image/png");
}
