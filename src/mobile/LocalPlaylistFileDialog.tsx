import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SongResult } from '../types';
import { parseM3uPlaylist, type LocalPlaylistImportResult } from '../services/localPlaylistM3u';
import { matchM3uPathsToLocalSongs } from '../services/localPlaylistM3uPaths';
import { projectMobileLocalSongs } from './localSongProjection';
import { mobilePlaylistFileName, readMobilePlaylistFile } from './localPlaylistFiles';
import type { LocalPlaylists, PlaylistFileRequest } from './useLocalPlaylists';
import { native } from './bridge';

// LocalPlaylistFileDialog.tsx — preview before commit, fresh catalog on commit, and explicit share cancellation.
export default function LocalPlaylistFileDialog({ controller, request, songs }: {
  controller: LocalPlaylists; request: PlaylistFileRequest; songs: SongResult[];
}) {
  const { t } = useTranslation(), dialog = useRef<HTMLDialogElement>(null), input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState<string | null>(null), [name, setName] = useState('');
  const [reading, setReading] = useState(false), [fileError, setFileError] = useState(false);
  const [result, setResult] = useState<LocalPlaylistImportResult | null>(null);
  const [exported, setExported] = useState<Awaited<ReturnType<LocalPlaylists['storage']['exportM3u']>> | null>(null);
  const [shared, setShared] = useState<boolean | null>(null);
  const mounted = useRef(false);
  const title = t(request.type === 'import' ? 'localMusic.importPlaylist' : 'localMusic.exportPlaylist');
  const busy = reading || controller.busy;
  const close = () => { if (!busy) controller.setFileRequest(null); };
  const loadExport = () => request.type === 'export' && controller.run(async () => {
    const value = await controller.storage.exportM3u(request.playlist.id);
    if (mounted.current) setExported(value);
  });
  useEffect(() => {
    mounted.current = true; dialog.current?.showModal();
    if (request.type === 'export') void loadExport();
    return () => { mounted.current = false; };
  }, []);
  const preview = useMemo(() => text === null ? null : matchM3uPathsToLocalSongs(
    parseM3uPlaylist(text).paths, projectMobileLocalSongs(songs)), [text, songs]);
  const report = result ?? preview;
  const choose = async (file: File) => {
    setReading(true); setFileError(false); setResult(null); setText(null);
    try {
      const value = await readMobilePlaylistFile(file);
      if (mounted.current) { setText(value.text); setName(value.name); }
    } catch { if (mounted.current) setFileError(true); }
    finally { if (mounted.current) setReading(false); }
  };
  return <dialog ref={dialog} className="sheet local-playlist-dialog" aria-label={title}
    onCancel={event => { event.preventDefault(); close(); }} onClose={close}>
    <header><h2>{title}</h2><button disabled={busy} onClick={close}>{t('mobile.close')}</button></header>
    <p className="muted">{t('mobile.playlistFileHint')}</p>
    {request.type === 'import' ? <>
      {/* No accept filter: iOS may disable M3U files whose UTI is unknown. Validate after selection. */}
      <input ref={input} type="file" hidden aria-label={t('mobile.choosePlaylistFile')} onChange={event => {
        const file = event.target.files?.[0]; event.target.value = ''; if (file) void choose(file);
      }} />
      <button disabled={busy} onClick={() => input.current?.click()}>{t('mobile.choosePlaylistFile')}</button>
      {text !== null && <label>{t('localMusic.enterPlaylistName')}
        <input maxLength={256} value={name} disabled={busy || !!result} onChange={event => setName(event.target.value)} />
      </label>}
      {report && <p role="status">{t('mobile.playlistFileCounts', { matched: report.matchedSongIds.length,
        missing: report.unmatchedPaths.length, ambiguous: report.ambiguousPaths.length })}</p>}
      {result ? <p>{t(result.playlist ? 'mobile.playlistFileImported' : 'mobile.playlistFileNoMatches')}</p> :
        <button disabled={busy || !name.trim() || !preview?.matchedSongIds.length} onClick={() => void controller.run(async () => {
          const value = await controller.storage.importM3u(text!, name); if (mounted.current) setResult(value);
        })}>{t('mobile.importMatchedSongs')}</button>}
    </> : <>
      <p>{exported?.name ?? request.playlist.name}</p>
      {exported && exported.missingNames > 0 && <p role="status">{t('mobile.playlistLegacyNames', { count: exported.missingNames })}</p>}
      <button disabled={busy || !exported} onClick={() => void controller.run(async () => {
        setShared(null);
        // Re-read at share time so edits/deletions after opening cannot export a stale list.
        const value = await controller.storage.exportM3u(request.playlist.id);
        setExported(value);
        const outcome = await native.sharePlaylistFile({ fileName: mobilePlaylistFileName(value.name), content: value.content });
        if (mounted.current) setShared(outcome.completed);
      })}>{t('mobile.sharePlaylistFile')}</button>
      {shared !== null && <p role="status">{t(shared ? 'mobile.playlistFileShared' : 'mobile.playlistFileCancelled')}</p>}
    </>}
    {reading && <p role="status">{t('mobile.loading')}</p>}
    {fileError && <p role="alert">{t('mobile.playlistFileError')}</p>}
    {controller.error && <p role="alert">{t('mobile.playlistTransferError')}</p>}
    {request.type === 'export' && !exported && controller.error && <button disabled={busy} onClick={() => void loadExport()}>{t('mobile.retry')}</button>}
  </dialog>;
}
