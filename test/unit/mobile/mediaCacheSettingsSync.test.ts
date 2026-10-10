import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAudioSettingsStore } from '../../../src/stores/useAudioSettingsStore';
import { connectMediaCacheSettings } from '../../../src/mobile/mediaCacheSettingsSync';

// mediaCacheSettingsSync.test.ts — original settings, native authority, coalescing and failure recovery.
const bridge = vi.hoisted(() => ({ getMediaCacheSettings: vi.fn(), setMediaCacheSettings: vi.fn() }));
vi.mock('../../../src/mobile/bridge', () => ({ native: bridge }));
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
beforeEach(() => {
  vi.resetAllMocks();
  bridge.getMediaCacheSettings.mockResolvedValue({ enabled: false, limitGB: 5 });
  bridge.setMediaCacheSettings.mockImplementation(async ({ settings }) => settings);
});
describe('native media cache settings', () => {
  it('restores authoritative settings without writing them back', async () => {
    const report = vi.fn(), stop = connectMediaCacheSettings(report);
    await settle();
    expect(useAudioSettingsStore.getState()).toMatchObject({ enableMediaCache: false, mediaCacheLimitGb: 5 });
    expect(bridge.setMediaCacheSettings).not.toHaveBeenCalled();
    expect(report).toHaveBeenLastCalledWith(true, false); stop();
  });
  it('coalesces edits, supports unlimited and ignores an older failure', async () => {
    let reject!: (error: Error) => void;
    bridge.setMediaCacheSettings.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
    const report = vi.fn(), stop = connectMediaCacheSettings(report); await settle();
    const store = useAudioSettingsStore.getState();
    store.handleToggleMediaCache(true); store.handleSetMediaCacheLimitGb(10); store.handleSetMediaCacheLimitGb(0);
    reject(new Error('interrupted')); await settle();
    expect(bridge.setMediaCacheSettings).toHaveBeenCalledTimes(2);
    expect(bridge.setMediaCacheSettings).toHaveBeenLastCalledWith({ settings: { enabled: true, limitGB: 0 } });
    expect(report).toHaveBeenLastCalledWith(true, false); stop();
  });
  it('restores rejected settings and does not write after disconnect', async () => {
    const report = vi.fn(), stop = connectMediaCacheSettings(report); await settle();
    bridge.setMediaCacheSettings.mockRejectedValue(new Error('disk-full'));
    useAudioSettingsStore.getState().handleToggleMediaCache(true); await settle();
    expect(useAudioSettingsStore.getState().enableMediaCache).toBe(false);
    expect(report).toHaveBeenLastCalledWith(true, true); stop();
    useAudioSettingsStore.getState().handleSetMediaCacheLimitGb(2);
    expect(bridge.setMediaCacheSettings).toHaveBeenCalledTimes(1);
  });
});
