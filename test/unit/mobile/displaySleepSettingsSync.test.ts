import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDesktopSettingsStore } from '../../../src/stores/useDesktopSettingsStore';
import { connectDisplaySleepSettings } from '../../../src/mobile/displaySleepSettingsSync';

// displaySleepSettingsSync.test.ts — delayed native acknowledgement and original-store recovery.
const bridge = vi.hoisted(() => ({ getDisplaySleepSettings: vi.fn(), setDisplaySleepSettings: vi.fn() }));
vi.mock('../../../src/mobile/bridge', () => ({ native: bridge }));
const settle = async () => { await new Promise(resolve => setTimeout(resolve, 0)); };
let disconnect = () => {};
const set = (enabled: boolean) => useDesktopSettingsStore.getState().handleTogglePreventDisplaySleepDuringPlayback(enabled);
const enabled = () => useDesktopSettingsStore.getState().preventDisplaySleepDuringPlayback;
beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('window', {});
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
  vi.resetAllMocks(); useDesktopSettingsStore.setState({ preventDisplaySleepDuringPlayback: false });
  bridge.getDisplaySleepSettings.mockResolvedValue({ enabled: false });
  bridge.setDisplaySleepSettings.mockImplementation(async value => value);
});
afterEach(() => { disconnect(); vi.unstubAllGlobals(); });
describe('native display sleep preference', () => {
  it('restores native preference without echoing a stale web default', async () => {
    bridge.getDisplaySleepSettings.mockResolvedValue({ enabled: true });
    const report = vi.fn(); disconnect = connectDisplaySleepSettings(report); await settle();
    expect(enabled()).toBe(true); expect(report).toHaveBeenLastCalledWith(true, false);
    expect(bridge.setDisplaySleepSettings).not.toHaveBeenCalled();
  });
  it('serializes rapid original-store edits, preserving the latest gesture', async () => {
    disconnect = connectDisplaySleepSettings(vi.fn()); await settle();
    let finish!: (value: { enabled: boolean }) => void;
    bridge.setDisplaySleepSettings.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    set(true); set(false);
    expect(bridge.setDisplaySleepSettings).toHaveBeenCalledTimes(1);
    finish({ enabled: true }); await settle();
    expect(bridge.setDisplaySleepSettings).toHaveBeenLastCalledWith({ enabled: false });
    expect(enabled()).toBe(false);
  });
  it('restores the last native value on failure and supports a subsequent retry', async () => {
    const report = vi.fn(); disconnect = connectDisplaySleepSettings(report); await settle();
    bridge.setDisplaySleepSettings.mockRejectedValueOnce(new Error('bridge-failed'));
    set(true); await settle();
    expect(enabled()).toBe(false); expect(report).toHaveBeenLastCalledWith(true, true);
    expect(bridge.setDisplaySleepSettings).toHaveBeenCalledTimes(1);
    set(true); await settle(); expect(enabled()).toBe(true); expect(report).toHaveBeenLastCalledWith(true, false);
  });
  it('ignores a late read after closing settings and does not save after failed initialization', async () => {
    let finish!: (value: { enabled: boolean }) => void;
    bridge.getDisplaySleepSettings.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const report = vi.fn(); disconnect = connectDisplaySleepSettings(report); disconnect();
    finish({ enabled: true }); await settle(); expect(enabled()).toBe(false); expect(report).not.toHaveBeenCalled();
    bridge.getDisplaySleepSettings.mockRejectedValueOnce(new Error('unavailable'));
    disconnect = connectDisplaySleepSettings(report); await settle(); set(true); await settle();
    expect(report).toHaveBeenLastCalledWith(false, true); expect(bridge.setDisplaySleepSettings).not.toHaveBeenCalled();
  });
  it('reconciles a save that completes after closing settings on the next mount', async () => {
    let persisted = false, finish!: () => void;
    bridge.getDisplaySleepSettings.mockImplementation(async () => ({ enabled: persisted }));
    bridge.setDisplaySleepSettings.mockImplementationOnce(({ enabled }) => new Promise(resolve => {
      finish = () => { persisted = enabled; resolve({ enabled }); };
    }));
    const report = vi.fn(); disconnect = connectDisplaySleepSettings(report); await settle();
    set(true); disconnect(); report.mockClear(); finish(); await settle(); expect(report).not.toHaveBeenCalled();
    useDesktopSettingsStore.setState({ preventDisplaySleepDuringPlayback: false });
    disconnect = connectDisplaySleepSettings(report); await settle(); expect(enabled()).toBe(true);
    expect(bridge.setDisplaySleepSettings).toHaveBeenCalledTimes(1);
  });
});
