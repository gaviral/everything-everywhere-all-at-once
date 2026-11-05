import { useEffect, useLayoutEffect, useRef } from "react";

/** Keep the floating brick above the camera without changing either feature's DOM. */
export function useShellCountdownPlacement(enabled: boolean) {
  const refresh = useRef<() => void>(() => {});
  useLayoutEffect(() => { if (enabled) refresh.current(); });
  useEffect(() => {
    if (!enabled) return;
    const root = document.documentElement;
    const names = ["--shell-countdown-left", "--shell-countdown-bottom", "--shell-countdown-editor-room", "--shell-countdown-editor-gap"];
    const clear = () => names.forEach((name) => root.style.removeProperty(name));
    const publish = (name: string, value: number) => {
      const px = `${value}px`;
      if (root.style.getPropertyValue(name) !== px) root.style.setProperty(name, px);
    };
    // The map and gallery end above the lowest controls, so words never peek between them.
    const clearance = () => {
      // A card positioned around canvas capture cannot also clip that capture's canvas.
      const canvasCapture = document.querySelector('[data-map-capture="active"] .shell-composer');
      const selectors = ".shell-stage, .shell-bl, .spine-corner, .spine-corner-row" + (canvasCapture ? "" : ", .countdown-card");
      const covers = Array.from(document.querySelectorAll<HTMLElement>(selectors))
        .map(el => el.getBoundingClientRect()).filter(r => r.width && r.height);
      const bottom = Math.max(0, innerHeight - Math.min(innerHeight, ...covers.map(r => r.top)) + 12);
      publish("--shell-content-bottom", bottom);
    };
    let frame = 0;
    let observed: Element[] = [];
    const schedule = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; measure(); }); };
    const resize = new ResizeObserver(schedule);
    const positions = new MutationObserver(schedule);
    const measure = () => {
      const countdown = document.getElementsByClassName("countdown")[0] as HTMLElement | undefined;
      const card = document.getElementsByClassName("countdown-card")[0];
      const editor = document.getElementsByClassName("countdown-editor")[0];
      // On phones the camera's controls share the corner row with the shelf (and Following can be hidden).
      const camera = document.querySelector<HTMLElement>(".spine-corner-left .spine-camera, .spine-corner-row");
      const stage = document.querySelector<HTMLElement>(".shell-stage");
      const controls = document.querySelector<HTMLElement>(".shell-bl");
      const composer = document.querySelector<HTMLElement>(".shell-composer");
      const captureBody = composer?.closest<HTMLElement>('[data-map-capture="active"]') ?? composer;
      const captureNode = composer?.closest<HTMLElement>(".react-flow__node");
      const canvasViewport = composer?.closest<HTMLElement>(".react-flow__viewport");
      const elements = [countdown, card, editor, camera, camera?.parentElement, stage, controls, composer, captureBody, captureNode, canvasViewport].filter((e): e is HTMLElement => !!e);
      if (elements.length !== observed.length || elements.some((e, i) => e !== observed[i])) {
        resize.disconnect(); positions.disconnect();
        for (const element of elements) {
          resize.observe(element);
          positions.observe(element, { attributes: true, attributeFilter: ["style", "class"] });
        }
        observed = elements;
      }
      if (!countdown || !card) { clear(); clearance(); return; }
      const styles = getComputedStyle(root);
      const gap = parseFloat(styles.getPropertyValue("--shell-corner-gap"));
      const edge = parseFloat(styles.getPropertyValue("--shell-edge"));
      const viewport = window.visualViewport;
      const x = viewport?.offsetLeft ?? 0, y = viewport?.offsetTop ?? 0;
      const width = viewport?.width ?? innerWidth, height = viewport?.height ?? innerHeight;
      const box = card.getBoundingClientRect();
      const cameraBox = camera?.getBoundingClientRect();
      const stageBox = stage?.getBoundingClientRect();
      const left = Math.max(x + edge, Math.min(cameraBox?.left ?? x + edge, x + width - edge - box.width));
      // A missing camera keeps a clear dock-relative position. Only horizontally intersecting controls lift it.
      let bottom = cameraBox?.top ?? stageBox?.top ?? y + height - edge;
      for (const element of [stage, composer, controls]) {
        if (!element) continue;
        const r = element.getBoundingClientRect();
        if (r.width && r.height && r.left < left + box.width && r.right > left) bottom = Math.min(bottom, r.top);
      }
      bottom = Math.min(bottom - gap, y + height - edge);
      const captureBox = captureBody?.getBoundingClientRect();
      // Capture is canvas content: a clear gap below it stays usable. Lift only on an actual collision.
      if (captureBox?.width && captureBox.height && captureBox.left < left + box.width && captureBox.right > left
          && bottom - box.height < captureBox.bottom && bottom > captureBox.top) bottom = captureBox.top - gap;
      bottom = Math.max(y + edge + box.height, bottom);
      const room = Math.max(0, bottom - box.height - gap - y - edge);
      // Keep enough scrollable space for a control even when the stage leaves no room above the card.
      // In that case the editor starts at the viewport edge and extends down over the card.
      const editorStyles = editor ? getComputedStyle(editor) : null;
      const chrome = editorStyles ? [editorStyles.paddingTop, editorStyles.paddingBottom, editorStyles.borderTopWidth, editorStyles.borderBottomWidth]
        .reduce((total, value) => total + parseFloat(value), 0) : 0;
      const heading = editor?.querySelector(".countdown-top")?.getBoundingClientRect().height ?? 0;
      const control = Math.max(0, ...Array.from(editor?.querySelectorAll("input, button") ?? [], e => e.getBoundingClientRect().height));
      const minimum = Math.min(chrome + heading + gap + control, height - 2 * edge);
      const editorRoom = Math.max(room, minimum);
      publish(names[0], left);
      publish(names[1], innerHeight - bottom);
      publish(names[2], editorRoom);
      publish(names[3], gap - (editorRoom - room));
      clearance();
    };
    refresh.current = measure;
    const mounts = new MutationObserver(schedule);
    mounts.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    measure();
    return () => {
      refresh.current = () => {};
      cancelAnimationFrame(frame);
      mounts.disconnect(); resize.disconnect(); positions.disconnect();
      root.style.removeProperty("--shell-content-bottom");
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
      clear();
    };
  }, [enabled]);
}
