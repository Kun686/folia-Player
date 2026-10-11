import { useEffect, useRef, useState } from 'react';
import type { LyricData, SongResult } from '../types';
import { loadOnlineSongLyrics } from '../services/onlinePlayback';
import { getMobileRuntime } from '../services/mobileRuntime';
import { resolveLocalSongLyrics } from '../utils/lyrics/localSongLyrics';
import { localLyricsFromSnapshot } from '../utils/lyrics/localLyricSnapshot';
import { native } from './bridge';
import { useMobileCover } from './useMobileCover';

// src/mobile/useMobileLyrics.ts — reuse the original local parser and online Omni pipeline.
export function useMobileLyrics(song?: SongResult, editing = false) {
  const [lyrics, setLyrics] = useState<LyricData | null>(null);
  const cover = useMobileCover(song);
  const [error, setError] = useState(false);
  const [version, setVersion] = useState(0);
  const key = JSON.stringify(song?.sourceRef);
  const wasEditing = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (editing) wasEditing.current = key;
    const skipAutoMatch = wasEditing.current === key && key !== undefined;
    if (!editing) wasEditing.current = undefined;
    let active = true;
    if (!editing) setLyrics(null);
    setError(false);
    const load = async () => {
      if (!song) return;
      if (song.sourceRef?.kind === 'local') {
        const detail = await native.readLocalLyrics({ id: song.sourceRef.mediaId });
        if (!active) return;
        const result = await resolveLocalSongLyrics(localLyricsFromSnapshot(detail), 'local');
        if (active) setLyrics(result.lyrics);
      } else {
        const storage = await getMobileRuntime()?.lyrics?.open(song);
        if (!active) return;
        await loadOnlineSongLyrics(song, null, undefined, {
          isCurrent: () => active,
          onLyrics: value => { if (active) setLyrics(value); },
          onDone: () => undefined,
        }, storage, { skipAutoMatch, readOnly: editing });
      }
    };
    void load().catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [key, version, editing]);
  return { lyrics, cover, error, refresh: () => setVersion(v => v + 1) };
}
