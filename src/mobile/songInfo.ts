import type { SongResult } from '../types';
import { omni } from '../services/onlineMusic/omni';
import { getProviderSongMetadata } from '../services/onlineMusic/songMetadata';
import { getPlaybackSourceRef } from '../utils/appPlaybackGuards';
import { formatSongInfoText } from '../utils/songMetadata';

// songInfo.ts — copy the original display metadata and public page, never a media URL or session.
export function mobileSongInfo(song: SongResult) {
  const metadata = getProviderSongMetadata(song);
  let pageUrl: string | null = null;
  if (getPlaybackSourceRef(song).kind === 'online') {
    try {
      const value = omni.getSongPageUrl(song);
      if (value) {
        const url = new URL(value);
        if (url.protocol === 'https:' && !url.username && !url.password) pageUrl = url.href;
      }
    } catch { /* A missing provider page must not prevent copying the song's metadata. */ }
  }
  return { metadata, pageUrl, text: formatSongInfoText(song.name || '', metadata, pageUrl) };
}
