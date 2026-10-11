import { useTranslation } from 'react-i18next';
import type { LocalFolders } from './useLocalFolders';
import type { NativeFolderImportResult } from '../types/nativeFolder';

// FolderImportStatus.tsx — distinguish committed roots from interrupted work and cap displayed notices.
const errorKey = (code: string) => code === 'folder-access-required' ? 'accessRequired'
  : code === 'folder-file-changed' || code === 'local-library-changed' ? 'changed'
    : code === 'folder-cancelled' ? 'cancelled' : 'error';
function Notices({ results }: { results: (NativeFolderImportResult & { name?: string })[] }) {
  const { t } = useTranslation();
  const total = results.reduce((count, result) => count + result.warnings.length, 0);
  if (!total) return null;
  const notices: { path: string; code: string }[] = [];
  for (const result of results) {
    for (const warning of result.warnings.slice(0, 100 - notices.length)) {
      notices.push({ ...warning, path: result.name ? `${result.name}/${warning.path}` : warning.path });
    }
    if (notices.length === 100) break;
  }
  return <details><summary>{t('mobile.folders.warnings', { count: total })}</summary>
    <ul>{notices.map((warning, index) => <li key={index}>{warning.path} — {t(warning.code === 'unsupported-audio'
      ? 'mobile.folders.unsupported' : 'mobile.folders.sidecarUnavailable')}</li>)}</ul>
    {total > notices.length && <p>{t('mobile.folders.warningLimit')}</p>}
  </details>;
}
export default function FolderImportStatus({ folders }: { folders: LocalFolders }) {
  const { t } = useTranslation(), { progress, batchProgress, batchResult } = folders;
  return <div className="folder-import-status">
    {folders.busy && <div role="status">
      {batchProgress && <p>{t('mobile.folders.batchProgress', { current: batchProgress.completed + 1, total: batchProgress.total, name: batchProgress.root.name })}</p>}
      <p>{progress ? t('mobile.folders.progress', { completed: progress.completed, total: progress.total })
        : t(!folders.canCancel ? 'mobile.folders.removing' : batchProgress ? 'mobile.folders.scanWaiting' : 'mobile.folders.scanning')}</p>
      {progress?.path && <small>{progress.path}</small>}
      {progress && <progress aria-label={t('mobile.folders.importProgress')} max={Math.max(1, progress.total)} value={progress.completed} />}
      {folders.canCancel && <button onClick={folders.cancel}>{t('mobile.cancel')}</button>}
    </div>}
    {folders.error && <p role="alert">{t('mobile.folders.' + errorKey(folders.error))}</p>}
    {folders.result && <div role="status"><p>{t('mobile.folders.complete', { count: folders.result.count })}</p><Notices results={[folders.result]} /></div>}
    {batchResult && <div role="status">
      <p>{t('mobile.folders.' + (batchResult.status === 'complete' ? 'batchComplete' : 'batchStopped'),
        { completed: batchResult.completed.length, total: batchResult.total })}</p>
      {batchResult.status !== 'complete' && <p>{t('mobile.folders.batchRetained')}</p>}
      <Notices results={batchResult.completed} />
      {batchResult.failed && <div role="alert"><p>{batchResult.failed.name} — {t('mobile.folders.' + errorKey(batchResult.failed.code))}</p>
        {batchResult.failed.code === 'folder-access-required' && <button disabled={folders.busy}
          onClick={() => void folders.start({ rootID: batchResult.failed!.id, pick: true })}>{t('mobile.folders.reauthorize')}</button>}
      </div>}
    </div>}
  </div>;
}
