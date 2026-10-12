import { useTranslation } from 'react-i18next';
import { useAudioSettingsStore } from '../stores/useAudioSettingsStore';
import type { PlaybackSnapshot } from './bridge';

// ListeningControl.tsx — original opt-in action and copy, with native account/capability readiness.
export default function ListeningControl({ saved, state }: { saved: boolean; state: PlaybackSnapshot['listening'] }) {
  const { t } = useTranslation();
  const enabled = useAudioSettingsStore(s => s.neteaseScrobbleEnabled);
  const toggle = useAudioSettingsStore(s => s.handleToggleNeteaseScrobble);
  const hint = state?.error === 'auth-required' ? t('options.neteaseScrobbleSignInHint')
    : state?.error === 'checking' ? t('mobile.listeningChecking')
    : !state?.ready ? t('mobile.listeningUnavailable')
    : state.error ? t('mobile.listeningFailed') : null;
  return <details className="replay-gain-disclosure"><summary>{t('options.scrobbleSettings')}</summary>
    <label className="listening-toggle"><input type="checkbox" checked={enabled}
      disabled={!saved || (!enabled && !state?.ready)} aria-describedby="listening-hint"
      onChange={event => toggle(event.target.checked)} />{t('options.neteaseScrobble')}</label>
    <p className="quality-hint" id="listening-hint">{t('options.neteaseScrobbleDesc')}</p>
    {hint && <p className="quality-hint" role="status">{hint}</p>}
  </details>;
}
