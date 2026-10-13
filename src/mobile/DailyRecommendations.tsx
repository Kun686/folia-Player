import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { QueueAddBehavior, SongResult } from '../types';
import { omni } from '../services/onlineMusic/omni';
import { captureProviderSession, flushSessions } from './runtime';
import { createMobileDailyRecommendations } from './mobileDailyRecommendations';
import SongList from './SongList';

// DailyRecommendations.tsx — a touch entry for the original daily collection, history and dislike replacement.
type DailyController = ReturnType<typeof createMobileDailyRecommendations>;
interface Props {
  provider: string; enabled: boolean; signedIn: boolean; queueBusy: boolean; queueError: string;
  play(songs: SongResult[], index: number, started: () => void): void; add(song: SongResult, behavior?: QueueAddBehavior): void;
  navigationChanged(): void;
  actions(song: SongResult, close: () => void): ReactNode;
}
function Sheet({ service, close, ...props }: Props & { service: DailyController; close(): void }) {
  const { t } = useTranslation(), dialog = useRef<HTMLDialogElement>(null);
  const session = useMemo(() => service.createSession(props.provider), [service, props.provider]);
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  useEffect(() => { dialog.current?.showModal(); void session.start(); return () => session.dispose(); }, [session]);
  useEffect(() => () => props.navigationChanged(), [props.navigationChanged]);
  const busy = state.busy || props.queueBusy || state.phase === 'loading' || state.resource?.status === 'loading';
  const failed = state.phase === 'error' || state.resource?.status === 'error' || state.error;
  const songs = state.resource?.tracks ?? [], date = state.mutation?.dailyDate ?? '';
  return <dialog ref={dialog} className="sheet online-catalog-sheet" aria-label={t('mobile.dailyTitle')}
    onClose={event => { if (event.target === event.currentTarget) close(); }} onCancel={event => { if (event.target === event.currentTarget) close(); }}>
    <header><h2>{t('mobile.dailyTitle')}</h2><button onClick={close}>{t('mobile.close')}</button></header>
    {state.phase === 'ready' && <div className="mobile-daily-actions">
      <label>{t('mobile.dailyDate')}<select aria-label={t('mobile.dailyDate')} disabled={busy || failed} value={date}
        onChange={event => void session.selectDate(event.target.value)}>
        <option value="">{t('mobile.dailyToday')}</option>
        {state.mutation?.dailyHistoryDates.map(value => <option key={value} value={value}>{value}</option>)}
      </select></label>
      <button disabled={busy || failed || !!date} onClick={() => void session.selectDate('', true)}>{t('mobile.dailyRefresh')}</button>
    </div>}
    {busy && <p role="status">{t('mobile.loading')}</p>}
    {(failed || state.historyError) && <p role="alert">{t(state.historyError && !failed ? 'mobile.dailyHistoryError' : 'mobile.dailyError')}
      <button disabled={busy} onClick={() => void session.start()}>{t('mobile.dailyReload')}</button></p>}
    {props.queueError && <p role="alert">{t('mobile.' + props.queueError)}</p>}
    {state.mutation?.dailyLimitReached && <p role="status">{t('mobile.dailyLimit')}</p>}
    {state.phase === 'ready' && <div className="online-catalog-pane">
      {songs.length ? <SongList songs={songs} busy={busy || failed}
        play={index => props.play(songs, index, close)} add={props.add}
        libraryActions={(song, dismiss) => <>{props.actions(song, () => { dismiss(); close(); })}
          {!date && <button disabled={busy || failed || !state.mutation?.capabilities.removeEntry.enabled}
            onClick={() => { if (window.confirm(t('mobile.dailyDislikeConfirm', { song: song.name }))) { dismiss(); void session.remove(song); } }}>{t('mobile.dailyDislike')}</button>}</>} />
        : !busy && !failed && <p>{t('mobile.empty')}</p>}
    </div>}
  </dialog>;
}
export default function DailyRecommendations(props: Props) {
  const { t } = useTranslation(), [open, setOpen] = useState(false);
  const service = useMemo(() => createMobileDailyRecommendations(omni, captureProviderSession, flushSessions), []);
  useEffect(() => { setOpen(false); }, [props.provider, props.enabled, props.signedIn]);
  if (props.provider !== 'netease') return null;
  return <>
    <button disabled={!props.enabled || !props.signedIn} onClick={() => setOpen(true)}>{t('mobile.dailyTitle')}</button>
    {!props.enabled && <p className="muted">{t('mobile.dailyUnavailable')}</p>}
    {props.enabled && !props.signedIn && <p className="muted">{t('mobile.dailySignIn')}</p>}
    {open && <Sheet {...props} service={service} close={() => setOpen(false)} />}
  </>;
}
