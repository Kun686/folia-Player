import { Music2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ProviderCollection } from '../types/onlineMusic';
import { getSizedCoverUrl } from '../utils/coverUrl';
import { mobileCollectionKey } from './catalogSession';
import { ThumbnailImage } from './SongThumbnail';

// OnlineCollections.tsx — reuse provider artwork and identity to make the selected collection recognizable.
export default function OnlineCollections({ collections, selected, select, overview = false }: {
  collections: ProviderCollection[]; selected: ProviderCollection | null; select(collection: ProviderCollection): void; overview?: boolean;
}) {
  const { t } = useTranslation();
  return <nav className={'collections online-collections' + (overview ? ' online-collections-overview' : '')} aria-label={t('mobile.playlists')}>
    {collections.map(collection => {
      const key = mobileCollectionKey(collection), url = getSizedCoverUrl(collection.coverUrl, 120);
      return <button key={key} aria-pressed={!!selected && mobileCollectionKey(selected) === key} onClick={() => select(collection)}>
        <span className="song-art" aria-hidden="true">{url ? <ThumbnailImage key={url} url={url} /> : <Music2 size={18} />}</span>
        <span className="collection-name">{collection.name}</span>
      </button>;
    })}
  </nav>;
}
