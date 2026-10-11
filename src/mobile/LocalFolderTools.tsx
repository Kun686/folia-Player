import { ChevronLeft, ChevronRight, Folder, FolderPlus } from 'lucide-react';
import { List, type RowComponentProps } from 'react-window';
import { useTranslation } from 'react-i18next';
import type { LocalFolders } from './useLocalFolders';
import { parentFolderScope, type FolderChoice, type FolderScope, type localFolderView } from './localFolderBrowser';

// LocalFolderTools.tsx — existing library surfaces, touch-sized folder navigation and explicit app-only removal.
interface RowProps { choices: FolderChoice[]; select(scope: FolderScope): void }
function Row({ index, style, choices, select }: RowComponentProps<RowProps>) {
  const { t } = useTranslation(), item = choices[index];
  return <div style={style}><button className="folder-choice" onClick={() => select(item)}>
    <Folder size={20} /><span><strong>{item.name}</strong><small>{item.ignored ? t('mobile.folders.ignored') : t('mobile.folders.count', { count: item.count })}</small></span><ChevronRight size={18} />
  </button></div>;
}
export function FolderImportStatus({ folders }: { folders: LocalFolders }) {
  const { t } = useTranslation(), progress = folders.progress;
  return <div className="folder-import-status">
    {folders.busy && <div role="status"><p>{progress ? t('mobile.folders.progress', { completed: progress.completed, total: progress.total }) : t(folders.canCancel ? 'mobile.folders.scanning' : 'mobile.folders.removing')}</p>
      {progress?.path && <small>{progress.path}</small>}
      {progress && <progress aria-label={t('mobile.folders.importProgress')} max={Math.max(1, progress.total)} value={progress.completed} />}
      {folders.canCancel && <button onClick={folders.cancel}>{t('mobile.cancel')}</button>}</div>}
    {folders.error && <p role="alert">{t(folders.error === 'folder-access-required' ? 'mobile.folders.accessRequired'
      : folders.error === 'folder-file-changed' || folders.error === 'local-library-changed' ? 'mobile.folders.changed'
        : folders.error === 'folder-cancelled' ? 'mobile.folders.cancelled' : 'mobile.folders.error')}</p>}
    {folders.result && <div role="status"><p>{t('mobile.folders.complete', { count: folders.result.count })}</p>
      {folders.result.warnings.length > 0 && <details><summary>{t('mobile.folders.warnings', { count: folders.result.warnings.length })}</summary>
        <ul>{folders.result.warnings.slice(0, 100).map((warning, index) => <li key={index}>{warning.path} — {t(warning.code === 'unsupported-audio'
          ? 'mobile.folders.unsupported' : 'mobile.folders.sidecarUnavailable')}</li>)}</ul>
        {folders.result.warnings.length > 100 && <p>{t('mobile.folders.warningLimit')}</p>}
      </details>}
    </div>}
  </div>;
}
export default function LocalFolderTools({ folders, view, select, query }: {
  folders: LocalFolders; view: ReturnType<typeof localFolderView>; select(scope: FolderScope | null): void; query: string;
}) {
  const { t } = useTranslation(), { root, path, ignored } = view;
  const confirm = (message: string, action: () => void) => { if (window.confirm(message)) action(); };
  const choices = view.choices.filter(item => item.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <section className="local-folders" aria-label={t('mobile.folders.title')}>
    {root && <div className="folder-scope">
      <button aria-label={t('mobile.folders.parent')} onClick={() => select(parentFolderScope({ rootID: root.id, path }))}><ChevronLeft /></button>
      <div><h3>{path || root.name}</h3><small>{t('mobile.folders.count', { count: view.songs.length })}</small></div>
    </div>}
    <div className="folder-actions">
      <button disabled={folders.busy} onClick={() => void folders.start()}><FolderPlus size={18} />{t('localMusic.importFolder')}</button>
      {root && <>
        <button disabled={folders.busy} onClick={() => void folders.start({ rootID: root.id })}>{t('mobile.folders.rescan')}</button>
        {folders.error === 'folder-access-required' && <button disabled={folders.busy} onClick={() => void folders.start({ rootID: root.id, pick: true })}>{t('mobile.folders.reauthorize')}</button>}
        {path && <button disabled={folders.busy} onClick={() => {
          if (ignored) void folders.start({ rootID: root.id, ignoredPaths: root.ignoredPaths.filter(item => item !== path && !path.startsWith(item + '/')) });
          else confirm(t('mobile.folders.confirmIgnore', { name: path }), () => { void folders.start({ rootID: root.id, ignoredPaths: [...root.ignoredPaths, path] }); });
        }}>{t(ignored ? 'mobile.folders.restore' : 'mobile.folders.ignore')}</button>}
        {!path && <button disabled={folders.busy} onClick={() => confirm(t('mobile.folders.confirmRemove', { name: root.name }), () => { void folders.remove(root.id); })}>{t('mobile.folders.remove')}</button>}
      </>}
    </div>
    {choices.length > 0 && <List className="folder-choices" style={{ height: Math.min(240, choices.length * 64), flexShrink: 0 }}
      rowComponent={Row} rowCount={choices.length} rowHeight={64} rowProps={{ choices, select }} overscanCount={2} />}
    {!root && !choices.length && <p className="muted">{t('mobile.folders.empty')}</p>}
  </section>;
}
