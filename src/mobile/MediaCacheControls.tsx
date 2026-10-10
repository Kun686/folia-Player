import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import MediaCacheSettingsSection from '../components/modal/settings/MediaCacheSettingsSection';
import { useAudioSettingsStore } from '../stores/useAudioSettingsStore';
import { native } from './bridge';
import type { useMediaCache } from './useMediaCache';

// MediaCacheControls.tsx — original leaf settings; clear affects managed audio only, never local imports.
export default function MediaCacheControls({ cache, light }: { cache: ReturnType<typeof useMediaCache>; light: boolean }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false), [error, setError] = useState(false);
  const settings = useAudioSettingsStore(useShallow(s => ({ enabled: s.enableMediaCache, limit: s.mediaCacheLimitGb,
    toggle: s.handleToggleMediaCache, limitChanged: s.handleSetMediaCacheLimitGb })));
  const clear = async () => {
    if (!window.confirm(t('mobile.confirmClearMediaCache'))) return;
    setBusy(true); setError(false);
    try { await native.clearMediaCache(); } catch { setError(true); } finally { setBusy(false); }
  };
  return <>
    {!cache.ready && cache.error && <button onClick={cache.retry}>{t('mobile.retry')}</button>}
    <fieldset disabled={!cache.ready || busy} className="mobile-cache-controls">
    <MediaCacheSettingsSection cacheDirectory="" cacheDirectoryIsDefault cacheDirectoryStatus="idle"
      enableMediaCache={settings.enabled} isDaylight={light} isElectron={false} showLimit
      mediaCacheLimitGb={settings.limit} mediaCount={cache.state?.count ?? 0}
      mediaSize={`${((cache.state?.bytes ?? 0) / 1048576).toFixed(1)} MB`}
      onSetMediaCacheLimitGb={settings.limitChanged} onToggleMediaCache={settings.toggle}
      settingsCardClass="border-white/10" toggleOffBackgroundClass="bg-white/20" />
    <button disabled={!cache.state?.count && !cache.state?.pending} onClick={() => void clear()}>{t('mobile.clearMediaCache')}</button>
    {!!cache.state?.pending && <p role="status">{t('mobile.cachePending', { count: cache.state.pending })}</p>}
    {(cache.error || cache.state?.error || error) && <p role="alert">{t('mobile.cacheError')}</p>}
  </fieldset></>;
}
