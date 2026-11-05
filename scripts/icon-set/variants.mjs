/** Change paint only. All appearances retain the original mirrored path and bead. */
export function svgVariants(source) {
  const dark = source.replaceAll("#0393fe", "#263b55").replaceAll("#0069ea", "#0c1524");
  const tinted = source.replaceAll("#0393fe", "#303030").replaceAll("#0069ea", "#111111").replaceAll("#fdba48", "#cfcfcf");
  const foreground = source.replace(/<rect[^>]*\/>/g, "");
  const transparent = foreground.replaceAll("#ffffff", "#087eea");
  const monochrome = foreground.replaceAll("#ffffff", "#000000").replaceAll("#fdba48", "#000000");
  return { dark, tinted, transparent, monochrome };
}

/** Repaint the blue plate, retaining the supplied raster's lighting and exact silhouette. */
export function repaintPixels(data, appearance) {
  for (let i = 0; i < data.length; i += 4) {
    const [r, g, b] = data.slice(i, i + 3);
    const plate = b > r + 24 && r < b * .65 && g < b * .97;
    if (plate) {
      const light = (g + b) / 510;
      const base = appearance === "dark" ? [8, 15, 26] : [8, 8, 8];
      const range = appearance === "dark" ? [23, 34, 48] : [35, 35, 35];
      for (let c = 0; c < 3; c++) data[i + c] = base[c] + range[c] * light;
    } else if (appearance === "tinted") {
      const gray = Math.round(.2126 * r + .7152 * g + .0722 * b);
      data[i] = data[i + 1] = data[i + 2] = gray;
    }
  }
}
