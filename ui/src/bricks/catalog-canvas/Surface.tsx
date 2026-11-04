import { useLayoutEffect, useRef, type ReactNode } from 'react';

export function Surface({ children, back, label }: { children: ReactNode; back: () => void; label: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal(); dialog.focus({ preventScroll: true });
    return () => { dialog.close(); previous?.focus({ preventScroll: true }); };
  }, []);
  return <dialog className="catalog-canvas" aria-label={label} tabIndex={-1} ref={ref} onCancel={event => { event.preventDefault(); back(); }}>
    {children}
  </dialog>;
}
