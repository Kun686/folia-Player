import { useEffect, useRef, useState, type HTMLAttributes } from 'react';
import { usePlayerChromeActivity } from '../hooks/usePlayerChromeActivity';

// usePlayerChrome.ts — explicit taps and the original idle clock share one reversible control layer.
export function usePlayerChrome(enabled: boolean, playing: boolean, blocked: boolean) {
  const [idleHidden, setIdleHidden] = useState(false);
  const [manualHidden, setManualHidden] = useState(false);
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const pointer = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  const tapped = useRef(false);
  const available = enabled && !blocked && !keyboardFocus;
  const idleEnabled = available && playing && !manualHidden;
  const revealIdle = usePlayerChromeActivity(idleEnabled, setIdleHidden);
  const reveal = () => { setManualHidden(false); setIdleHidden(false); revealIdle(); };
  const hidden = available && (manualHidden || (playing && idleHidden));
  useEffect(() => { if (!idleEnabled) setIdleHidden(false); }, [idleEnabled]);
  useEffect(() => { if (!available) setManualHidden(false); }, [available]);
  // External pause/resume must expose the changed state; a later deliberate tap can still hide it.
  useEffect(() => { setManualHidden(false); }, [playing]);
  useEffect(() => {
    if (!enabled) return;
    // Hidden controls are inert, so keyboard navigation wakes them at window level.
    const keyDown = (event: KeyboardEvent) => { if (event.key === 'Tab') setKeyboardFocus(true); };
    window.addEventListener('keydown', keyDown);
    return () => window.removeEventListener('keydown', keyDown);
  }, [enabled]);
  const focusProps: Pick<HTMLAttributes<HTMLElement>, 'onPointerDownCapture' | 'onFocusCapture' | 'onBlurCapture'> = {
    onPointerDownCapture: () => setKeyboardFocus(false),
    // WebKit may mark programmatic poster focus as focus-visible after lazy loading.
    // Only an actual Tab key establishes keyboard mode; focus alone must not pin the chrome open.
    onFocusCapture: event => {
      const visible = event.target.matches(':focus-visible');
      setKeyboardFocus(current => current && visible);
    },
    onBlurCapture: event => { if (!event.currentTarget.contains(event.relatedTarget)) setKeyboardFocus(false); },
  };
  const stageTapProps: HTMLAttributes<HTMLDivElement> = {
    onPointerDownCapture: event => {
      tapped.current = false;
      pointer.current = event.isPrimary && event.button === 0
        ? { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false } : null;
    },
    onPointerMoveCapture: event => {
      const start = pointer.current;
      if (start?.id === event.pointerId && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) start.moved = true;
    },
    onPointerUpCapture: event => {
      const start = pointer.current;
      tapped.current = start?.id === event.pointerId && !start.moved
        && Math.hypot(event.clientX - start.x, event.clientY - start.y) <= 10;
      pointer.current = null;
    },
    onPointerCancelCapture: () => { pointer.current = null; tapped.current = false; },
    onClick: event => {
      const tap = tapped.current; tapped.current = false;
      if (!tap || !available || event.defaultPrevented || !(event.target instanceof Element)) return;
      if (event.target.closest('button,a,input,select,textarea,summary,[role="button"],[tabindex],[contenteditable]')) return;
      setManualHidden(true);
    },
  };
  return { hidden, reveal, focusProps, stageTapProps };
}
