import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { NativeLibrarySnapshot } from '../types/nativeLibrary';
import type { LocalMatchSnapshot } from '../types/localSongMatch';
import type { OnlineMetadataSource } from '../utils/onlineMetadataCandidate';
import { FolderAutoMatchEditor } from '../components/local-library-entity/FolderAutoMatchEditor';
import { LocalSongMetadataMatchDialog } from '../components/modal/LocalSongMetadataMatchDialog';
import { useImportedSnapshotForLocalSong } from '../services/localSongMetadataMatchService';
import { localMatchStorage } from './localMatchStorage';
import { metadataSong, mobileMetadataServices } from './localMetadataMatch';

// LocalMetadataManager.tsx — original folder metadata editor in a touch-accessible modal, scoped to complete local folders.
function ManualMatch({ id, light, services, close, changed, busy }: {
  id: string; light: boolean; services: ReturnType<typeof mobileMetadataServices>; close(): void;
  changed(): Promise<void>; busy(value: boolean): void;
}) {
  const { t } = useTranslation(), active = useRef(true), receipt = useRef<LocalMatchSnapshot | undefined>(undefined);
  const [snapshot, setSnapshot] = useState<LocalMatchSnapshot>(), [error, setError] = useState(false), [retry, setRetry] = useState(0);
  useEffect(() => {
    active.current = true; setError(false);
    void services.read(id, false, true).then(value => { if (active.current) setSnapshot(value); })
      .catch(() => { if (active.current) setError(true); });
    return () => { active.current = false; };
  }, [id, retry, services]);
  if (!snapshot) return <section className="mobile-metadata-loading">
    <button onClick={close}>{t('mobile.close')}</button>
    {error ? <><p role="alert">{t('mobile.lyricEditError')}</p><button onClick={() => setRetry(n => n + 1)}>{t('mobile.retry')}</button></>
      : <p role="status">{t('localMusic.loadingLyrics')}</p>}
  </section>;
  return <div className="mobile-metadata-single"><LocalSongMetadataMatchDialog song={metadataSong(snapshot)}
    assignment={snapshot.assignment} isDaylight={light} localCover={snapshot.embeddedCover}
    sources={services.sources} onClose={close} onChanged={changed} onBusyChange={busy} services={{
      search: async (...args) => {
        const next = await services.read(id, true, false, args[3]?.signal);
        if (next.contextToken !== snapshot.contextToken) throw new Error('local-library-changed');
        const result = await services.search(...args);
        args[3]?.signal?.throwIfAborted();
        if (!active.current) throw new DOMException('Canceled', 'AbortError');
        receipt.current = next;
        return result;
      },
      apply: async (_song, candidate, options) => {
        if (!receipt.current || !active.current) throw new Error('local-library-unavailable');
        return services.applySnapshot(receipt.current, candidate, options);
      },
      restore: async songId => { await useImportedSnapshotForLocalSong(songId, localMatchStorage(snapshot, () => active.current, true).apply); },
    }} /></div>;
}

function MetadataDialog({ snapshot, ids, label, sources, light, changed, close }: {
  snapshot: NativeLibrarySnapshot; ids: Set<string>; label: string; sources: readonly OnlineMetadataSource[];
  light: boolean; changed(): Promise<void>; close(): void;
}) {
  const { t } = useTranslation(), dialog = useRef<HTMLDialogElement>(null), active = useRef(true);
  const [busy, setBusy] = useState(false), [manual, setManual] = useState<string>();
  const services = useMemo(() => mobileMetadataServices(sources, () => active.current), [sources]);
  useEffect(() => { active.current = true; dialog.current?.showModal(); return () => { active.current = false; }; }, []);
  const dismiss = () => { if (!busy) { if (manual) setManual(undefined); else close(); } };
  return <dialog ref={dialog} className="mobile-entity-dialog mobile-metadata-dialog" aria-label={t('localMusic.batchMetadataMatch')}
    onCancel={event => { event.preventDefault(); dismiss(); }}>
    {manual ? <ManualMatch key={manual} id={manual} light={light} services={services} busy={setBusy}
      changed={changed} close={() => { setBusy(false); setManual(undefined); }} /> : <>
      <header><h2>{label}</h2><button disabled={busy} onClick={dismiss}>{t('mobile.close')}</button></header>
      <div className="mobile-metadata-batch"><FolderAutoMatchEditor songs={snapshot.editorSongs.filter(song => ids.has(song.id))}
        assignments={snapshot.assignments} isDaylight={light} onChanged={changed} services={services}
        onManualMatch={song => setManual(song.id)} onBusyChange={setBusy} /></div>
    </>}
  </dialog>;
}

export default function LocalMetadataManager({ snapshot, ids, label, providers, light, changed }: {
  snapshot: NativeLibrarySnapshot; ids: string[]; label: string; providers: string[]; light: boolean; changed(): Promise<void>;
}) {
  const { t } = useTranslation(), [open, setOpen] = useState(false);
  const sources = useMemo(() => (['netease', 'qq', 'kugou'] as const).filter(source => providers.includes(source)), [providers]);
  const selected = useMemo(() => new Set(ids), [ids]);
  return <>
    <button className="local-entity-edit" disabled={!ids.length} onClick={() => setOpen(true)}>{t('localMusic.batchMetadataMatch')}</button>
    {open && <MetadataDialog snapshot={snapshot} ids={selected} label={label} sources={sources} light={light} changed={changed} close={() => setOpen(false)} />}
  </>;
}
