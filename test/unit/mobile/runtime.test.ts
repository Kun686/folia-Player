import { beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/mobile/runtime.test.ts — verify late network replies cannot recreate cleared credentials.
const native = vi.hoisted(() => ({
  bootstrap: vi.fn(), saveSession: vi.fn(), clearSession: vi.fn(), request: vi.fn(), cancelRequests: vi.fn(),
  songCover: vi.fn(), coverCacheState: vi.fn(), clearCoverCache: vi.fn(),
  readLyricCache: vi.fn(), writeLyricCache: vi.fn(), lyricCacheState: vi.fn(), clearLyricCache: vi.fn(),
}));
vi.mock('../../../src/mobile/bridge', () => ({ native }));
describe('mobile secure runtime', () => {
  beforeEach(() => { vi.resetModules(); vi.clearAllMocks();
    native.bootstrap.mockResolvedValue({ server: 'https://music.example.com', sessions: { qq: { cookie: 'fixture' } } });
    native.saveSession.mockResolvedValue(undefined); native.clearSession.mockResolvedValue(undefined);
    native.cancelRequests.mockResolvedValue(undefined);
  });
  it('hydrates memory and serializes persistence without localStorage', async () => {
    const runtime = await import('../../../src/mobile/runtime');
    const { getMobileRuntime } = await import('../../../src/services/mobileRuntime');
    await runtime.initializeRuntime();
    const port = getMobileRuntime()!;
    expect(port.read('qq', 'cookie')).toBe('fixture');
    port.write('qq', 'cookie', 'new'); port.write('qq', 'cookie', null);
    await runtime.flushSessions();
    expect(native.saveSession.mock.calls.map(([arg]) => arg.values)).toEqual([{ cookie: 'new' }, {}]);
    await runtime.clearProvider('qq');
    expect(port.read('qq', 'cookie')).toBeNull();
    expect(native.clearSession).toHaveBeenCalledWith({ provider: 'qq' });
  });
  it('rejects a response that arrives after logout even if native cancellation races', async () => {
    const runtime = await import('../../../src/mobile/runtime');
    const { getMobileRuntime } = await import('../../../src/services/mobileRuntime');
    await runtime.initializeRuntime();
    let complete!: (result: unknown) => void;
    native.request.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    const response = getMobileRuntime()!.fetch('/mobile/qq/login/qr/check?key=old');
    const assertion = expect(response).rejects.toMatchObject({ name: 'AbortError' });
    await runtime.clearProvider('qq');
    complete({ status: 200, body: '{"cookie":"old"}', headers: {} });
    await assertion;
    expect(native.cancelRequests).toHaveBeenCalled();
  });
  it('still deletes credentials after a failed pending save', async () => {
    native.saveSession.mockRejectedValue(new Error('secure-storage'));
    const runtime = await import('../../../src/mobile/runtime');
    const { getMobileRuntime } = await import('../../../src/services/mobileRuntime');
    await runtime.initializeRuntime();
    getMobileRuntime()!.write('qq', 'cookie', 'new');
    await runtime.clearProvider('qq');
    expect(native.clearSession).toHaveBeenCalledWith({ provider: 'qq' });
    await expect(runtime.flushSessions()).resolves.toBeUndefined();
  });
  it('surfaces Keychain persistence failure rather than reporting successful login', async () => {
    native.saveSession.mockRejectedValue(new Error('secure-storage'));
    const runtime = await import('../../../src/mobile/runtime');
    const { getMobileRuntime } = await import('../../../src/services/mobileRuntime');
    await runtime.initializeRuntime();
    getMobileRuntime()!.write('qq', 'cookie', 'new');
    await expect(runtime.flushSessions()).rejects.toThrow('secure-storage');
  });
  it.each(['logout', 'clear'])('rejects a cover response delivered after %s', async action => {
    const runtime = await import('../../../src/mobile/runtime');
    const { getMobileRuntime } = await import('../../../src/services/mobileRuntime');
    await runtime.initializeRuntime();
    let complete!: (result: unknown) => void;
    native.songCover.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    const song = { sourceRef: { kind: 'online', providerId: 'qq', mediaId: '42' } } as any;
    const covers = getMobileRuntime()!.covers!;
    const assertion = expect(covers.load(song)).rejects.toMatchObject({ name: 'AbortError' });
    if (action === 'logout') await runtime.clearProvider('qq'); else await covers.clear();
    complete({ url: 'data:image/jpeg;base64,old' });
    await assertion;
  });
  it('uses native cover bytes and exposes the original cover category usage', async () => {
    const runtime = await import('../../../src/mobile/runtime');
    const { getMobileRuntime } = await import('../../../src/services/mobileRuntime');
    await runtime.initializeRuntime();
    native.songCover.mockResolvedValue({ url: 'data:image/jpeg;base64,fixture' });
    native.coverCacheState.mockResolvedValue({ bytes: 1024, count: 1 });
    const covers = getMobileRuntime()!.covers!;
    const song = { sourceRef: { kind: 'local', mediaId: 'local' } } as any;
    await expect(covers.load(song)).resolves.toBe('data:image/jpeg;base64,fixture');
    await expect(covers.usage()).resolves.toBe(1024);
    expect(native.songCover).toHaveBeenCalledWith({ song });
  });
  it.each(['clear', 'logout'])('revokes native lyric writes and pending reads after %s', async action => {
    const runtime = await import('../../../src/mobile/runtime');
    const { getMobileRuntime } = await import('../../../src/services/mobileRuntime');
    await runtime.initializeRuntime();
    native.readLyricCache.mockResolvedValue({ token: 'old', payload: {} });
    const song = { sourceRef: { kind: 'online', providerId: 'qq', mediaId: '42' } } as any;
    const port = getMobileRuntime()!.lyrics!, storage = await port.open(song);
    let finish!: (value: unknown) => void;
    native.readLyricCache.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const pending = port.open(song), assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    if (action === 'clear') await port.clear(); else await runtime.clearProvider('qq');
    finish({ token: 'old', payload: {} }); await assertion;
    expect(storage.isCurrent()).toBe(false);
    await expect(storage.writeLyrics(null)).rejects.toMatchObject({ name: 'AbortError' });
    expect(native.writeLyricCache).not.toHaveBeenCalled();
  });
});
