import { useLayoutEffect, type RefObject } from 'react';
import { FULL_VIEWPORT_PRESENTATION, type ViewportPresentation } from '../types/viewportPresentation';
import { fitLivePreview } from './livePreviewGeometry';

// useLivePreviewLayout.ts — observe layout changes only; spring frames never enter React state.
export function useLivePreviewLayout(panel: RefObject<HTMLElement | null>, hidden: boolean,
  changed?: (presentation: ViewportPresentation) => void) {
  useLayoutEffect(() => {
    const surface = panel.current, host = surface?.parentElement, stage = surface?.closest('.player-panel');
    if (hidden || !surface || !host || !stage || !changed) return;
    let frame = 0, previous = FULL_VIEWPORT_PRESENTATION;
    const measure = () => {
      frame = 0;
      const bounds = stage.getBoundingClientRect(), hostBounds = host.getBoundingClientRect(), style = getComputedStyle(host);
      const left = parseFloat(style.paddingLeft), top = parseFloat(style.paddingTop);
      const x = hostBounds.x - bounds.x, y = hostBounds.y - bounds.y;
      // offset geometry excludes the sheet's entering translateY, so the preview targets its final position.
      const next = fitLivePreview(bounds, {
        x: x + left, y: y + top, width: host.clientWidth - left - parseFloat(style.paddingRight),
        height: host.clientHeight - top - parseFloat(style.paddingBottom),
      }, { x: x + surface.offsetLeft, y: y + surface.offsetTop, width: surface.offsetWidth, height: surface.offsetHeight });
      if (Math.abs(next.x - previous.x) < .1 && Math.abs(next.y - previous.y) < .1
          && next.width === previous.width && next.height === previous.height) return;
      previous = next; changed(next);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    const observer = new ResizeObserver(schedule);
    [surface, host, stage].forEach(element => observer.observe(element));
    window.visualViewport?.addEventListener('scroll', schedule);
    window.addEventListener('resize', schedule);
    measure();
    return () => {
      cancelAnimationFrame(frame); observer.disconnect();
      window.visualViewport?.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      changed(FULL_VIEWPORT_PRESENTATION);
    };
  }, [panel, hidden, changed]);
}
