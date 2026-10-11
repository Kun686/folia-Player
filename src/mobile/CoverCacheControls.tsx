import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { clearCacheByCategory, getCacheUsageByCategory } from '../services/db';

// CoverCacheControls.tsx — original cover category, independent of cached audio and imported album art.
export default function CoverCacheControls() {
  const { t } = useTranslation();
  const [bytes, setBytes] = useState<number | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(false);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true;
    setError(false);
    void getCacheUsageByCategory().then(usage => { if (active) setBytes(usage.cover); })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [version]);
  const clear = async () => {
    setBusy(true); setError(false);
    try { await clearCacheByCategory('cover'); setBytes((await getCacheUsageByCategory()).cover); }
    catch { setError(true); }
    finally { setBusy(false); }
  };
  return <div className="mobile-cache-controls">
    <p>{t('options.covers')}: {bytes === null ? '—' : `${(bytes / 1048576).toFixed(1)} MB`}</p>
    <button disabled={busy || bytes === null} onClick={() => void clear()}>{t('mobile.clearCoverCache')}</button>
    {error && <p role="alert">{t('mobile.cacheError')}</p>}
    {error && bytes === null && <button onClick={() => setVersion(value => value + 1)}>{t('mobile.retry')}</button>}
  </div>;
}
