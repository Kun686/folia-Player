import { useTranslation } from 'react-i18next';
import type { SongResult } from '../types';
import { canResolveSongCatalogRef } from '../services/onlineMusic/catalogRefs';
import type { OnlineCatalogTarget } from './onlineCatalog';

// OnlineCatalogActions.tsx — touch equivalents of the original song's album and artist links.
export default function OnlineCatalogActions({ song, enabled, open }: {
  song: SongResult; enabled: boolean; open(target: OnlineCatalogTarget): void;
}) {
  const { t } = useTranslation();
  const { sourceRef } = song;
  if (sourceRef?.kind !== 'online') return null;
  const candidate = { ...song, sourceRef };
  const album = song.album.name && canResolveSongCatalogRef(candidate, 'album', song.album);
  const artists = song.artists.filter(artist => artist.name && canResolveSongCatalogRef(candidate, 'artist', artist));
  if (!album && !artists.length) return null;
  return <>
    {album && <button disabled={!enabled} onClick={() => open({ song, kind: 'album', entity: song.album })}>
      {t('mobile.catalogAlbum', { name: song.album.name })}</button>}
    {artists.map((artist, index) => <button key={index} disabled={!enabled}
      onClick={() => open({ song, kind: 'artist', entity: artist })}>{t('mobile.catalogArtist', { name: artist.name })}</button>)}
    {!enabled && <p className="muted">{t('mobile.catalogUnavailable')}</p>}
  </>;
}
