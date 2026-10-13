import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useVideoLayerSettingsStore, clampVideoLayerOpacity } from '@/stores/useVideoLayerSettingsStore';
import * as files from '@/services/videoLayerFile';

// videoLayerSettings.test.ts — shared desktop/mobile persistence must never claim failed writes succeeded.
vi.mock('@/services/videoLayerFile', () => ({
  canPersistVideoLayerFile: () => false, clearVideoLayerFileHandle: vi.fn(), loadVideoLayerFileHandle: vi.fn(),
  pickVideoLayerFile: vi.fn(), readVideoLayerFileHandle: vi.fn(), saveVideoLayerFileHandle: vi.fn(),
}));
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('window', {});
  vi.stubGlobal('localStorage', { getItem: vi.fn(() => null), setItem: vi.fn() });
  useVideoLayerSettingsStore.setState({ videoLayerEnabled: false, videoLayerUrl: 'https://example.test/old.mp4',
    videoLayerOpacity: 0.6, videoLayerFit: 'cover', localFileUrl: null, localFileName: null, localFileStatus: 'none' });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('video layer persistence', () => {
  it.each(['enabled', 'url', 'opacity', 'fit'])('keeps accepted %s when saving fails, then recovers', kind => {
    const state = useVideoLayerSettingsStore.getState();
    const change = () => {
      if (kind === 'enabled') state.setVideoLayerEnabled(true);
      if (kind === 'url') state.setVideoLayerUrl('https://example.test/new.mp4');
      if (kind === 'opacity') state.setVideoLayerOpacity(0.3);
      if (kind === 'fit') state.setVideoLayerFit('contain');
    };
    vi.mocked(localStorage.setItem).mockImplementationOnce(() => { throw Error('disk-full'); });
    expect(change).toThrow('disk-full');
    expect(useVideoLayerSettingsStore.getState()).toBe(state);
    change(); expect(useVideoLayerSettingsStore.getState()).not.toBe(state);
  });
  it('keeps the local pick on failed removal and revokes its URL only after success', async () => {
    useVideoLayerSettingsStore.setState({ localFileUrl: 'blob:kept', localFileName: 'kept.mp4', localFileStatus: 'ready' });
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.mocked(files.clearVideoLayerFileHandle).mockRejectedValueOnce(Error('disk-full'));
    await expect(useVideoLayerSettingsStore.getState().clearLocalFile()).rejects.toThrow('disk-full');
    expect(useVideoLayerSettingsStore.getState().localFileUrl).toBe('blob:kept'); expect(revoke).not.toHaveBeenCalled();
    await useVideoLayerSettingsStore.getState().clearLocalFile();
    expect(useVideoLayerSettingsStore.getState().localFileUrl).toBeNull(); expect(revoke).toHaveBeenCalledWith('blob:kept');
  });
  it('cancelled picking preserves the previous selection and enable state', async () => {
    useVideoLayerSettingsStore.setState({ localFileUrl: 'blob:kept', localFileName: 'kept.mp4', localFileStatus: 'ready' });
    vi.mocked(files.pickVideoLayerFile).mockResolvedValueOnce(null);
    expect(await useVideoLayerSettingsStore.getState().pickLocalFile()).toBeNull();
    expect(useVideoLayerSettingsStore.getState()).toMatchObject({ localFileUrl: 'blob:kept', videoLayerEnabled: false });
    expect(files.clearVideoLayerFileHandle).not.toHaveBeenCalled();
  });
  it('preserves the original opacity bounds', () => {
    expect([NaN, -2, 0.4, 6].map(clampVideoLayerOpacity)).toEqual([0.6, 0.1, 0.4, 1]);
  });
});
