import { UserRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';

// LibraryAccount.tsx — account management has its own quiet entry, separate from browsing music.
export default function LibraryAccount({ name, busy, logout }: { name: string; busy: boolean; logout(): void }) {
  const { t } = useTranslation();
  return <details className="library-account">
    <summary aria-label={t('mobile.account')}><UserRound size={22} /></summary>
    <div className="library-account-menu"><p>{name}</p>
      <button disabled={busy} onClick={logout}>{t('mobile.logout')}</button>
    </div>
  </details>;
}
