import { useEffect, useRef, useState } from 'react';
import type { LyricData, SongResult } from '../types';
import { loadOnlineSongLyrics } from '../services/onlinePlayback';
import { getMobileRuntime } from '../services/mobileRuntime';
import { resolveLocalSongLyrics } from '../utils/lyrics/localSongLyrics';
import { localLyricsFromSnapshot } from '../utils/lyrics/localLyricSnapshot';
import { native } from './bridge';
import { useMobileCoverState } from './useMobileCover';
import { useLyricDisplay } from './useLyricDisplay';
import { useMobileSegmentation } from './useMobileSegmentation';

// src/mobile/useMobileLyrics.ts — reuse the original local parser and online Omni pipeline.
export function useMobileLyrics(song?: SongResult, editing = false) {
  const [loaded, setLoaded] = useState<{ key: string | undefined; lyrics: LyricData | null }>();
  const { cover, loading: coverLoading } = useMobileCoverState(song);
  const [finished, setFinished] = useState<string>();
  const [error, setError] = useState(false);
  const [version, setVersion] = useState(0);
  const key = JSON.stringify(song?.sourceRef);
  const requestKey = JSON.stringify([key, version, editing]);
  const rawLyrics = loaded?.key === key ? loaded?.lyrics ?? null : null;
  const segmentation = useMobileSegmentation(song);
  const lyrics = useLyricDisplay(rawLyrics, song, segmentation.record);
  const wasEditing = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (editing) wasEditing.current = key;
    const skipAutoMatch = wasEditing.current === key && key !== undefined;
    if (!editing) wasEditing.current = undefined;
    let active = true;
    const setLyrics = (value: LyricData | null) => { if (active) setLoaded({ key, lyrics: value }); };
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
    void load().catch(() => { if (active) setError(true); }).finally(() => { if (active) setFinished(requestKey); });
    return () => { active = false; };
  }, [key, version, editing]);
  return { lyrics, rawLyrics, cover, coverLoading, loading: !!song && finished !== requestKey, error, segmentation, refresh: () => setVersion(v => v + 1) };
}
