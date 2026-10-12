import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAudioSettingsStore } from '../../../src/stores/useAudioSettingsStore';
import { DEFAULT_AUDIO_EQUALIZER_SETTINGS } from '../../../src/utils/audioEqualizer';
import { connectAudioSettings } from '../../../src/mobile/audioSettingsSync';
import { usePlaybackStore } from '../../../src/stores/usePlaybackStore';

// Real store actions, delayed native responses and failure recovery; no provider/account fixtures.
const bridge = vi.hoisted(() => ({ getAudioSettings: vi.fn(), setAudioSettings: vi.fn() }));
vi.mock('../../../src/mobile/bridge', () => ({ native: bridge }));
const settings = () => ({ volume: 0.6, isMuted: true, equalizer: structuredClone(DEFAULT_AUDIO_EQUALIZER_SETTINGS), replayGainMode: 'track' as const, audioQuality: 'standard' as const });
const settle = async () => { await new Promise(resolve => setTimeout(resolve, 0)); };
beforeEach(() => { vi.resetAllMocks(); bridge.getAudioSettings.mockResolvedValue(settings()); });
describe('native audio settings synchronization', () => {
  it('restores native state without sending stale local defaults back', async () => {
    useAudioSettingsStore.getState().setAudioQuality('hires');
    const report = vi.fn(), disconnect = connectAudioSettings(report);
    await settle();
    expect(useAudioSettingsStore.getState().volume).toBe(0.6);
    expect(useAudioSettingsStore.getState().isMuted).toBe(true);
    expect(usePlaybackStore.getState().replayGainMode).toBe('track');
    expect(useAudioSettingsStore.getState().audioQuality).toBe('standard');
    expect(bridge.setAudioSettings).not.toHaveBeenCalled();
    expect(report).toHaveBeenLastCalledWith(true, false);
    disconnect();
  });
  it('restores old native documents as default-off and persists the original scrobble action', async () => {
    useAudioSettingsStore.getState().handleToggleNeteaseScrobble(true);
    const disconnect = connectAudioSettings(vi.fn()); await settle();
    expect(useAudioSettingsStore.getState().neteaseScrobbleEnabled).toBe(false);
    bridge.setAudioSettings.mockImplementation(async ({ settings }) => settings);
    useAudioSettingsStore.getState().handleToggleNeteaseScrobble(true); await settle();
    expect(bridge.setAudioSettings).toHaveBeenLastCalledWith({ settings: expect.objectContaining({ neteaseScrobbleEnabled: true }) });
    bridge.setAudioSettings.mockRejectedValue(new Error('rejected'));
    useAudioSettingsStore.getState().handleToggleNeteaseScrobble(false); await settle();
    expect(useAudioSettingsStore.getState().neteaseScrobbleEnabled).toBe(true); disconnect();
  });
  it('serializes rapid changes and preserves the newest volume/mute/EQ intent', async () => {
    const report = vi.fn(), disconnect = connectAudioSettings(report);
    await settle();
    let resolve!: (value: unknown) => void;
    bridge.setAudioSettings.mockImplementationOnce(() => new Promise(r => { resolve = r; }))
      .mockImplementation(async ({ settings }) => settings);
    const store = useAudioSettingsStore.getState();
    store.handleSetVolume(0.2); store.handleSetVolume(0.8); store.handleToggleMute();
    store.handleSetAudioEqualizerSettings({ ...store.audioEqualizerSettings, enabled: true, gains: Array(10).fill(3) });
    usePlaybackStore.getState().setReplayGainMode('album');
    store.setAudioQuality('lossless'); store.setAudioQuality('hires');
    expect(bridge.setAudioSettings).toHaveBeenCalledTimes(1);
    resolve({ ...settings(), volume: 0.2 }); await settle();
    expect(bridge.setAudioSettings).toHaveBeenCalledTimes(2);
    expect(bridge.setAudioSettings.mock.calls[1][0].settings).toMatchObject({ volume: 0.8, isMuted: false, equalizer: { enabled: true, gains: Array(10).fill(3) }, replayGainMode: 'album', audioQuality: 'hires' });
    expect(useAudioSettingsStore.getState().audioQuality).toBe('hires');
    expect(useAudioSettingsStore.getState().volume).toBe(0.8);
    disconnect();
  });
  it('rolls rejected settings back to the last native acknowledgement', async () => {
    const report = vi.fn(), disconnect = connectAudioSettings(report); await settle();
    bridge.setAudioSettings.mockRejectedValue(new Error('invalid-audio-settings'));
    useAudioSettingsStore.getState().handleSetVolume(0.1); await settle();
    expect(useAudioSettingsStore.getState().volume).toBe(0.6);
    expect(report).toHaveBeenLastCalledWith(true, true);
    expect(bridge.setAudioSettings).toHaveBeenCalledTimes(1);
    disconnect();
  });
  it('does not restore after unmount and does not write when initialization fails', async () => {
    let resolve!: (value: unknown) => void;
    bridge.getAudioSettings.mockImplementation(() => new Promise(r => { resolve = r; }));
    const report = vi.fn(), disconnect = connectAudioSettings(report); disconnect();
    resolve(settings()); await settle(); expect(report).not.toHaveBeenCalled();
    bridge.getAudioSettings.mockRejectedValue(new Error('bridge-down'));
    const stop = connectAudioSettings(report); await settle();
    useAudioSettingsStore.getState().handleSetVolume(0.5);
    expect(report).toHaveBeenLastCalledWith(false, true);
    expect(bridge.setAudioSettings).not.toHaveBeenCalled(); stop();
  });
  it('rolls a rejected ReplayGain command back without feedback writes', async () => {
    const disconnect = connectAudioSettings(vi.fn()); await settle();
    bridge.setAudioSettings.mockRejectedValue(new Error('invalid-audio-settings'));
    usePlaybackStore.getState().setReplayGainMode('album'); await settle();
    expect(usePlaybackStore.getState().replayGainMode).toBe('track');
    expect(bridge.setAudioSettings).toHaveBeenCalledTimes(1); disconnect();
  });
  it('rolls a rejected quality preference back without changing other settings', async () => {
    const report = vi.fn(), disconnect = connectAudioSettings(report); await settle();
    bridge.setAudioSettings.mockRejectedValue(new Error('invalid-audio-settings'));
    useAudioSettingsStore.getState().setAudioQuality('lossless'); await settle();
    expect(useAudioSettingsStore.getState().audioQuality).toBe('standard');
    expect(useAudioSettingsStore.getState().volume).toBe(0.6);
    expect(report).toHaveBeenLastCalledWith(true, true);
    expect(bridge.setAudioSettings).toHaveBeenCalledTimes(1); disconnect();
  });
});
