import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { clearCacheByCategory, getCacheUsageByCategory } from '../services/db';

// ResourceCacheControls.tsx — original cover/lyric categories, independent of cached audio and local imports.
export default function ResourceCacheControls({ category = 'cover' }: { category?: 'cover' | 'lyrics' }) {
  const { t } = useTranslation();
  const [bytes, setBytes] = useState<number | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(false);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true;
    setError(false);
    void getCacheUsageByCategory().then(usage => { if (active) setBytes(usage[category]); })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [version, category]);
  const clear = async () => {
    if (category === 'lyrics' && !window.confirm(t('mobile.confirmClearLyricCache'))) return;
    setBusy(true); setError(false);
    try { await clearCacheByCategory(category); setBytes((await getCacheUsageByCategory())[category]); }
    catch { setError(true); }
    finally { setBusy(false); }
  };
  return <div className="mobile-cache-controls">
    <p>{t(category === 'cover' ? 'options.covers' : 'options.lyrics')}: {bytes === null ? '—' : `${(bytes / 1048576).toFixed(1)} MB`}</p>
    <button disabled={busy || bytes === null} onClick={() => void clear()}>{t(category === 'cover' ? 'mobile.clearCoverCache' : 'mobile.clearLyricCache')}</button>
    {error && <p role="alert">{t('mobile.cacheError')}</p>}
    {error && bytes === null && <button onClick={() => setVersion(value => value + 1)}>{t('mobile.retry')}</button>}
  </div>;
}
