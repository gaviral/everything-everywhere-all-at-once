import { useLayoutEffect, useRef } from 'react';
import { usePluginState } from '../contract';
import type { GroupId } from './groups';

export function useVisit(scope: string) {
  return usePluginState<{ group: GroupId | null; feature: string | null; scroll: number }>(`catalog-canvas:visit:${scope}`, { group: null, feature: null, scroll: 0 });
}

export function useReturnPlace(key: string, feature: string | null, scroll: number) {
  const surface = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = surface.current;
    if (!element) return;
    element.scrollTop = scroll;
    const target = feature ? element.querySelector<HTMLButtonElement>(`[data-feature="${CSS.escape(feature)}"]`) : null;
    target?.focus({ preventScroll: true });
  }, [key]);
  return surface;
}
