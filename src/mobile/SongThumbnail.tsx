import { useState } from 'react';
import { Music2 } from 'lucide-react';
import type { ReactNode } from 'react';
import type { SongResult } from '../types';
import { getSizedCoverUrl } from '../utils/coverUrl';

// SongThumbnail.tsx — small public CDN artwork; list rows never compete with native player cover jobs.
export function ThumbnailImage({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  return failed ? <Music2 size={18} /> : <img src={url} alt="" width={40} height={40}
    loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
}

export default function SongThumbnail({ song, label }: { song?: SongResult | null; label?: ReactNode }) {
  const source = song?.sourceRef;
  const supported = source?.kind === 'online' && (source.providerId === 'qq' || source.providerId === 'netease');
  // 40 CSS pixels at up to 3x scale. Shared sizing picks QQ's supported 300px bucket.
  const url = supported ? getSizedCoverUrl(song?.album.coverUrl, 120) : '';
  return <div className="song-art" aria-hidden="true">
    {label ?? (url ? <ThumbnailImage key={url} url={url} /> : <Music2 size={18} />)}
  </div>;
}
