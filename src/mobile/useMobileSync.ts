import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { exportSyncLibraryBundle, importSyncLibraryBundle, syncNow, testSyncProviderConnection } from '../services/sync/syncCoordinator';
import { createSyncLibraryZipBlob, readSyncLibraryZipFile } from '../services/sync/syncArchive';
import { assertSyncCurrent } from '../services/sync/syncConnection';
import { getSyncStatus, subscribeSyncStatus } from '../services/sync/syncConfig';
import { readArchive } from './batchLyricExport';
import { native } from './bridge';
import { cancelMobileSync, loadMobileSyncSettings, mobileSyncConnection, saveMobileSyncSettings } from './syncRuntime';
import type { NativeSyncSettings } from './nativeSync';

// useMobileSync.ts — original coordinator and archive protocol, with write-only token editing and no implicit backup upload.
export function useMobileSync() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<NativeSyncSettings | null>(null);
  const [address, setAddress] = useState(''), [token, setToken] = useState(''), [enabled, setEnabled] = useState(false);
  const [clearToken, setClearToken] = useState(false), [action, setAction] = useState('loading');
  const [message, setMessage] = useState(''), [error, setError] = useState(false);
  const [status, setStatus] = useState(() => getSyncStatus());
  const mounted = useRef(false), locked = useRef(false);
  const populate = (value: NativeSyncSettings) => {
    setSettings(value); setAddress(value.baseURL); setEnabled(value.enabled); setToken(''); setClearToken(false);
  };
  const dirty = !!settings && (address.trim().replace(/\/+$/, '') !== settings.baseURL || enabled !== settings.enabled || !!token || clearToken);
  const run = async (name: string, work: () => Promise<string>) => {
    if (locked.current) return;
    locked.current = true; setAction(name); setMessage(''); setError(false);
    try { const result = await work(); if (mounted.current) setMessage(result); }
    catch (cause) {
      if (mounted.current) {
        const code = cause instanceof Error ? cause.message : '';
        setError(true); setMessage(t(code === 'sync-cancelled' ? 'mobile.sync.cancelled'
          : code === 'sync-local-settings-changed' ? 'mobile.sync.localChanged' : name === 'saving' ? 'mobile.sync.saveFailed' : 'mobile.sync.failed'));
      }
    } finally { locked.current = false; if (mounted.current) setAction(''); }
  };
  const reload = () => run('loading', async () => { const result = await loadMobileSyncSettings(); if (mounted.current) populate(result); return ''; });
  useEffect(() => { mounted.current = true; void reload(); return () => { mounted.current = false; }; }, []);
  useEffect(() => subscribeSyncStatus(() => setStatus(getSyncStatus())), []);
  useEffect(() => setStatus(getSyncStatus()), [settings?.scope]);
  const save = () => run('saving', async () => {
    if (!settings) throw Error('sync-not-configured');
    const result = await saveMobileSyncSettings(settings.revision, { baseURL: address, enabled,
      ...(clearToken ? { token: '' } : token.trim() ? { token } : {}) });
    if (mounted.current) populate(result);
    return t('mobile.sync.saved');
  });
  const test = () => run('testing', async () => {
    if (!await testSyncProviderConnection(mobileSyncConnection())) throw Error('sync-failed');
    return t('ui.storage.syncTestSuccess');
  });
  const sync = (themes: boolean) => run('syncing', async () => {
    const result = await syncNow({ syncThemes: themes, applyRemoteSettings: !themes, pushSettings: !themes }, mobileSyncConnection());
    if (!result) throw Error('sync-failed');
    return themes ? t('ui.storage.syncThemesComplete', { uploaded: result.uploadedThemeCount, downloaded: result.downloadedThemeCount,
      local: result.checkedLocalThemeCount, diff: result.diffBucketCount }) : t('ui.storage.syncSettingsComplete', {
        details: [result.appliedRemoteSettings && t('ui.storage.syncAppliedRemote'), result.pushedLocalSettings && t('ui.storage.syncPushedLocal')].filter(Boolean).join('、'),
      });
  });
  const exportZip = () => run('exporting', async () => {
    const config = mobileSyncConnection(), bundle = await exportSyncLibraryBundle(config);
    if (new TextEncoder().encode(JSON.stringify(bundle)).byteLength > 15_000_000) throw Error('sync-library-too-large');
    const data = await readArchive(createSyncLibraryZipBlob(bundle));
    assertSyncCurrent(config);
    // Existing native archive sharing already validates ZIP bytes and handles iPad anchoring/temporary cleanup.
    const result = await native.shareLyricArchive({ fileName: `folia-sync-${Date.now()}.zip`, data });
    return t(result.completed ? 'mobile.sync.shared' : 'mobile.sync.shareCancelled');
  });
  const importZip = (file: File) => run('importing', async () => {
    const config = mobileSyncConnection();
    if (!file.name.toLowerCase().endsWith('.zip')) throw Error('sync-invalid-archive');
    const bundle = await readSyncLibraryZipFile(file, 16_000_000);
    assertSyncCurrent(config);
    if (!window.confirm(t('mobile.sync.confirmImport'))) return '';
    await importSyncLibraryBundle(bundle, { pushRemote: false }, config);
    window.dispatchEvent(new Event('folia-themes-synced'));
    return t('mobile.sync.imported');
  });
  return { settings, address, setAddress, enabled, setEnabled, token, setToken, clearToken, setClearToken, dirty,
    action, message, error, status, reload, save, test, sync, exportZip, importZip, cancel: cancelMobileSync };
}
