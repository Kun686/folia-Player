import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MotionValue } from 'framer-motion';
import type { LocalMatchSnapshot } from '../types/localSongMatch';
import { localMatchTarget } from '../utils/localMatchDocument';
import LyricMatchModal from '../components/modal/LyricMatchModal';
import { localMatchStorage } from './localMatchStorage';
import { native } from './bridge';
import { MOBILE_LYRIC_MATCH_SOURCES, mobileLocalMatchRequests } from './lyricMatchRequests';

// LocalMatchDialog.tsx — original complete dialog, Omni transport and native storage for one mounted local song.
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
    {song && storage ? <LyricMatchModal song={song} storage={storage} requests={mobileLocalMatchRequests} sources={MOBILE_LYRIC_MATCH_SOURCES}
      localCover={snapshot?.embeddedCover} isDaylight={light} currentTime={time} onClose={dismiss} onMatch={done} />
      : <section role="dialog" aria-label={t('localMusic.matchLyrics')} className="sheet">
        <button onClick={dismiss}>{t('mobile.close')}</button>
        {error ? <><p role="alert">{t('mobile.lyricEditError')}</p><button onClick={() => setRetry(x => x + 1)}>{t('mobile.retry')}</button></>
          : <p role="status">{t('localMusic.loadingLyrics')}</p>}
      </section>}
  </div>;
}
