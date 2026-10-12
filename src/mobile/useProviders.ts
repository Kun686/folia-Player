import { useEffect, useState } from 'react';
import { isNative, native } from './bridge';

// src/mobile/useProviders.ts — capabilities are read from the configured server, never assumed.
export function useProviders(server: string) {
  const [state, setState] = useState<{ providers: string[]; songLikeProviders: string[]; catalogProviders: string[]; playlistEditProviders: string[]; subscriptionProviders: string[]; dailyProviders: string[]; personalFmProviders: string[]; recommendedCollectionProviders: string[]; userAlbumProviders: string[]; cloudProviders: string[]; error: boolean }>({ providers: [], songLikeProviders: [], catalogProviders: [], playlistEditProviders: [], subscriptionProviders: [], dailyProviders: [], personalFmProviders: [], recommendedCollectionProviders: [], userAlbumProviders: [], cloudProviders: [], error: false });
  useEffect(() => {
    let current = true;
    setState({ providers: [], songLikeProviders: [], catalogProviders: [], playlistEditProviders: [], subscriptionProviders: [], dailyProviders: [], personalFmProviders: [], recommendedCollectionProviders: [], userAlbumProviders: [], cloudProviders: [], error: false });
    if (server && isNative) void native.health().then(result => {
      if (result.protocol !== 1 || !Array.isArray(result.providers)) throw new Error('invalid-capabilities');
      const providers = result.providers.filter(id => ['netease', 'qq', 'kugou'].includes(id));
      if (!providers.length) throw new Error('no-providers');
      const songLikeProviders = Array.isArray(result.songLikeProviders) ? result.songLikeProviders.filter(id => providers.includes(id)) : [];
      const catalogProviders = Array.isArray(result.catalogProviders) ? result.catalogProviders.filter(id => providers.includes(id) && ['netease', 'qq'].includes(id)) : [];
      const playlistEditProviders = Array.isArray(result.playlistEditProviders) ? result.playlistEditProviders.filter(id => providers.includes(id) && id === 'netease') : [];
      const subscriptionProviders = Array.isArray(result.subscriptionProviders) ? result.subscriptionProviders.filter(id => providers.includes(id) && id === 'netease') : [];
      const dailyProviders = Array.isArray(result.dailyProviders) ? result.dailyProviders.filter(id => providers.includes(id) && id === 'netease') : [];
      const personalFmProviders = Array.isArray(result.personalFmProviders) ? result.personalFmProviders.filter(id => providers.includes(id) && id === 'netease') : [];
      const recommendedCollectionProviders = Array.isArray(result.recommendedCollectionProviders) ? result.recommendedCollectionProviders.filter(id => providers.includes(id) && id === 'netease') : [];
      const userAlbumProviders = Array.isArray(result.userAlbumProviders) ? result.userAlbumProviders.filter(id => catalogProviders.includes(id) && ['netease', 'qq'].includes(id)) : [];
      const cloudProviders = Array.isArray(result.cloudProviders) ? result.cloudProviders.filter(id => providers.includes(id) && id === 'netease') : [];
      if (current) setState({ providers, songLikeProviders, catalogProviders, playlistEditProviders, subscriptionProviders, dailyProviders, personalFmProviders, recommendedCollectionProviders, userAlbumProviders, cloudProviders, error: false });
    }).catch(() => { if (current) setState({ providers: [], songLikeProviders: [], catalogProviders: [], playlistEditProviders: [], subscriptionProviders: [], dailyProviders: [], personalFmProviders: [], recommendedCollectionProviders: [], userAlbumProviders: [], cloudProviders: [], error: true }); });
    return () => { current = false; };
  }, [server]);
  return state;
}
