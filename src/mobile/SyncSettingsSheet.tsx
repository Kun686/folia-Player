import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useMobileSync } from './useMobileSync';

// SyncSettingsSheet.tsx — reuse original sync actions in the existing mobile sheet; native music configuration remains separate.
export default function SyncSettingsSheet({ close }: { close(): void }) {
  const { t } = useTranslation(), sync = useMobileSync(), file = useRef<HTMLInputElement>(null);
  const busy = !!sync.action, configured = sync.settings?.hasToken && sync.settings.baseURL;
  return <div className="sheet-backdrop"><section className="sheet mobile-sync-settings" role="dialog" aria-modal="true" aria-label={t('options.r2Sync')}>
    <header><h2>{t('options.r2Sync')}</h2><button disabled={busy} onClick={close}>{t('mobile.close')}</button></header>
    <p>{t('mobile.sync.hint')}</p>
    <form onSubmit={event => { event.preventDefault(); void sync.save(); }}><fieldset disabled={busy || !sync.settings}>
      <label className="check-label"><input type="checkbox" checked={sync.enabled} onChange={e => sync.setEnabled(e.target.checked)} />{t('options.r2SyncEnable')}</label>
      <label>{t('options.r2SyncWorkerUrl')}<input type="url" inputMode="url" autoCapitalize="none" autoCorrect="off" maxLength={2048}
        value={sync.address} onChange={e => sync.setAddress(e.target.value)} placeholder="https://sync.example.com" /></label>
      <p className="muted">{t('mobile.sync.addressHint')}</p>
      <p>{t(sync.settings?.hasToken ? 'mobile.sync.tokenSaved' : 'mobile.sync.tokenMissing')}</p>
      <label>{t('options.r2SyncToken')}<input type="password" autoComplete="off" autoCapitalize="none" autoCorrect="off" maxLength={8192}
        disabled={sync.clearToken} value={sync.token} onChange={e => sync.setToken(e.target.value)} placeholder={t('mobile.sync.tokenHint')} /></label>
      <label className="check-label"><input type="checkbox" checked={sync.clearToken} disabled={!sync.settings?.hasToken}
        onChange={e => { sync.setClearToken(e.target.checked); sync.setToken(''); if (e.target.checked) sync.setEnabled(false); }} />{t('mobile.sync.clearToken')}</label>
      <button className="solid" type="submit" disabled={!sync.dirty}>{t('options.r2SyncSave')}</button>
    </fieldset></form>
    {sync.dirty && <p>{t('mobile.sync.dirty')}</p>}
    <div className="mobile-sync-actions">
      <button disabled={busy || sync.dirty || !configured} onClick={() => void sync.test()}>{t('options.r2SyncTest')}</button>
      <button disabled={busy || sync.dirty || !configured || !sync.settings?.enabled} onClick={() => void sync.sync(true)}>{t('options.r2SyncNow')}</button>
      <button disabled={busy || sync.dirty || !configured || !sync.settings?.enabled} onClick={() => void sync.sync(false)}>{t('options.syncVisualSettings')}</button>
      <button disabled={busy || sync.dirty || !sync.settings} onClick={() => void sync.exportZip()}>{t('options.r2SyncExportLibrary')}</button>
      <button disabled={busy || sync.dirty || !sync.settings} onClick={() => file.current?.click()}>{t('options.r2SyncImportLibrary')}</button>
    </div>
    <p className="muted">{t('mobile.sync.backupHint')}</p>
    {/* iOS can gray out files with unrecognized UTIs; validate the selected name and bounded ZIP content after selection. */}
    <input ref={file} hidden type="file" aria-label={t('options.r2SyncImportLibrary')} onChange={event => {
      const selected = event.target.files?.[0]; event.target.value = ''; if (selected) void sync.importZip(selected);
    }} />
    {busy && <p role="status">{t('mobile.loading')}</p>}
    {['syncing', 'testing'].includes(sync.action) && <button onClick={sync.cancel}>{t('mobile.sync.cancel')}</button>}
    {sync.message && <p role={sync.error ? 'alert' : 'status'}>{sync.message}</p>}
    {!busy && !sync.message && <p>{sync.status.state === 'error' ? t('mobile.sync.failed') : sync.status.lastSyncAt
      ? `${t('options.r2SyncLastSync')}: ${new Date(sync.status.lastSyncAt).toLocaleString()}` : t('options.r2SyncStatusIdle')}</p>}
    {sync.error && <button disabled={busy} onClick={() => void sync.reload()}>{t('mobile.sync.reload')}</button>}
  </section></div>;
}
