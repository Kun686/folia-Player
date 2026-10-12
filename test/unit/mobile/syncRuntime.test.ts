import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SYNC_PROVIDER } from '../../../src/services/sync/syncTypes';

// syncRuntime.test.ts — bridge races, cancellation and credential isolation without real network/Keychain access.
const bridge = vi.hoisted(() => ({ getSyncSettings: vi.fn(), setSyncSettings: vi.fn(), syncRequest: vi.fn(), cancelSyncRequest: vi.fn() }));
vi.mock('../../../src/mobile/bridge', () => ({ native: bridge }));
const settings = (revision = 1) => ({ enabled: true, hasToken: true, baseURL: 'https://sync.example', scope: 'account-one', revision });
beforeEach(() => {
  vi.resetModules(); vi.resetAllMocks(); vi.stubGlobal('window', new EventTarget());
  bridge.getSyncSettings.mockResolvedValue(settings()); bridge.cancelSyncRequest.mockResolvedValue(undefined);
  bridge.syncRequest.mockResolvedValue({ status: 200, body: '{"ok":true}', contentType: 'application/json' });
});
afterEach(() => vi.unstubAllGlobals());
it('uses fixed native operations and keeps tokens out of the shared config and request', async () => {
  const runtime = await import('../../../src/mobile/syncRuntime');
  await runtime.loadMobileSyncSettings();
  const config = runtime.mobileSyncConnection();
  expect(config).toMatchObject({ provider: SYNC_PROVIDER, authToken: '' });
  const response = await config.nativeSession!.request('/themes/get', { method: 'POST', body: '{"fingerprints":["netease:id:42"]}' });
  expect(await response.json()).toEqual({ ok: true });
  expect(bridge.syncRequest.mock.calls[0][0]).toEqual({ id: expect.any(String), revision: 1, operation: 'themeGet', body: '{"fingerprints":["netease:id:42"]}' });
  await expect(config.nativeSession!.request('https://other.example', {})).rejects.toThrow('invalid-sync-request');
  expect(bridge.syncRequest).toHaveBeenCalledTimes(1);
});
it('cancels old work on settings change and cannot publish a late old snapshot', async () => {
  const runtime = await import('../../../src/mobile/syncRuntime');
  await runtime.loadMobileSyncSettings();
  const before = runtime.mobileSyncConnection();
  let release!: (value: unknown) => void;
  bridge.syncRequest.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const work = before.nativeSession!.request('/state', {});
  bridge.setSyncSettings.mockResolvedValue({ ...settings(2), scope: 'account-two' });
  await runtime.saveMobileSyncSettings(1, { token: 'replacement' });
  expect(bridge.cancelSyncRequest).toHaveBeenCalledWith({ id: bridge.syncRequest.mock.calls[0][0].id });
  const failed = expect(work).rejects.toThrow('sync-cancelled');
  release({ status: 200, body: '{}', contentType: 'application/json' }); await failed;
  await runtime.loadMobileSyncSettings(); // Fixture still returns revision 1.
  expect(runtime.mobileSyncConnection().nativeSession!.scope).toBe('account-two');
});
it('keeps the old session after failed credential persistence and cancels only active requests', async () => {
  const runtime = await import('../../../src/mobile/syncRuntime');
  await runtime.loadMobileSyncSettings(); const before = runtime.mobileSyncConnection();
  bridge.setSyncSettings.mockRejectedValue(Error('secure-storage'));
  await expect(runtime.saveMobileSyncSettings(1, { token: '' })).rejects.toThrow('secure-storage');
  expect(() => before.nativeSession!.assertCurrent()).not.toThrow();
  await before.nativeSession!.request('/state', {});
  runtime.cancelMobileSync(); expect(bridge.cancelSyncRequest).not.toHaveBeenCalled();
  expect(() => before.nativeSession!.assertCurrent()).toThrow('sync-cancelled');
});
it('does not invalidate an active session when reloading the same saved revision', async () => {
  const runtime = await import('../../../src/mobile/syncRuntime');
  await runtime.loadMobileSyncSettings(); const before = runtime.mobileSyncConnection();
  await runtime.loadMobileSyncSettings(); expect(() => before.nativeSession!.assertCurrent()).not.toThrow();
});
