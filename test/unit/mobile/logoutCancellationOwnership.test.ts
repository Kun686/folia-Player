import { beforeEach, describe, expect, it, vi } from 'vitest';

// logoutCancellationOwnership.test.ts — real mobile catalog wiring; only native IO and account cache are controlled.
const native = vi.hoisted(() => ({
  bootstrap: vi.fn(), configure: vi.fn(), saveSession: vi.fn(), clearSession: vi.fn(), request: vi.fn(), cancelRequests: vi.fn(),
}));
vi.mock('../../../src/mobile/bridge', () => ({ native }));
const cookie = (provider: string, name: string) => provider === 'qq' ? `qqmusic_session=${name}` : name;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe('logout account ownership while request cancellation waits', () => {
  beforeEach(() => {
    vi.resetModules(); vi.resetAllMocks();
    native.bootstrap.mockResolvedValue({ server: 'https://music.example.com', scope: 'original', sessions: {
      qq: { cookie: cookie('qq', 'old') }, netease: { cookie: cookie('netease', 'old') },
    } });
    native.saveSession.mockResolvedValue(undefined); native.clearSession.mockResolvedValue(undefined);
    native.cancelRequests.mockResolvedValue(undefined);
    native.request.mockResolvedValue({ status: 200, body: '{"code":200}', headers: {} });
  });

  const cases = ['qq', 'netease'].flatMap(provider =>
    ['replaced', 'replaced-back', 'cancel-failed', 'no-pending', 'unchanged', 'other-provider'].map(change => ({ provider, change })));
  it.each(cases)('$provider retains the correct account after $change', async ({ provider, change }) => {
    const runtime = await import('../../../src/mobile/runtime');
    const { getMobileRuntime } = await import('../../../src/services/mobileRuntime');
    const { createCatalogSession } = await import('../../../src/mobile/catalogSession');
    const { mobileCatalogPort } = await import('../../../src/mobile/useCatalog');
    await runtime.initializeRuntime();
    const storage = getMobileRuntime()!, port = mobileCatalogPort(provider);
    const remoteLogout = vi.spyOn(port.api, 'logout'), clearAccount = vi.fn().mockResolvedValue(undefined);
    port.clearAccount = clearAccount;
    const session = createCatalogSession(provider, port); session.start();
    const response = deferred<{ status: number; body: string; headers: Record<string, string> }>();
    const cancelled = deferred<void>();
    let incoming: Promise<unknown> | undefined;
    if (change !== 'no-pending') {
      native.request.mockReturnValueOnce(response.promise);
      incoming = storage.fetch(`/mobile/${provider}/user/playlist?pendingLogoutProbe=1`).catch(error => error);
      native.cancelRequests.mockImplementationOnce(async () => {
        await cancelled.promise;
        if (change === 'cancel-failed') throw Error('cancel-bridge-failed');
      });
    }
    const logout = session.logout();
    const other = provider === 'qq' ? 'netease' : 'qq';
    try {
      // This write can complete during the native cancellation await, even if no request IDs exist.
      const changed = change === 'other-provider' ? other : provider;
      storage.write(changed, 'cookie', cookie(changed, change === 'unchanged' ? 'old' : 'replacement'));
      if (change === 'replaced-back') storage.write(provider, 'cookie', cookie(provider, 'old'));
      await runtime.flushSessions();
      const replacement = storage.read(provider, 'cookie'), otherCookie = storage.read(other, 'cookie');
      cancelled.resolve(); await logout; await runtime.flushSessions();
      if (change === 'unchanged' || change === 'other-provider') {
        expect(remoteLogout).toHaveBeenCalledExactlyOnceWith(provider);
        expect(native.clearSession).toHaveBeenCalledExactlyOnceWith({ provider, scope: 'original' });
        expect(clearAccount).toHaveBeenCalledOnce();
        expect(storage.read(provider, 'cookie')).toBeNull();
        expect(session.getSnapshot()).toMatchObject({ loggingOut: false, logoutError: false });
      } else {
        expect(storage.read(provider, 'cookie')).toBe(replacement);
        expect(remoteLogout).not.toHaveBeenCalled();
        expect(native.clearSession).not.toHaveBeenCalled(); expect(clearAccount).not.toHaveBeenCalled();
        expect(session.getSnapshot()).toMatchObject({ loggingOut: false, logoutError: true });
      }
      expect(storage.read(other, 'cookie')).toBe(otherCookie);
    } finally {
      cancelled.resolve(); response.resolve({ status: 200, body: '{}', headers: {} });
      await Promise.allSettled([logout, incoming]); session.dispose(); remoteLogout.mockRestore();
    }
  });
});
