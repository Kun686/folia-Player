import { useEffect, useState } from 'react';
import { isNative, native } from './bridge';

// src/mobile/useProviders.ts — capabilities are read from the configured server, never assumed.
export function useProviders(server: string) {
  const [state, setState] = useState<{ providers: string[]; songLikeProviders: string[]; error: boolean }>({ providers: [], songLikeProviders: [], error: false });
  useEffect(() => {
    let current = true;
    setState({ providers: [], songLikeProviders: [], error: false });
    if (server && isNative) void native.health().then(result => {
      if (result.protocol !== 1 || !Array.isArray(result.providers)) throw new Error('invalid-capabilities');
      const providers = result.providers.filter(id => ['netease', 'qq', 'kugou'].includes(id));
      if (!providers.length) throw new Error('no-providers');
      const songLikeProviders = Array.isArray(result.songLikeProviders) ? result.songLikeProviders.filter(id => providers.includes(id)) : [];
      if (current) setState({ providers, songLikeProviders, error: false });
    }).catch(() => { if (current) setState({ providers: [], songLikeProviders: [], error: true }); });
    return () => { current = false; };
  }, [server]);
  return state;
}
