import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAudioSettingsStore } from '../../../src/stores/useAudioSettingsStore';
import { DEFAULT_AUDIO_EQUALIZER_SETTINGS } from '../../../src/utils/audioEqualizer';
import { connectAudioSettings } from '../../../src/mobile/audioSettingsSync';

// Real store actions, delayed native responses and failure recovery; no provider/account fixtures.
const bridge = vi.hoisted(() => ({ getAudioSettings: vi.fn(), setAudioSettings: vi.fn() }));
vi.mock('../../../src/mobile/bridge', () => ({ native: bridge }));
const settings = () => ({ volume: 0.6, isMuted: true, equalizer: structuredClone(DEFAULT_AUDIO_EQUALIZER_SETTINGS) });
const settle = async () => { await new Promise(resolve => setTimeout(resolve, 0)); };
beforeEach(() => { vi.resetAllMocks(); bridge.getAudioSettings.mockResolvedValue(settings()); });
describe('native audio settings synchronization', () => {
  it('restores native state without sending stale local defaults back', async () => {
    const report = vi.fn(), disconnect = connectAudioSettings(report);
    await settle();
    expect(useAudioSettingsStore.getState().volume).toBe(0.6);
    expect(useAudioSettingsStore.getState().isMuted).toBe(true);
    expect(bridge.setAudioSettings).not.toHaveBeenCalled();
    expect(report).toHaveBeenLastCalledWith(true, false);
    disconnect();
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
    expect(bridge.setAudioSettings).toHaveBeenCalledTimes(1);
    resolve({ ...settings(), volume: 0.2 }); await settle();
    expect(bridge.setAudioSettings).toHaveBeenCalledTimes(2);
    expect(bridge.setAudioSettings.mock.calls[1][0].settings).toMatchObject({ volume: 0.8, isMuted: false, equalizer: { enabled: true, gains: Array(10).fill(3) } });
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
});
