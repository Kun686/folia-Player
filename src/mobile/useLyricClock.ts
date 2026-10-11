import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useMotionValue, type MotionValue } from 'framer-motion';
import type { SongResult } from '../types';
import { getPlaybackSongKey } from '../utils/appPlaybackGuards';
import { readLyricOffset, writeLyricOffset } from '../utils/lyrics/lyricOffsetMemory';
import { useLyricSettingsStore } from '../stores/useLyricSettingsStore';

// useLyricClock.ts — apply the original song + device offsets to one native-backed visual clock.
export function useLyricClock(song: SongResult | null, playbackTime: MotionValue<number>) {
  const key = song ? getPlaybackSongKey(song) : null;
  const identity = useRef(key); identity.current = key;
  const [edited, setEdited] = useState<{ key: string | null; value: number }>({ key, value: readLyricOffset(key) });
  const offsetMs = edited.key === key ? edited.value : readLyricOffset(key);
  const globalOffsetMs = useLyricSettingsStore(state => state.globalLyricTimelineOffsetMs);
  const effectiveOffsetMs = offsetMs + globalOffsetMs;
  const lyricTime = useMotionValue(playbackTime.get() - effectiveOffsetMs / 1000);
  useLayoutEffect(() => {
    const sync = (position: number) => lyricTime.set(position - effectiveOffsetMs / 1000);
    // Also resync while paused and when a display-song identity changes during a handover.
    sync(playbackTime.get());
    return playbackTime.on('change', sync);
  }, [playbackTime, lyricTime, effectiveOffsetMs, key]);
  const setOffsetMs = useCallback((value: number) => {
    if (!key || identity.current !== key || !Number.isFinite(value)) return;
    writeLyricOffset(key, value);
    setEdited({ key, value });
  }, [key]);
  const toPlaybackTime = useCallback((lyricPosition: number) => (
    Math.max(0, lyricPosition + playbackTime.get() - lyricTime.get())
  ), [playbackTime, lyricTime]);
  return { lyricTime, offsetMs, setOffsetMs, toPlaybackTime };
}
