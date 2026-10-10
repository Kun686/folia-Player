import { useEffect, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { useAudioSettingsStore } from '../stores/useAudioSettingsStore';
import AudioEqualizerDialog from '../components/panelTab/AudioEqualizerDialog';
import { connectAudioSettings } from './audioSettingsSync';
import type { Theme } from '../types';

// src/mobile/AudioControls.tsx — existing store/actions/dialog; AVPlayer owns the audible settings.
export default function AudioControls({ light, theme, unavailable }: { light: boolean; theme: Theme; unavailable: boolean }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState({ ready: false, error: false });
  const [attempt, setAttempt] = useState(0);
  const audio = useAudioSettingsStore(useShallow(s => ({
    volume: s.volume, isMuted: s.isMuted, enabled: s.audioEqualizerSettings.enabled,
    handleSetVolume: s.handleSetVolume, handleToggleMute: s.handleToggleMute, openAudioEqualizer: s.openAudioEqualizer,
  })));
  useEffect(() => connectAudioSettings((ready, error) => setStatus({ ready, error })), [attempt]);
  const message = status.error ? t('mobile.audioSettingsError') : audio.enabled && unavailable ? t('mobile.equalizerUnavailable') : undefined;
  return <div className="audio-controls">
    <div className="volume-controls">
      <button disabled={!status.ready} onClick={audio.handleToggleMute} aria-pressed={audio.isMuted} aria-label={t('commandPalette.commands.playback-mute.title')}>
        {audio.isMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
      </button>
      <input type="range" aria-label={t('ui.volume')} min={0} max={1} step={0.01} value={audio.volume}
        disabled={!status.ready} onChange={event => audio.handleSetVolume(Number(event.target.value))} />
      <output>{Math.round(audio.volume * 100)}%</output>
      <button disabled={!status.ready} onClick={audio.openAudioEqualizer}>{t('ui.equalizerTitle')}</button>
    </div>
    {message && <p role="alert">{message}</p>}
    {!status.ready && status.error && <button onClick={() => setAttempt(a => a + 1)}>{t('mobile.retry')}</button>}
    <AudioEqualizerDialog isDaylight={light} theme={theme} equalizerOnly commitOnInput statusMessage={message} />
  </div>;
}
