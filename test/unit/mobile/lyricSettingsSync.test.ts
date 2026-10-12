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
  bridge.getLyricSettings.mockResolvedValue({ localLyricsPriority: 'online' });
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
    expect(bridge.setLyricSettings).toHaveBeenLastCalledWith({ settings: { localLyricsPriority: 'online' } });
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
});
