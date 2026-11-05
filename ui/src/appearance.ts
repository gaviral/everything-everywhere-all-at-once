/** Manifest media selection is explicit; browsers may ignore media on manifest/touch links. */
const appearance = matchMedia("(prefers-color-scheme: dark)");
function updateAppearance() {
  const manifest = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  const touch = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]');
  if (manifest) manifest.href = appearance.matches ? "/icons/manifest-dark.webmanifest" : "/manifest.webmanifest";
  if (touch) touch.href = `/icons/apple-touch-icon${appearance.matches ? "-dark" : ""}.png`;
}
updateAppearance();
appearance.addEventListener("change", updateAppearance);
