import { useEffect, useRef, useState } from 'react';
import { useMotionValue } from 'framer-motion';
import { native, isNative, type PlaybackSnapshot } from './bridge';

// src/mobile/usePlayback.ts — snapshots correct a foreground-only interpolation clock.
const initial: PlaybackSnapshot = { queue: [], index: -1, position: 0, duration: 0, playing: false, repeat: 'off', revision: -1 };
export function usePlayback() {
  const [state, setState] = useState(initial);
  const [visible, setVisible] = useState(!document.hidden);
  const currentTime = useMotionValue(0);
  const snapshot = useRef({ state: initial, at: performance.now() });
  useEffect(() => {
    if (!isNative) return;
    let disposed = false;
    const receive = (event: Omit<PlaybackSnapshot, "queue"> & { queue?: PlaybackSnapshot["queue"] }) => {
      const value = { ...event, queue: event.queue ?? snapshot.current.state.queue };
      if (disposed || value.revision < snapshot.current.state.revision) return;
      snapshot.current = { state: value, at: performance.now() };
      currentTime.set(value.position); setState(value);
    };
    const subscription = native.addListener('playback', receive);
    const restore = () => {
      setVisible(!document.hidden);
      if (!document.hidden) void native.getState().then(receive).catch(() => setState(s => ({ ...s, error: 'state-unavailable' })));
    };
    restore();
    document.addEventListener('visibilitychange', restore);
    return () => { disposed = true; document.removeEventListener('visibilitychange', restore); void subscription.then(s => s.remove()); };
  }, [currentTime]);
  useEffect(() => {
    if (!visible) return;
    let frame: number;
    const tick = () => {
      const { state: value, at } = snapshot.current;
      const delta = value.playing ? Math.min(1, (performance.now() - at) / 1000) : 0;
      currentTime.set(Math.min(value.duration || Infinity, value.position + delta));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [currentTime, visible]);
  return { state, currentTime, visible };
}
