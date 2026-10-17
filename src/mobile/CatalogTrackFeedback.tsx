import { useTranslation } from 'react-i18next';
import type { ProviderErrorCode } from '../types/onlineMusic';

// CatalogTrackFeedback.tsx — preserve provider error meaning without rendering raw responses or clearing login.
const keys: Partial<Record<ProviderErrorCode, string>> = {
  'auth-required': 'trackAuthError', unavailable: 'trackServiceError', 'invalid-response': 'trackResponseError',
};
export default function CatalogTrackFeedback({ error, code }: { error: boolean; code: ProviderErrorCode | null }) {
  const { t } = useTranslation();
  if (!error) return null;
  return <p role="alert">{t('mobile.' + ((code && keys[code]) || 'trackRequestError'))}</p>;
}
