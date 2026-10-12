import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAutomixSettingsStore } from '../../../src/stores/useAutomixSettingsStore';
import { connectTransitionSettings as connect } from '../../../src/mobile/transitionSettingsSync';

// Original store actions with reordered/failing bridge responses, without audio or account fixtures.
const bridge = vi.hoisted(() => ({ getTransitionSettings: vi.fn(), setTransitionSettings: vi.fn() }));
vi.mock('../../../src/mobile/bridge', () => ({ native: bridge }));
const settings = () => ({ enabled: true, mode: 'crossfade' as const, crossfadeMaxSec: 8, performance: false });
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const connections: (() => void)[] = [];
function connectTransitionSettings(report: (ready: boolean, error: boolean) => void) {
  const stop = connect(report); connections.push(stop); return stop;
}
afterEach(() => { for (const stop of connections.splice(0)) stop(); });
beforeEach(() => {
  vi.resetAllMocks();
  bridge.getTransitionSettings.mockResolvedValue(settings());
  bridge.setTransitionSettings.mockImplementation(async ({ settings }) => settings);
});
describe('native transition settings', () => {
  it('restores the original store from native persistence without a feedback write', async () => {
    const report = vi.fn(), stop = connectTransitionSettings(report);
    await settle();
    expect(useAutomixSettingsStore.getState()).toMatchObject({ automixEnabled: true, transitionMode: 'crossfade', crossfadeMaxSec: 8 });
    expect(bridge.setTransitionSettings).not.toHaveBeenCalled();
    expect(report).toHaveBeenLastCalledWith(true, false); stop();
  });
  it('coalesces duration edits and preserves a subsequent disable across an older failure', async () => {
    let reject!: (reason: unknown) => void;
    bridge.setTransitionSettings.mockImplementationOnce(() => new Promise((_, r) => { reject = r; }));
    const report = vi.fn(), stop = connectTransitionSettings(report); await settle();
    const store = useAutomixSettingsStore.getState();
    store.handleSetCrossfadeMaxSec(10); store.handleSetCrossfadeMaxSec(12); store.handleToggleAutomix(false);
    expect(bridge.setTransitionSettings).toHaveBeenCalledTimes(1);
    reject(new Error('interrupted')); await settle();
    expect(bridge.setTransitionSettings).toHaveBeenCalledTimes(2);
    expect(bridge.setTransitionSettings).toHaveBeenLastCalledWith({ settings: { enabled: false, mode: 'crossfade', crossfadeMaxSec: 12, performance: false } });
    expect(useAutomixSettingsStore.getState()).toMatchObject({ automixEnabled: false, crossfadeMaxSec: 12 });
    expect(report).toHaveBeenLastCalledWith(true, false); stop();
  });
  it('rolls a rejected latest edit back without feedback and keeps selected fallback mode', async () => {
    bridge.getTransitionSettings.mockResolvedValue({ ...settings(), mode: 'automix' });
    const report = vi.fn(), stop = connectTransitionSettings(report); await settle();
    bridge.setTransitionSettings.mockRejectedValue(new Error('bridge-failed'));
    useAutomixSettingsStore.getState().handleSetTransitionMode('crossfade'); await settle();
    expect(useAutomixSettingsStore.getState().transitionMode).toBe('automix');
    expect(bridge.setTransitionSettings).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenLastCalledWith(true, true); stop();
  });
  it('ignores late initialization after unmount and leaves failed initialization read-only', async () => {
    let complete!: (value: unknown) => void;
    bridge.getTransitionSettings.mockImplementationOnce(() => new Promise(r => { complete = r; }));
    const report = vi.fn(), stop = connectTransitionSettings(report); stop();
    complete(settings()); await settle(); expect(report).not.toHaveBeenCalled();
    bridge.getTransitionSettings.mockRejectedValue(new Error('unavailable'));
    const disconnect = connectTransitionSettings(report); await settle();
    useAutomixSettingsStore.getState().handleToggleAutomix(false);
    expect(bridge.setTransitionSettings).not.toHaveBeenCalled();
    expect(report).toHaveBeenLastCalledWith(false, true); disconnect();
  });
  it('restores performance from native storage and writes the original toggle with the other settings', async () => {
    bridge.getTransitionSettings.mockResolvedValue({ ...settings(), mode: 'automix', performance: true });
    const stop = connectTransitionSettings(vi.fn());
    try {
      await settle();
      expect(useAutomixSettingsStore.getState().transitionPerformance).toBe(true);
      expect(bridge.setTransitionSettings).not.toHaveBeenCalled();
      useAutomixSettingsStore.getState().handleToggleTransitionPerformance(false); await settle();
      expect(bridge.setTransitionSettings).toHaveBeenLastCalledWith({ settings: { ...settings(), mode: 'automix', performance: false } });
    } finally { stop(); }
  });
  it('defaults a legacy native response to performance off instead of reviving a web-only preference', async () => {
    useAutomixSettingsStore.getState().handleToggleTransitionPerformance(true);
    bridge.getTransitionSettings.mockResolvedValue({ enabled: true, mode: 'automix', crossfadeMaxSec: 12 });
    const stop = connectTransitionSettings(vi.fn());
    try {
      await settle();
      expect(useAutomixSettingsStore.getState()).toMatchObject({ transitionPerformance: false, crossfadeMaxSec: 12 });
      expect(bridge.setTransitionSettings).not.toHaveBeenCalled();
    } finally { stop(); }
  });
  it('restores the accepted performance value after a failed toggle without another write', async () => {
    const report = vi.fn(), stop = connectTransitionSettings(report);
    try {
      await settle();
      bridge.setTransitionSettings.mockRejectedValue(new Error('bridge-failed'));
      useAutomixSettingsStore.getState().handleToggleTransitionPerformance(true); await settle();
      expect(useAutomixSettingsStore.getState().transitionPerformance).toBe(false);
      expect(bridge.setTransitionSettings).toHaveBeenCalledTimes(1);
      expect(report).toHaveBeenLastCalledWith(true, true);
    } finally { stop(); }
  });
});
