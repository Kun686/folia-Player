import { useEffect } from 'react';

// useSheetViewport.ts — share keyboard geometry across sheets and the library without resizing the lyric stage.
export function useSheetViewport() {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const root = document.documentElement;
    const properties = ['--sheet-viewport-top', '--sheet-viewport-left', '--sheet-viewport-width', '--sheet-viewport-height'];
    let frame = 0;
    const clear = () => {
      properties.forEach(property => root.style.removeProperty(property));
      root.removeAttribute('data-sheet-short-viewport');
      root.removeAttribute('data-sheet-compact-viewport');
      root.removeAttribute('data-library-keyboard');
    };
    const update = () => {
      frame = 0;
      // Leave pinch zoom to WebKit; keyboard/rotation events adjust only browsing and dialog geometry.
      if (viewport.scale !== 1 || viewport.height <= 0 || viewport.width <= 0) { clear(); return; }
      [viewport.offsetTop, viewport.offsetLeft, viewport.width, viewport.height].forEach((value, index) => {
        const next = `${value}px`;
        if (root.style.getPropertyValue(properties[index]) !== next) root.style.setProperty(properties[index], next);
      });
      root.toggleAttribute('data-sheet-short-viewport', viewport.height < 500);
      // The landscape URL keyboard can leave only 130px: keep full-size fields by reducing chrome spacing.
      root.toggleAttribute('data-sheet-compact-viewport', viewport.height < 200 && viewport.height < window.innerHeight);
      const focused = document.activeElement;
      // The mini-player otherwise consumes the search results' limited space above a software keyboard.
      root.toggleAttribute('data-library-keyboard', viewport.height < window.innerHeight - 1
        && focused instanceof HTMLElement && !!focused.closest('.library-panel')
        && focused.matches('input,textarea,[contenteditable=true]'));
      if (!(focused instanceof HTMLElement) || !focused.matches('input,textarea,[contenteditable=true]')) return;
      const surface = focused.closest('.sheet-body, .sheet, .library-panel');
      if (!surface) return;
      const rect = focused.getBoundingClientRect(), bounds = surface.getBoundingClientRect();
      if (surface.matches('.library-panel') && root.hasAttribute('data-library-keyboard')) {
        // Put results in view as the keyboard opens/rotates; normal library scrolling remains user-controlled.
        surface.scrollTop += rect.top - bounds.top - 12;
        return;
      }
      if (rect.top < Math.max(bounds.top, viewport.offsetTop) || rect.bottom > Math.min(bounds.bottom, viewport.offsetTop + viewport.height)) {
        focused.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
      }
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    viewport.addEventListener('resize', schedule);
    viewport.addEventListener('scroll', schedule);
    window.addEventListener('resize', schedule);
    document.addEventListener('focusin', schedule);
    document.addEventListener('focusout', schedule);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener('resize', schedule);
      viewport.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      document.removeEventListener('focusin', schedule);
      document.removeEventListener('focusout', schedule);
      clear();
    };
  }, []);
}
