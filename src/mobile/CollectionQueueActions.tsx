import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SongResult } from '../types';
import { derivePlayableTracks } from '../library/core/model/collectionView';
import { isSongUnavailable } from '../services/onlineMusic/songAvailability';

// CollectionQueueActions.tsx — enqueue the original collection's currently displayed playable scope.
export type EnqueueCollection = (songs: SongResult[]) => Promise<number | undefined>;
export default function CollectionQueueActions({ songs, busy, enqueue }: {
  songs: SongResult[]; busy: boolean; enqueue: EnqueueCollection;
}) {
  const { t } = useTranslation();
  const tracks = useMemo(() => derivePlayableTracks(songs, isSongUnavailable), [songs]);
  const [pending, setPending] = useState(false), [count, setCount] = useState<number>(), [failed, setFailed] = useState(false);
  const active = useRef(false), locked = useRef(false), latest = useRef(songs); latest.current = songs;
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => { setCount(undefined); setFailed(false); }, [songs]);
  const add = async () => {
    if (busy || locked.current || !tracks.length) return;
    locked.current = true; setPending(true); setCount(undefined); setFailed(false);
    try {
      const accepted = await enqueue(tracks);
      if (active.current && latest.current === songs) setCount(accepted);
    } catch { if (active.current && latest.current === songs) setFailed(true); }
    finally { locked.current = false; if (active.current) setPending(false); }
  };
  return <div className="collection-queue-actions">
    <div className="collection-actions"><span>{t('libraryTui.scope', { count: tracks.length })}</span>
      <button disabled={busy || pending || !tracks.length} onClick={() => void add()}>{t('libraryTui.enqueue')}</button></div>
    {count !== undefined && <p role="status">{t(count ? 'mobile.collectionEnqueued' : 'mobile.collectionQueueUnchanged', { count })}</p>}
    {failed && <p role="alert">{t('mobile.error')}</p>}
  </div>;
}
