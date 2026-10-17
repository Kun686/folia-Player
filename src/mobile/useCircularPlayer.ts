import { useLayoutEffect, useRef, useState } from 'react';
import { animate, useMotionTemplate, useMotionValue } from 'framer-motion';
import { useReducedMotionFor } from '../hooks/useReducedMotionFor';

// useCircularPlayer.ts — retain the scene through closing; both directions share the mini-cover origin.
export function useCircularPlayer(expanded: boolean) {
  const [present, setPresent] = useState(expanded);
  const radius = useMotionValue(0), x = useMotionValue(0), y = useMotionValue(0), opacity = useMotionValue(0);
  const reduced = useReducedMotionFor('uiMicroMotion');
  const animation = useRef<ReturnType<typeof animate> | null>(null);
  const clipPath = useMotionTemplate`circle(${radius}px at ${x}px ${y}px)`;
  useLayoutEffect(() => {
    if (expanded) setPresent(true);
    if (!expanded && !present) return;
    let current = true;
    const geometry = () => {
      const cover = document.querySelector('.mini-title .song-art')?.getBoundingClientRect();
      const cx = cover ? cover.x + cover.width / 2 : 40;
      const cy = cover ? cover.y + cover.height / 2 : window.innerHeight - 48;
      x.set(cx); y.set(cy);
      return Math.hypot(Math.max(cx, window.innerWidth - cx), Math.max(cy, window.innerHeight - cy)) + 2;
    };
    const run = () => {
      animation.current?.stop();
      const target = geometry();
      const done = () => { if (current && !expanded) setPresent(false); };
      if (reduced) {
        radius.set(target);
        animation.current = animate(opacity, expanded ? 1 : 0, { duration: .12, onComplete: done });
      } else {
        opacity.set(1);
        animation.current = animate(radius, expanded ? target : 0,
          { type: 'spring', stiffness: 260, damping: 32, restDelta: .5, restSpeed: .5, onComplete: done });
      }
    };
    run();
    window.addEventListener('resize', run);
    return () => { current = false; animation.current?.stop(); window.removeEventListener('resize', run); };
  }, [expanded, present, reduced, radius, x, y, opacity]);
  return { present, style: { clipPath: reduced ? 'none' : clipPath, opacity } };
}
