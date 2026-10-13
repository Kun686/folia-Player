import { beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/mobile/runtime.test.ts — verify late network replies cannot recreate cleared credentials.
const native = vi.hoisted(() => ({
  bootstrap: vi.fn(), configure: vi.fn(), saveSession: vi.fn(), clearSession: vi.fn(), request: vi.fn(), cancelRequests: vi.fn(),
  songCover: vi.fn(), coverCacheState: vi.fn(), clearCoverCache: vi.fn(),
  readLyricCache: vi.fn(), writeLyricCache: vi.fn(), lyricCacheState: vi.fn(), clearLyricCache: vi.fn(),
}));
vi.mock('../../../src/mobile/bridge', () => ({ native }));
describe('mobile secure runtime', () => {
  beforeEach(() => { vi.resetModules(); vi.clearAllMocks();
    native.configure.mockReset();
    native.bootstrap.mockResolvedValue({ server: 'https://music.example.com', scope: 'original', sessions: { qq: { cookie: 'fixture' } } });
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
    expect(native.clearSession).toHaveBeenCalledWith({ provider: 'qq', scope: 'original' });
  });
  it('captures provider-scoped intent and revokes it on credential replacement, cancellation or logout', async () => {
    const runtime = await import('../../../src/mobile/runtime');
    const { getMobileRuntime } = await import('../../../src/services/mobileRuntime');
    await runtime.initializeRuntime(); const port = getMobileRuntime()!;
    const first = runtime.captureProviderSession('qq'), other = runtime.captureProviderSession('netease');
    port.write('qq', 'cookie', 'fixture'); expect(first()).toBe(true);
    port.write('qq', 'cookie', 'replacement'); expect(first()).toBe(false); expect(other()).toBe(true);
    const next = runtime.captureProviderSession('qq'); await runtime.cancelProvider('qq'); expect(next()).toBe(false);
    const last = runtime.captureProviderSession('qq'); await runtime.clearProvider('qq'); expect(last()).toBe(false);
    await runtime.flushSessions();
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
    expect(native.clearSession).toHaveBeenCalledWith({ provider: 'qq', scope: 'original' });
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
  it('a failed gateway commit preserves memory, revokes old replies and allows retry', async () => {
    const runtime = await import('../../../src/mobile/runtime');
    const { getMobileRuntime } = await import('../../../src/services/mobileRuntime');
    await runtime.initializeRuntime(); const port = getMobileRuntime()!;
    const current = runtime.captureProviderSession('qq');
    native.configure.mockRejectedValueOnce(new Error('secure-storage'));
    await expect(runtime.configureGateway('https://new.example', 'new-token')).rejects.toThrow('secure-storage');
    expect(port.read('qq', 'cookie')).toBe('fixture');
    expect(current()).toBe(false);
    expect(native.clearSession).not.toHaveBeenCalled();
    native.configure.mockResolvedValue({ server: 'https://new.example', scope: 'next', sessions: {} });
    await runtime.configureGateway('https://new.example', 'new-token');
    expect(native.configure).toHaveBeenLastCalledWith({ server: 'https://new.example', token: 'new-token', scope: 'original' });
    expect(port.read('qq', 'cookie')).toBeNull();
    port.write('qq', 'cookie', 'new-account'); await runtime.flushSessions();
    expect(native.saveSession).toHaveBeenLastCalledWith({ provider: 'qq', scope: 'next', values: { cookie: 'new-account' } });
  });
  it('uses authoritative sessions after a token-only change, and waits for pending saves', async () => {
    const runtime = await import('../../../src/mobile/runtime');
    const { getMobileRuntime } = await import('../../../src/services/mobileRuntime');
    await runtime.initializeRuntime(); const port = getMobileRuntime()!;
    let finish!: () => void;
    native.saveSession.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    port.write('qq', 'cookie', 'latest');
    const save = runtime.configureGateway('https://music.example.com', 'new-token');
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    expect(native.configure).not.toHaveBeenCalled();
    expect(() => port.write('qq', 'cookie', 'late')).toThrow('Canceled');
    await expect(port.fetch('/mobile/qq/search')).rejects.toMatchObject({ name: 'AbortError' });
    await expect(runtime.clearProvider('qq')).rejects.toThrow('gateway-settings-changed');
    await expect(runtime.configureGateway('https://other.example', 'token')).rejects.toThrow('gateway-settings-changed');
    native.configure.mockResolvedValue({ server: 'https://music.example.com', scope: 'next', sessions: { qq: { cookie: 'latest' } } });
    finish(); await save;
    expect(native.saveSession).toHaveBeenCalledWith({ provider: 'qq', values: { cookie: 'latest' }, scope: 'original' });
    expect(port.read('qq', 'cookie')).toBe('latest');
    native.request.mockResolvedValue({ status: 200, body: '{}', headers: {} });
    await port.fetch('/mobile/qq/search');
    expect(native.request.mock.calls.at(-1)?.[0].scope).toBe('next');
  });
  it('failed logout preserves memory and blocks writes or configuration until it settles', async () => {
    const runtime = await import('../../../src/mobile/runtime');
    const { getMobileRuntime } = await import('../../../src/services/mobileRuntime');
    await runtime.initializeRuntime(); const port = getMobileRuntime()!;
    let fail!: (reason: Error) => void;
    native.clearSession.mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
    const logout = runtime.clearProvider('qq'), assertion = expect(logout).rejects.toThrow('secure-storage');
    await vi.waitFor(() => expect(fail).toBeTypeOf('function'));
    expect(port.read('qq', 'cookie')).toBe('fixture');
    expect(() => port.write('qq', 'cookie', 'late')).toThrow('Canceled');
    await expect(port.fetch('/mobile/qq/search')).rejects.toMatchObject({ name: 'AbortError' });
    await expect(runtime.configureGateway('https://new.example', 'token')).rejects.toThrow('gateway-settings-changed');
    fail(new Error('secure-storage')); await assertion;
    expect(port.read('qq', 'cookie')).toBe('fixture');
    await runtime.clearProvider('qq');
    expect(port.read('qq', 'cookie')).toBeNull();
    expect(native.clearSession).toHaveBeenLastCalledWith({ provider: 'qq', scope: 'original' });
  });
  it('does not surface a pre-configuration reply if native cancellation races', async () => {
    const runtime = await import('../../../src/mobile/runtime');
    const { getMobileRuntime } = await import('../../../src/services/mobileRuntime');
    await runtime.initializeRuntime();
    let finish!: (value: unknown) => void;
    native.request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const reply = getMobileRuntime()!.fetch('/mobile/qq/login/qr/check?key=old');
    const assertion = expect(reply).rejects.toMatchObject({ name: 'AbortError' });
    native.configure.mockResolvedValue({ server: 'https://new.example', scope: 'next', sessions: {} });
    await runtime.configureGateway('https://new.example', 'token');
    finish({ status: 200, body: '{"cookie":"old"}', headers: {} }); await assertion;
  });
  it('restores committed logout when only native cache cleanup fails', async () => {
    const runtime = await import('../../../src/mobile/runtime');
    const { getMobileRuntime } = await import('../../../src/services/mobileRuntime');
    await runtime.initializeRuntime();
    native.clearSession.mockRejectedValueOnce(new Error('cache-write'));
    native.bootstrap.mockResolvedValue({ server: 'https://music.example.com', scope: 'original', sessions: {} });
    await expect(runtime.clearProvider('qq')).rejects.toThrow('cache-write');
    expect(getMobileRuntime()!.read('qq', 'cookie')).toBeNull();
  });
  it('failed pending persistence cannot leak memory-only cookies into a committed configuration', async () => {
    const runtime = await import('../../../src/mobile/runtime');
    const { getMobileRuntime } = await import('../../../src/services/mobileRuntime');
    await runtime.initializeRuntime(); const port = getMobileRuntime()!;
    native.saveSession.mockRejectedValueOnce(new Error('secure-storage'));
    port.write('qq', 'cookie', 'uncommitted');
    native.configure.mockResolvedValue({ server: 'https://music.example.com', scope: 'next', sessions: { qq: { cookie: 'fixture' } } });
    await runtime.configureGateway('https://music.example.com', 'token');
    expect(port.read('qq', 'cookie')).toBe('fixture');
    await expect(runtime.flushSessions()).resolves.toBeUndefined();
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
  it.each(['logout', 'replace'])('revokes QQ lyric snapshots after an unrelated NetEase account %s', async action => {
    const runtime = await import('../../../src/mobile/runtime');
    const { getMobileRuntime } = await import('../../../src/services/mobileRuntime');
    await runtime.initializeRuntime();
    native.readLyricCache.mockResolvedValue({ token: 'old', payload: {} });
    const port = getMobileRuntime()!, song = { sourceRef: { kind: 'online', providerId: 'qq', mediaId: '42' } } as any;
    const storage = await port.lyrics!.open(song);
    if (action === 'logout') await runtime.clearProvider('netease');
    else port.write('netease', 'cookie', 'replacement-fixture');
    expect(storage.isCurrent()).toBe(false);
    await expect(storage.writeAutomaticState!({ lyricsSource: 'online' })).rejects.toMatchObject({ name: 'AbortError' });
    expect(native.writeLyricCache).not.toHaveBeenCalled();
    await runtime.flushSessions();
  });

});
