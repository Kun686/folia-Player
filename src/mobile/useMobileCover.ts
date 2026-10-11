import { useEffect, useState } from 'react';
import type { SongResult } from '../types';
import { loadSongCover } from '../services/onlineMusic/resourceCache';

// useMobileCover.ts — cover failure does not hide lyrics; late results release their own object URL.
export function useMobileCoverState(song?: SongResult) {
  const [value, setValue] = useState<{ key: string; cover: string | undefined }>();
  const key = JSON.stringify([song?.sourceRef, song?.album.coverUrl]);
  useEffect(() => {
    let active = true, owned: string | null = null;
    const release = (url: string | null) => { if (url?.startsWith('blob:')) URL.revokeObjectURL(url); };
    setValue(undefined);
    if (song) void loadSongCover(song).then(url => {
      if (!active) { release(url); return; }
      owned = url; setValue({ key, cover: url ?? undefined });
    }).catch(() => { if (active) setValue({ key, cover: undefined }); /* Audio and lyrics remain independent. */ });
    return () => { active = false; release(owned); };
  }, [key]);
  return { cover: value?.key === key ? value.cover : undefined, loading: !!song && value?.key !== key };
}
export function useMobileCover(song?: SongResult) { return useMobileCoverState(song).cover; }
