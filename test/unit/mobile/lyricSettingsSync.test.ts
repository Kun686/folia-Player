import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLyricSettingsStore } from '@/stores/useLyricSettingsStore';
import { connectLyricSettings } from '@/mobile/lyricSettingsSync';

// lyricSettingsSync.test.ts — serialized original preferences and rollback over a controlled native boundary.
const bridge = vi.hoisted(() => ({ getLyricSettings: vi.fn(), setLyricSettings: vi.fn() }));
vi.mock('@/mobile/bridge', () => ({ native: bridge }));
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
let stop: () => void = () => {};
beforeEach(() => {
  vi.resetAllMocks();
  useLyricSettingsStore.getState().handleSetLocalLyricsPriority('local');
  useLyricSettingsStore.getState().handleToggleAutoUseBestLyric(true);
  useLyricSettingsStore.getState().handleSetPreferredAlternativeLyricSource('qq');
  bridge.getLyricSettings.mockResolvedValue({ localLyricsPriority: 'online', autoUseBestLyric: true, preferredAlternativeLyricSource: 'qq' });
  bridge.setLyricSettings.mockImplementation(async ({ settings }) => settings);
});
afterEach(() => stop());
describe('local lyric preference', () => {
  it('restores native priority without writing back and rolls failed edits back to that priority', async () => {
    const report = vi.fn(); stop = connectLyricSettings(report); await settle();
    expect(useLyricSettingsStore.getState().localLyricsPriority).toBe('online');
    expect(bridge.setLyricSettings).not.toHaveBeenCalled();
    bridge.setLyricSettings.mockRejectedValue(new Error('unavailable'));
    useLyricSettingsStore.getState().handleSetLocalLyricsPriority('local'); await settle();
    expect(useLyricSettingsStore.getState().localLyricsPriority).toBe('online');
    expect(bridge.setLyricSettings).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenLastCalledWith(true, true);
  });
  it('keeps a newer choice when an older write fails', async () => {
    let reject!: (error: Error) => void;
    bridge.setLyricSettings.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
    const report = vi.fn(); stop = connectLyricSettings(report); await settle();
    useLyricSettingsStore.getState().handleSetLocalLyricsPriority('local');
    useLyricSettingsStore.getState().handleSetLocalLyricsPriority('online');
    reject(new Error('unavailable')); await settle();
    expect(bridge.setLyricSettings).toHaveBeenLastCalledWith({ settings: { localLyricsPriority: 'online', autoUseBestLyric: true, preferredAlternativeLyricSource: 'qq' } });
    expect(bridge.setLyricSettings).toHaveBeenCalledTimes(2);
    expect(useLyricSettingsStore.getState().localLyricsPriority).toBe('online');
    expect(report).toHaveBeenLastCalledWith(true, false);
  });
  it('ignores initialization after disposal and keeps failed initialization read-only', async () => {
    let finish!: (value: unknown) => void;
    bridge.getLyricSettings.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const report = vi.fn(); stop = connectLyricSettings(report); stop();
    finish({ localLyricsPriority: 'online' }); await settle();
    expect(useLyricSettingsStore.getState().localLyricsPriority).toBe('local');
    expect(report).not.toHaveBeenCalled();
    bridge.getLyricSettings.mockRejectedValue(new Error('unavailable'));
    stop = connectLyricSettings(report); await settle();
    expect(report).toHaveBeenLastCalledWith(false, true);
    useLyricSettingsStore.getState().handleSetLocalLyricsPriority('online'); await settle();
    expect(bridge.setLyricSettings).not.toHaveBeenCalled();
  });
  it('migrates existing frontend preferences without replacing them with native defaults', async () => {
    bridge.getLyricSettings.mockResolvedValue({ localLyricsPriority: 'online' });
    useLyricSettingsStore.getState().handleToggleAutoUseBestLyric(false);
    useLyricSettingsStore.getState().handleSetPreferredAlternativeLyricSource('amll');
    stop = connectLyricSettings(vi.fn()); await settle();
    expect(bridge.setLyricSettings).toHaveBeenCalledExactlyOnceWith({ settings: {
      localLyricsPriority: 'online', autoUseBestLyric: false, preferredAlternativeLyricSource: 'amll',
    } });
  });
  it('keeps an edit made during native initialization and persists all three settings', async () => {
    let finish!: (value: unknown) => void;
    bridge.getLyricSettings.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    stop = connectLyricSettings(vi.fn());
    useLyricSettingsStore.getState().handleSetPreferredAlternativeLyricSource('netease');
    finish({ localLyricsPriority: 'online', autoUseBestLyric: false, preferredAlternativeLyricSource: 'qq' });
    await settle();
    expect(bridge.setLyricSettings).toHaveBeenCalledExactlyOnceWith({ settings: {
      localLyricsPriority: 'local', autoUseBestLyric: true, preferredAlternativeLyricSource: 'netease',
    } });
    expect(useLyricSettingsStore.getState().preferredAlternativeLyricSource).toBe('netease');
  });
  it('reports migration write failure and retries migration on the next connection', async () => {
    bridge.getLyricSettings.mockResolvedValue({ localLyricsPriority: 'online' });
    bridge.setLyricSettings.mockRejectedValueOnce(new Error('disk-full'));
    const report = vi.fn(); stop = connectLyricSettings(report); await settle();
    expect(report).toHaveBeenLastCalledWith(true, true);
    stop(); stop = connectLyricSettings(report); await settle();
    expect(bridge.setLyricSettings).toHaveBeenCalledTimes(2);
    expect(report).toHaveBeenLastCalledWith(true, false);
  });

});
