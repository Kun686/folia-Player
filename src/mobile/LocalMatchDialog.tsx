import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MotionValue } from 'framer-motion';
import type { LocalMatchRequests, LocalMatchSnapshot } from '../types/localSongMatch';
import { omni } from '../services/onlineMusic/omni';
import { calculateMatchScore } from '../utils/lyrics/matchScore';
import { hasRenderableLyrics } from '../utils/lyrics/validity';
import { localMatchTarget } from '../utils/localMatchDocument';
import LyricMatchModal from '../components/modal/LyricMatchModal';
import { localMatchStorage } from './localMatchStorage';
import { native } from './bridge';

// LocalMatchDialog.tsx — original complete dialog, Omni transport and native storage for one mounted local song.
const sources = ['netease', 'qq'] as const;
const requests: LocalMatchRequests = {
  search: async (source, query, target) => {
    if (source !== 'netease' && source !== 'qq') throw new Error('unsupported');
    const page = await omni.searchProviderSongs(source, query, { limit: 50, offset: 0 });
    return [...page.items].sort((a, b) => calculateMatchScore(target, b) - calculateMatchScore(target, a));
  },
  fetch: async (source, song) => {
    if (song.sourceRef?.kind !== 'online' || song.sourceRef.providerId !== source) throw new Error('invalid-identity');
    const result = await omni.getLyrics(song);
    return { lyrics: hasRenderableLyrics(result.lyrics) ? result.lyrics : null, isPureMusic: result.isPureMusic };
  },
};
export default function LocalMatchDialog({ id, light, time, close, done }: {
  id: string; light: boolean; time?: MotionValue<number>; close(): void; done(): void;
}) {
  const { t } = useTranslation(), active = useRef(true);
  const [snapshot, setSnapshot] = useState<LocalMatchSnapshot>(), [error, setError] = useState(false), [retry, setRetry] = useState(0);
  useEffect(() => {
    let mounted = true; active.current = true; setError(false);
    void native.readLocalMatch({ id }).then(value => { if (mounted) setSnapshot(value); }).catch(() => { if (mounted) setError(true); });
    return () => { mounted = false; active.current = false; };
  }, [id, retry]);
  const song = useMemo(() => snapshot && localMatchTarget(snapshot), [snapshot]);
  const storage = useMemo(() => snapshot && localMatchStorage(snapshot, () => active.current), [snapshot]);
  const dismiss = () => { active.current = false; close(); };
  return <div className="mobile-lyric-match mobile-local-match">
    {song && storage ? <LyricMatchModal song={song} storage={storage} requests={requests} sources={sources}
      localCover={snapshot?.embeddedCover} isDaylight={light} currentTime={time} onClose={dismiss} onMatch={done} />
      : <section role="dialog" aria-label={t('localMusic.matchLyrics')} className="sheet">
        <button onClick={dismiss}>{t('mobile.close')}</button>
        {error ? <><p role="alert">{t('mobile.lyricEditError')}</p><button onClick={() => setRetry(x => x + 1)}>{t('mobile.retry')}</button></>
          : <p role="status">{t('localMusic.loadingLyrics')}</p>}
      </section>}
  </div>;
}
