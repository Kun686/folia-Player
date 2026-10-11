import { List, type RowComponentProps } from 'react-window';
import { ChevronLeft, ChevronRight, Disc3, Users, ListMusic } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { MobileLocalCollection } from '../types/mobileLibrary';
import type { useLocalBrowser } from './useLocalBrowser';
import { useMobileCover } from './useMobileCover';

// LocalCollections.tsx — touch navigation over the original album/artist grouping, with bounded visible cover work.
type Browser = ReturnType<typeof useLocalBrowser>;
export function LocalLibraryNav({ browser, clearQuery }: { browser: Browser; clearQuery(): void }) {
  const { t } = useTranslation();
  return <>
    <nav className="local-sections" aria-label={t('mobile.localBrowse')}>
      {(['songs', 'albums', 'artists', 'playlists'] as const).map(section => <button key={section}
        aria-pressed={browser.section === section} onClick={() => { browser.changeSection(section); clearQuery(); }}>
        {t(section === 'songs' ? 'localMusic.allSongs' : section === 'playlists' ? 'localMusic.customPlaylists' : 'localMusic.' + section)}
      </button>)}
    </nav>
    {browser.selected && <div className="local-collection-heading">
      <button aria-label={t('mobile.backToCollections')} onClick={() => { browser.select(null); clearQuery(); }}><ChevronLeft /></button>
      <div><h3>{browser.selected.name}</h3><p>{browser.selected.songs.length} {t('mobile.tracks')}</p></div>
    </div>}
  </>;
}
interface Props { collections: MobileLocalCollection[]; select(id: string): void }
function Row({ index, style, collections, select }: RowComponentProps<Props>) {
  const { t } = useTranslation();
  const group = collections[index];
  const cover = useMobileCover(group.songs[0]);
  const Icon = group.type === 'album' ? Disc3 : group.type === 'artist' ? Users : ListMusic;
  return <div className="song-row" style={style}>
    <button className="song-main local-collection" aria-label={t('mobile.openCollection', { name: group.name })} onClick={() => select(group.id)}>
      <div className="song-art" aria-hidden="true">{cover ? <img src={cover} alt="" /> : <Icon size={20} />}</div>
      <span><strong>{group.name}</strong><small>{group.songs.length} {t('mobile.tracks')}</small></span><ChevronRight size={18} />
    </button>
  </div>;
}
export default function LocalCollections(props: Props) {
  const { t } = useTranslation();
  return props.collections.length ? <List className="song-list local-collections" style={{ minHeight: 180 }}
    rowComponent={Row} rowCount={props.collections.length} rowHeight={76} rowProps={props} overscanCount={3} />
    : <div className="empty"><p>{t('mobile.empty')}</p></div>;
}
