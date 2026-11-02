// Saving a file the window made (Export's Markdown, a dated item's calendar file): handed to the browser to save,
// nothing sent anywhere.

/** Hands the file to the browser to save: a link to it in this page's memory, clicked, then let go. */
export function saveFile(text: string, type: string, name: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoked a moment later: some browsers start the save only after the click returns.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
