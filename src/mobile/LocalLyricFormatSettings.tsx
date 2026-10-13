import { useTranslation } from 'react-i18next';
import LocalLyricFormatOrderSetting from '../components/modal/settings/LocalLyricFormatOrderSetting';
import FolderImportStatus from './FolderImportStatus';
import type { LocalFolders } from './useLocalFolders';

// LocalLyricFormatSettings.tsx — original order editor with the existing cancellable native folder scanner.
const optionStyle = (selected: boolean) => ({ borderColor: selected ? 'var(--text)' : 'var(--border)',
  backgroundColor: selected ? 'var(--raised)' : 'transparent' });
export default function LocalLyricFormatSettings({ folders, close }: { folders: LocalFolders; close(): void }) {
  const { t } = useTranslation();
  return <div className="sheet-backdrop"><section className="sheet mobile-format-settings" role="dialog" aria-modal="true"
    aria-label={t('options.localLyricFormatOrder')}>
    <header><h2>{t('options.localLyricFormatOrder')}</h2><button onClick={close}>{t('mobile.close')}</button></header>
    <LocalLyricFormatOrderSetting getOptionStyle={optionStyle} touchControls
      resyncDisabled={folders.busy || !folders.catalog?.roots.length}
      onResync={async () => (await folders.rescanAll())?.status === 'complete'} />
    {folders.catalog?.roots.length === 0 && !folders.error && <p className="muted">{t('options.localLyricFormatResyncNoFolders')}</p>}
    <FolderImportStatus folders={folders} />
  </section></div>;
}
