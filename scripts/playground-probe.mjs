// A committed component and useful content are separate acceptance facts.
export const playgroundReady = id => `document.querySelector(".playground")?.dataset.brickReady === ${JSON.stringify(id)}`;
export const playgroundState = id => `(() => {
  const mount = document.querySelector(${JSON.stringify(`[data-brick="${id}"]`)});
  return { broke: document.querySelector(".brick-broke")?.textContent ?? "", errors: document.querySelector(".playground").dataset.errors,
    mounted: !!mount, shows: !!mount && (mount.textContent.trim().length > 0 || mount.querySelector("svg, canvas, img, video") !== null),
    sideways: document.documentElement.scrollWidth - innerWidth };
})()`;
