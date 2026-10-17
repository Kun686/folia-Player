import { beforeEach, describe, expect, it, vi } from 'vitest';

// logoutSession.test.ts — actual catalog, adapter and runtime composition; only native IO is controlled.
const native = vi.hoisted(() => ({
  bootstrap: vi.fn(), configure: vi.fn(), saveSession: vi.fn(), clearSession: vi.fn(), request: vi.fn(), cancelRequests: vi.fn(),
}));
vi.mock('../../../src/mobile/bridge', () => ({ native }));

describe('mobile logout session ownership across layers', () => {
  beforeEach(() => {
    vi.resetModules(); vi.resetAllMocks();
    native.bootstrap.mockResolvedValue({ server: 'https://music.example.com', scope: 'original', sessions: {
      qq: { cookie: 'qqmusic_session=old' }, netease: { cookie: 'old-netease' },
    } });
    native.saveSession.mockResolvedValue(undefined); native.clearSession.mockResolvedValue(undefined);
    native.cancelRequests.mockResolvedValue(undefined);
  });

  it.each(['qq', 'netease'].flatMap(provider => ['account', 'gateway', 'body'].map(stage => ({ provider, stage }))))(
    'preserves the replacement during $provider logout at $stage', async ({ provider, stage }) => {
    const runtime = await import('../../../src/mobile/runtime');
    const { getMobileRuntime } = await import('../../../src/services/mobileRuntime');
    const { createCatalogSession } = await import('../../../src/mobile/catalogSession');
    const adapter = provider === 'qq' ? (await import('../../../src/services/onlineMusic/qqProvider')).qqProvider
      : (await import('../../../src/services/onlineMusic/neteaseProvider')).neteaseProvider;
    await runtime.initializeRuntime(); const storage = getMobileRuntime()!;
    const clearAccount = vi.fn().mockResolvedValue(undefined);
    const session = createCatalogSession(provider, {
      api: { getLoginStatus: vi.fn(), getProviderUserPlaylists: vi.fn(), getCollectionTracks: vi.fn(),
        searchProviderSongs: vi.fn(), logout: () => adapter.auth!.logout() },
      flush: () => runtime.flushSessions([provider]), cancel: () => runtime.cancelProvider(provider),
      clearSession: () => runtime.clearProvider(provider), clearAccount, captureConnection: runtime.captureGatewayConnection,
      captureCredentials: () => runtime.captureProviderCredentials(provider),
    });
    session.start();
    const response = { status: 200, body: '{"code":200}', headers: {} };
    let release!: () => void, entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const method = provider === 'qq' ? 'json' : 'text';
    const readBody = Response.prototype[method];
    const bodySpy = stage === 'body' ? vi.spyOn(Response.prototype, method).mockImplementationOnce(async function (this: Response) {
      entered(); await gate; return readBody.call(this);
    }) : undefined;
    native.request.mockImplementationOnce(async () => {
      if (stage !== 'body') { entered(); await gate; }
      return response;
    });
    const pending = session.logout();
    try {
      await started;
      if (stage === 'gateway') {
        native.configure.mockResolvedValue({ server: 'https://next.example', scope: 'replacement', sessions: {
          qq: { cookie: 'qqmusic_session=replacement' }, netease: { cookie: 'replacement-netease' },
        } });
        await runtime.configureGateway('https://next.example', 'replacement-access');
      } else storage.write(provider, 'cookie', provider === 'qq' ? 'qqmusic_session=replacement' : 'replacement-netease');
      const expected = { qq: storage.read('qq', 'cookie'), netease: storage.read('netease', 'cookie') };
      await runtime.flushSessions();
      const writes = native.saveSession.mock.calls.map(([args]) => structuredClone(args));
      release(); await pending; await runtime.flushSessions();
      expect({ qq: storage.read('qq', 'cookie'), netease: storage.read('netease', 'cookie') }).toEqual(expected);
      expect(native.saveSession.mock.calls.map(([args]) => args)).toEqual(writes);
      expect(native.clearSession).not.toHaveBeenCalled(); expect(clearAccount).not.toHaveBeenCalled();
      expect(session.getSnapshot()).toMatchObject({ loggingOut: false, logoutError: true });
    } finally { release(); await pending; bodySpy?.mockRestore(); session.dispose(); }
  });
});
