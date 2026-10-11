import { useEffect, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { useAudioSettingsStore } from '../stores/useAudioSettingsStore';
import AudioEqualizerDialog from '../components/panelTab/AudioEqualizerDialog';
import { connectAudioSettings } from './audioSettingsSync';
import type { Theme } from '../types';
import type { PlaybackSnapshot } from './bridge';
import { isNeutralAudioEffects } from '../utils/audioEffects';
import ReplayGainControl from '../components/panelTab/ReplayGainControl';
import { usePlaybackStore } from '../stores/usePlaybackStore';
import type { ReplayGainInfo } from '../types';

// src/mobile/AudioControls.tsx — existing store/actions/dialog; AVPlayer owns the audible settings.
export default function AudioControls({ light, theme, unavailable, effects, replayGain }: {
  light: boolean; theme: Theme; unavailable: boolean; effects: PlaybackSnapshot['audioEffects'];
  replayGain?: ReplayGainInfo;
}) {
  const { t } = useTranslation();
  const [status, setStatus] = useState({ ready: false, error: false });
  const [attempt, setAttempt] = useState(0);
  const replayGainMode = usePlaybackStore(s => s.replayGainMode);
  const setReplayGainMode = usePlaybackStore(s => s.setReplayGainMode);
  const audio = useAudioSettingsStore(useShallow(s => ({
    volume: s.volume, isMuted: s.isMuted, enabled: s.audioEqualizerSettings.enabled,
    effectsRequested: s.audioEqualizerSettings.enabled && !isNeutralAudioEffects(s.audioEqualizerSettings.effects),
    handleSetVolume: s.handleSetVolume, handleToggleMute: s.handleToggleMute, openAudioEqualizer: s.openAudioEqualizer,
  })));
  useEffect(() => connectAudioSettings((ready, error) => setStatus({ ready, error })), [attempt]);
  const effectMessage = !audio.effectsRequested ? undefined : effects?.error === 'unsupported-effect-format'
    ? t('mobile.effectsFormatUnavailable') : effects?.error ? t('mobile.effectsFailed') : effects?.pending ? t('mobile.effectsPreparing') : undefined;
  const message = status.error ? t('mobile.audioSettingsError') : audio.enabled && unavailable ? t('mobile.equalizerUnavailable') : effectMessage;
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
    <fieldset disabled={!status.ready} className="replay-gain-controls">
      <ReplayGainControl isDaylight={light} values={replayGain} mode={replayGainMode} onChangeMode={setReplayGainMode} />
    </fieldset>
    {message && <p role="alert">{message}</p>}
    {!status.ready && status.error && <button onClick={() => setAttempt(a => a + 1)}>{t('mobile.retry')}</button>}
    <AudioEqualizerDialog isDaylight={light} theme={theme} mobileLayout commitOnInput statusMessage={message} />
  </div>;
}
