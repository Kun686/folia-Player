import { useEffect, useState } from 'react';
import type { LyricData, SongResult } from '../types';
import { omni } from '../services/onlineMusic/omni';
import { LocalFileLyricAdapter } from '../utils/lyrics/adapters/LocalFileLyricAdapter';
import { resolveExplicitFileTimedLyricFormat } from '../utils/lyrics/formatDetection';
import { native } from './bridge';

// src/mobile/useMobileLyrics.ts — reuse the original local parser and online Omni pipeline.
export function useMobileLyrics(song?: SongResult) {
  const [lyrics, setLyrics] = useState<LyricData | null>(null);
  const [cover, setCover] = useState<string>();
  const [error, setError] = useState(false);
  const [version, setVersion] = useState(0);
  const key = JSON.stringify(song?.sourceRef);
  useEffect(() => {
    let active = true;
    setLyrics(null); setCover(song?.album.coverUrl); setError(false);
    const load = async () => {
      if (!song) return;
      if (song.sourceRef?.kind === 'local') {
        const detail = await native.localDetails({ id: song.sourceRef.mediaId });
        const result = detail.content ? await new LocalFileLyricAdapter().parse({ type: 'local', lrcContent: detail.content,
          formatHint: resolveExplicitFileTimedLyricFormat(detail.fileName) }) : null;
        if (active) { setLyrics(result); setCover(detail.cover); }
      } else {
        const result = await omni.getLyrics(song);
        if (active) setLyrics(result.lyrics);
      }
    };
    void load().catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [key, version]);
  return { lyrics, cover, error, refresh: () => setVersion(v => v + 1) };
}
