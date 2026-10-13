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
import { useLyricSettingsStore } from '../stores/useLyricSettingsStore';

// src/mobile/useMobileLyrics.ts — reuse the original local parser and online Omni pipeline.
export function useMobileLyrics(song?: SongResult, editing = false) {
  const [loaded, setLoaded] = useState<{ key: string | undefined; lyrics: LyricData | null }>();
  const { cover, loading: coverLoading } = useMobileCoverState(song);
  const [finished, setFinished] = useState<string>();
  const [error, setError] = useState(false);
  const [version, setVersion] = useState(0);
  const key = JSON.stringify(song?.sourceRef);
  const priority = useLyricSettingsStore(s => s.localLyricsPriority);
  const autoUseBestLyric = useLyricSettingsStore(s => s.autoUseBestLyric);
  const preferredSource = useLyricSettingsStore(s => s.preferredAlternativeLyricSource);
  const online = song?.sourceRef?.kind === 'online';
  const sourceKey = JSON.stringify([key, song?.sourceRef?.kind === 'local' ? priority : null,
    online ? [autoUseBestLyric, preferredSource] : null]);
  const requestKey = JSON.stringify([sourceKey, version, editing]);
  const rawLyrics = loaded?.key === sourceKey ? loaded?.lyrics ?? null : null;
  const segmentation = useMobileSegmentation(song);
  const lyrics = useLyricDisplay(rawLyrics, song, segmentation.record);
  const wasEditing = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (editing) wasEditing.current = key;
    const skipAutoMatch = wasEditing.current === key && key !== undefined;
    if (!editing) wasEditing.current = undefined;
    let active = true;
    // Reject an old preference's result even before React runs the next effect cleanup.
    const isCurrent = () => {
      const settings = useLyricSettingsStore.getState();
      return active && (!online || (settings.autoUseBestLyric === autoUseBestLyric
        && settings.preferredAlternativeLyricSource === preferredSource));
    };
    const setLyrics = (value: LyricData | null) => { if (isCurrent()) setLoaded({ key: sourceKey, lyrics: value }); };
    if (!editing) setLyrics(null);
    setError(false);
    const load = async () => {
      if (!song) return;
      if (song.sourceRef?.kind === 'local') {
        const detail = await native.readLocalLyrics({ id: song.sourceRef.mediaId });
        if (!isCurrent()) return;
        const result = await resolveLocalSongLyrics(localLyricsFromSnapshot(detail), priority);
        if (isCurrent()) setLyrics(result.lyrics);
      } else {
        const storage = await getMobileRuntime()?.lyrics?.open(song);
        if (!isCurrent()) return;
        await loadOnlineSongLyrics(song, null, undefined, {
          isCurrent,
          onLyrics: setLyrics,
          onDone: () => undefined,
        }, storage, { skipAutoMatch, readOnly: editing });
      }
    };
    void load().catch(() => { if (isCurrent()) setError(true); }).finally(() => { if (isCurrent()) setFinished(requestKey); });
    return () => { active = false; };
  }, [sourceKey, version, editing]);
  return { lyrics, rawLyrics, cover, coverLoading, loading: !!song && finished !== requestKey, error, segmentation, refresh: () => setVersion(v => v + 1) };
}
