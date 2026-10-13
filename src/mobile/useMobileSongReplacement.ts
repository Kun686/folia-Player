import { useCallback, useEffect, useRef, useState } from 'react';
import type { SongResult } from '../types';
import { prepareMobileSongReplacement, type PreparedSongReplacement } from './mobileSongReplacement';
import { playMobileReplacement } from './queueActions';

// useMobileSongReplacement.ts — one pending confirmation, retired by navigation, cancellation or a later request.
export function useMobileSongReplacement(providers: string[]) {
  const [pending, setPending] = useState<(PreparedSongReplacement & { started: () => void }) | null>(null);
  const epoch = useRef(0);
  const cancel = useCallback(() => { epoch.current++; setPending(null); }, []);
  useEffect(() => () => { epoch.current++; }, []);
  const offer = async (songs: SongResult[], index: number, started: () => void) => {
    const ticket = ++epoch.current; setPending(null);
    const result = await prepareMobileSongReplacement(songs, index, providers, () => epoch.current === ticket);
    if (!result) return false;
    setPending({ ...result, started }); return true;
  };
  const confirm = async () => {
    if (!pending) return;
    const request = pending; setPending(null);
    await playMobileReplacement(request);
    if (request.current()) request.started();
  };
  return { pending, offer, confirm, cancel };
}
