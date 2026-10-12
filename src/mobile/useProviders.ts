import { useEffect, useState } from 'react';
import { isNative, native } from './bridge';

// src/mobile/useProviders.ts — capabilities are read from the configured server, never assumed.
export function useProviders(server: string) {
  const [state, setState] = useState<{ providers: string[]; songLikeProviders: string[]; catalogProviders: string[]; playlistEditProviders: string[]; dailyProviders: string[]; error: boolean }>({ providers: [], songLikeProviders: [], catalogProviders: [], playlistEditProviders: [], dailyProviders: [], error: false });
  useEffect(() => {
    let current = true;
    setState({ providers: [], songLikeProviders: [], catalogProviders: [], playlistEditProviders: [], dailyProviders: [], error: false });
    if (server && isNative) void native.health().then(result => {
      if (result.protocol !== 1 || !Array.isArray(result.providers)) throw new Error('invalid-capabilities');
      const providers = result.providers.filter(id => ['netease', 'qq', 'kugou'].includes(id));
      if (!providers.length) throw new Error('no-providers');
      const songLikeProviders = Array.isArray(result.songLikeProviders) ? result.songLikeProviders.filter(id => providers.includes(id)) : [];
      const catalogProviders = Array.isArray(result.catalogProviders) ? result.catalogProviders.filter(id => providers.includes(id) && ['netease', 'qq'].includes(id)) : [];
      const playlistEditProviders = Array.isArray(result.playlistEditProviders) ? result.playlistEditProviders.filter(id => providers.includes(id) && id === 'netease') : [];
      const dailyProviders = Array.isArray(result.dailyProviders) ? result.dailyProviders.filter(id => providers.includes(id) && id === 'netease') : [];
      if (current) setState({ providers, songLikeProviders, catalogProviders, playlistEditProviders, dailyProviders, error: false });
    }).catch(() => { if (current) setState({ providers: [], songLikeProviders: [], catalogProviders: [], playlistEditProviders: [], dailyProviders: [], error: true }); });
    return () => { current = false; };
  }, [server]);
  return state;
}
