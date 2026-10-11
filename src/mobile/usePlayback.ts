import { useCallback, useEffect, useRef, useState } from 'react';
import type { SongResult } from '../types';
import { useMotionValue } from 'framer-motion';
import { native, isNative, type PlaybackSnapshot, type PlaybackEvent } from './bridge';
import { createNativeTransitionCueSync } from './nativeTransitionCue';

// src/mobile/usePlayback.ts — snapshots correct a foreground-only interpolation clock.
const initial: PlaybackSnapshot = { queue: [], index: -1, currentSong: null, queueRevision: -1, position: 0, duration: 0, playing: false, repeat: 'off', revision: -1 };
export function usePlayback() {
  const [state, setState] = useState(initial);
  const [visible, setVisible] = useState(!document.hidden);
  const currentTime = useMotionValue(0);
  const snapshot = useRef({ state: initial, at: performance.now() });
  const songEpoch = useRef(0);
  // Invalidate edits as soon as a native switch arrives, before React commits the next render.
  const captureSongGuard = useCallback((song: SongResult) => {
    const epoch = songEpoch.current, key = JSON.stringify(song.sourceRef);
    return () => epoch === songEpoch.current && key === JSON.stringify(snapshot.current.state.currentSong?.sourceRef);
  }, []);
  useEffect(() => {
    if (!isNative) return;
    let disposed = false;
    const transitions = createNativeTransitionCueSync();
    const receive = (event: PlaybackEvent) => {
      const value = { ...snapshot.current.state, ...event, queue: event.queue ?? snapshot.current.state.queue };
      if (disposed || value.revision < snapshot.current.state.revision) return;
      if (JSON.stringify(value.currentSong?.sourceRef) !== JSON.stringify(snapshot.current.state.currentSong?.sourceRef)) songEpoch.current++;
      snapshot.current = { state: value, at: performance.now() };
      if (!document.hidden) transitions.receive(value.transitionCue);
      currentTime.set(value.position); setState(value);
    };
    const subscription = native.addListener('playback', receive);
    const restore = () => {
      transitions.clear();
      setVisible(!document.hidden);
      if (!document.hidden) void native.getState().then(receive).catch(() => setState(s => ({ ...s, error: 'state-unavailable' })));
    };
    restore();
    document.addEventListener('visibilitychange', restore);
    return () => { disposed = true; songEpoch.current++; transitions.clear(); document.removeEventListener('visibilitychange', restore); void subscription.then(s => s.remove()); };
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
  return { state, currentTime, visible, captureSongGuard, songEpoch: songEpoch.current };
}
