import { useTranslation } from 'react-i18next';
import { omni } from '../services/onlineMusic/omni';
import type { PlaybackSnapshot } from './bridge';
import type { playbackEn } from './localePlayback';

// PlayerFeedback.tsx — native playback failures take precedence over transient command feedback.
const keys: Record<string, keyof typeof playbackEn> = {
  'auth-required': 'auth', 'gateway-auth-required': 'gateway',
  network: 'network', 'network-timeout': 'network', 'rate-limited': 'rateLimited',
  unavailable: 'unavailable', 'audio-failed': 'audio', 'audio-session': 'audioSession', 'state-unavailable': 'state',
};
export default function PlayerFeedback({ state, commandError, otherError, retryLyrics, className = 'player-error' }: {
  state: PlaybackSnapshot; commandError: boolean; otherError: boolean; retryLyrics?: () => void; className?: string;
}) {
  const { t } = useTranslation();
  if (!state.error && !commandError && !otherError && !retryLyrics) return null;
  if (!state.error && !commandError && !otherError && retryLyrics) return <div className={`${className} lyric-retry`} role="alert">
    <span>{t('mobile.lyricsLoadError')}</span>
    <button onClick={retryLyrics}>{t('mobile.retryLyrics')}</button>
  </div>;
  const source = state.currentSong?.sourceRef;
  const provider = source?.kind === 'online' ? omni.getProviderLabel(source.providerId) : t('mobile.playback.platform');
  const key = state.error ? `mobile.playback.${Object.hasOwn(keys, state.error) ? keys[state.error] : 'failed'}`
    : commandError ? 'mobile.playback.command' : 'mobile.error';
  return <p className={className} role="alert">{t(key, { provider })}</p>;
}
