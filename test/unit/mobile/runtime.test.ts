import { beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/mobile/runtime.test.ts — verify late network replies cannot recreate cleared credentials.
const native = vi.hoisted(() => ({
  bootstrap: vi.fn(), configure: vi.fn(), saveSession: vi.fn(), clearSession: vi.fn(), request: vi.fn(), cancelRequests: vi.fn(),
  songCover: vi.fn(), coverCacheState: vi.fn(), clearCoverCache: vi.fn(),
  readLyricCache: vi.fn(), writeLyricCache: vi.fn(), lyricCacheState: vi.fn(), clearLyricCache: vi.fn(),
}));
vi.mock('../../../src/mobile/bridge', () => ({ native }));
describe('mobile secure runtime', () => {
  beforeEach(() => { vi.resetModules(); vi.resetAllMocks();
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
  it('keeps a logout connection guard across provider cancellation but rejects a pending or replaced gateway', async () => {
    const runtime = await import('../../../src/mobile/runtime');
    await runtime.initializeRuntime();
    const current = runtime.captureGatewayConnection();
    await runtime.cancelProvider('qq'); expect(current()).toBe(true);
    let complete!: (value: unknown) => void;
    native.configure.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const configuring = runtime.configureGateway('https://new.example', 'new-token');
    expect(current()).toBe(false);
    await vi.waitFor(() => expect(complete).toBeTypeOf('function'));
    complete({ server: 'https://new.example', scope: 'next', sessions: {} }); await configuring;
    expect(current()).toBe(false); expect(runtime.captureGatewayConnection()()).toBe(true);
  });
  it.each([200, 401])('a pending QQ logout (%s) preserves a newer account through the real adapter and transport', async status => {
    native.bootstrap.mockResolvedValue({ server: 'https://music.example.com', scope: 'original', sessions: { qq: { cookie: 'qqmusic_session=old' } } });
    const runtime = await import('../../../src/mobile/runtime');
    const { getMobileRuntime } = await import('../../../src/services/mobileRuntime');
    const { qqProvider } = await import('../../../src/services/onlineMusic/qqProvider');
    await runtime.initializeRuntime(); const port = getMobileRuntime()!;
    let complete!: (value: unknown) => void;
    native.request.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const pending = qqProvider.auth!.logout().catch(error => error);
    await vi.waitFor(() => expect(complete).toBeTypeOf('function'));
    port.write('qq', 'cookie', 'qqmusic_session=replacement');
    complete({ status, body: JSON.stringify({ code: status }), headers: {} });
    expect(await pending).toMatchObject({ name: 'AbortError' }); await runtime.flushSessions();
    expect(port.read('qq', 'cookie')).toBe('qqmusic_session=replacement');
    expect(native.saveSession.mock.calls.map(([args]) => args.values)).toEqual([{ cookie: 'qqmusic_session=replacement' }]);
  });
  it.each([200, 401, 502])('still removes the current QQ account on logout status %s', async status => {
    native.bootstrap.mockResolvedValue({ server: 'https://music.example.com', scope: 'original', sessions: { qq: { cookie: 'qqmusic_session=current' } } });
    const runtime = await import('../../../src/mobile/runtime');
    const { getMobileRuntime } = await import('../../../src/services/mobileRuntime');
    const { qqProvider } = await import('../../../src/services/onlineMusic/qqProvider');
    await runtime.initializeRuntime();
    native.request.mockResolvedValue({ status, body: JSON.stringify({ code: status }), headers: {} });
    await qqProvider.auth!.logout(); await runtime.flushSessions();
    expect(getMobileRuntime()!.read('qq', 'cookie')).toBeNull();
    expect(native.saveSession.mock.calls.at(-1)?.[0].values).toEqual({});
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
  it.each(['qq', 'netease'])('rejects a late %s response after its in-memory credential was replaced', async provider => {
    const runtime = await import('../../../src/mobile/runtime');
    const { getMobileRuntime } = await import('../../../src/services/mobileRuntime');
    await runtime.initializeRuntime(); const port = getMobileRuntime()!;
    let complete!: (result: unknown) => void;
    native.request.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const response = port.fetch(`/mobile/${provider}/login/status`);
    const assertion = expect(response).rejects.toMatchObject({ name: 'AbortError' });
    port.write(provider, 'cookie', 'replacement-session');
    complete({ status: 401, body: '{}', headers: {} });
    await assertion; await runtime.flushSessions();
    expect(port.read(provider, 'cookie')).toBe('replacement-session');
  });
  it.each([401, 803])('an old QQ response (%s) cannot clear or replace a newer login', async code => {
    native.bootstrap.mockResolvedValue({ server: 'https://music.example.com', scope: 'original', sessions: { qq: { cookie: 'qqmusic_session=old' } } });
    const runtime = await import('../../../src/mobile/runtime');
    const { getMobileRuntime } = await import('../../../src/services/mobileRuntime');
    const { requestQq } = await import('../../../src/services/onlineMusic/qqTransport');
    await runtime.initializeRuntime(); const port = getMobileRuntime()!;
    let complete!: (result: unknown) => void;
    native.request.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const response = requestQq(code === 803 ? 'login_qr_check' : 'login_status', { key: 'old-qr' }).catch(error => error);
    await vi.waitFor(() => expect(complete).toBeTypeOf('function'));
    port.write('qq', 'cookie', 'qqmusic_session=new');
    complete({ status: code === 401 ? 401 : 200, headers: {}, body: JSON.stringify({ code, cookie: 'qqmusic_session=late' }) });
    await response; await runtime.flushSessions();
    expect(port.read('qq', 'cookie')).toBe('qqmusic_session=new');
    expect(native.saveSession.mock.calls.map(([args]) => args.values)).toEqual([{ cookie: 'qqmusic_session=new' }]);
  });
  it.each([401, 803].flatMap(code => ['replace', 'cancel', 'replace-back', 'logout'].map(action => ({ code, action }))))(
    'rejects a QQ response ($code, $action) superseded during body consumption', async ({ code, action }) => {
    native.bootstrap.mockResolvedValue({ server: 'https://music.example.com', scope: 'original', sessions: { qq: { cookie: 'qqmusic_session=old' } } });
    const runtime = await import('../../../src/mobile/runtime');
    const { getMobileRuntime } = await import('../../../src/services/mobileRuntime');
    const { requestQq } = await import('../../../src/services/onlineMusic/qqTransport');
    await runtime.initializeRuntime(); const port = getMobileRuntime()!;
    native.request.mockResolvedValueOnce({ status: code === 401 ? 401 : 200, headers: {}, body: JSON.stringify({ code, cookie: 'qqmusic_session=late' }) });
    let reading!: () => void, finish!: () => void;
    const started = new Promise<void>(resolve => { reading = resolve; });
    const released = new Promise<void>(resolve => { finish = resolve; });
    const parse = Response.prototype.json;
    const body = vi.spyOn(Response.prototype, 'json').mockImplementationOnce(async function (this: Response) {
      reading(); await released; return parse.call(this);
    });
    try {
      const response = requestQq(code === 803 ? 'login_qr_check' : 'login_status', { key: 'old-qr' }).catch(error => error);
      await started;
      if (action === 'cancel') await runtime.cancelProvider('qq');
      else if (action === 'logout') await runtime.clearProvider('qq');
      else {
        port.write('qq', 'cookie', 'qqmusic_session=new');
        if (action === 'replace-back') port.write('qq', 'cookie', 'qqmusic_session=old');
      }
      const expected = port.read('qq', 'cookie');
      await runtime.flushSessions();
      const writes = native.saveSession.mock.calls.map(([args]) => args.values);
      finish(); const result = await response; await runtime.flushSessions();
      expect(port.read('qq', 'cookie')).toBe(expected);
      expect(native.saveSession.mock.calls.map(([args]) => args.values)).toEqual(writes);
      expect(result).toMatchObject({ name: 'AbortError' });
    } finally { finish(); body.mockRestore(); }
  });
  it.each([401, 803])('keeps a current QQ response (%s) during body consumption when unrelated state changes', async code => {
    native.bootstrap.mockResolvedValue({ server: 'https://music.example.com', scope: 'original', sessions: { qq: { cookie: 'qqmusic_session=old' } } });
    const runtime = await import('../../../src/mobile/runtime');
    const { getMobileRuntime } = await import('../../../src/services/mobileRuntime');
    const { requestQq } = await import('../../../src/services/onlineMusic/qqTransport');
    await runtime.initializeRuntime(); const port = getMobileRuntime()!;
    native.request.mockResolvedValueOnce({ status: code === 401 ? 401 : 200, headers: {}, body: JSON.stringify({ code, cookie: 'qqmusic_session=confirmed' }) });
    const parse = Response.prototype.json;
    const body = vi.spyOn(Response.prototype, 'json').mockImplementationOnce(async function (this: Response) {
      port.write('netease', 'cookie', 'other-account');
      port.write('qq', 'cookie', 'qqmusic_session=old');
      return parse.call(this);
    });
    try {
      const result = await requestQq(code === 803 ? 'login_qr_check' : 'login_status').catch(error => error);
      await runtime.flushSessions();
      if (code === 401) expect(result).toMatchObject({ code: 'auth-required', httpStatus: 401 });
      else expect(result).toMatchObject({ code: 803 });
      expect(port.read('qq', 'cookie')).toBe(code === 401 ? null : 'qqmusic_session=confirmed');
      expect(port.read('netease', 'cookie')).toBe('other-account');
    } finally { body.mockRestore(); }
  });
  it('does not let the QQ adapter recommit a cookie after the transport saved it', async () => {
    native.bootstrap.mockResolvedValue({ server: 'https://music.example.com', scope: 'original', sessions: {} });
    const runtime = await import('../../../src/mobile/runtime');
    const { getMobileRuntime } = await import('../../../src/services/mobileRuntime');
    const { qqProvider } = await import('../../../src/services/onlineMusic/qqProvider');
    await runtime.initializeRuntime(); const port = getMobileRuntime()!;
    native.request.mockResolvedValueOnce({ status: 200, headers: {}, body: JSON.stringify({ code: 803, cookie: 'qqmusic_session=confirmed' }) });
    // A replacement queued after the transport commit must win over the adapter's later continuation.
    native.saveSession.mockImplementationOnce(async () => { port.write('qq', 'cookie', 'qqmusic_session=replacement'); });
    await expect(qqProvider.auth!.checkQr!('qr-key')).resolves.toEqual({ state: 'confirmed' });
    await runtime.flushSessions();
    expect(port.read('qq', 'cookie')).toBe('qqmusic_session=replacement');
    expect(native.saveSession.mock.calls.map(([args]) => args.values)).toEqual([
      { cookie: 'qqmusic_session=confirmed' }, { cookie: 'qqmusic_session=replacement' },
    ]);
  });
  it.each(['qq', 'netease'])('keeps valid %s responses when only another platform changes or the same cookie is saved', async provider => {
    const runtime = await import('../../../src/mobile/runtime');
    const { getMobileRuntime } = await import('../../../src/services/mobileRuntime');
    await runtime.initializeRuntime(); const port = getMobileRuntime()!;
    let complete!: (result: unknown) => void;
    native.request.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const response = port.fetch(`/mobile/${provider}/login/status`);
    port.write(provider, 'cookie', port.read(provider, 'cookie'));
    port.write(provider === 'qq' ? 'netease' : 'qq', 'cookie', 'other-platform-session');
    complete({ status: 200, body: '{"account":"current"}', headers: {} });
    expect(await (await response).json()).toEqual({ account: 'current' });
    await runtime.flushSessions();
  });
  it('does not revalidate an old reply when credentials change away and back', async () => {
    const runtime = await import('../../../src/mobile/runtime');
    const { getMobileRuntime } = await import('../../../src/services/mobileRuntime');
    await runtime.initializeRuntime(); const port = getMobileRuntime()!;
    let complete!: (result: unknown) => void;
    native.request.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const response = port.fetch('/mobile/qq/user/playlist');
    const assertion = expect(response).rejects.toMatchObject({ name: 'AbortError' });
    port.write('qq', 'cookie', 'other-session'); port.write('qq', 'cookie', 'fixture');
    complete({ status: 200, body: '{}', headers: {} });
    await assertion; await runtime.flushSessions();
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
  it.each(['qq', 'netease'])('isolates a failed %s save without clearing its durable error', async provider => {
    const other = provider === 'qq' ? 'netease' : 'qq';
    native.saveSession.mockImplementation(async args => { if (args.provider === provider) throw Error('secure-storage'); });
    const runtime = await import('../../../src/mobile/runtime');
    const { getMobileRuntime } = await import('../../../src/services/mobileRuntime');
    await runtime.initializeRuntime(); const port = getMobileRuntime()!;
    port.write(provider, 'cookie', 'pending-account');
    await expect(runtime.flushSessions([other])).resolves.toBeUndefined();
    await expect(runtime.flushSessions([provider])).rejects.toThrow('secure-storage');
    await expect(runtime.flushSessions([other, provider])).rejects.toThrow('secure-storage');
    await expect(runtime.flushSessions()).rejects.toThrow('secure-storage');
    port.write(other, 'cookie', 'other-account');
    await expect(runtime.flushSessions([other])).resolves.toBeUndefined();
    await expect(runtime.flushSessions([provider])).rejects.toThrow('secure-storage');
    native.saveSession.mockResolvedValue(undefined); port.write(provider, 'cookie', 'pending-account');
    await expect(runtime.flushSessions([provider, other])).resolves.toBeUndefined();
  });
  it.each(['qq', 'netease'])('waits for the actual %s save before accepting a scoped operation', async provider => {
    let finish!: () => void, accepted = false;
    native.saveSession.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const runtime = await import('../../../src/mobile/runtime');
    const { getMobileRuntime } = await import('../../../src/services/mobileRuntime');
    await runtime.initializeRuntime(); getMobileRuntime()!.write(provider, 'cookie', 'pending-account');
    const waiting = runtime.flushSessions([provider]).then(() => { accepted = true; });
    await vi.waitFor(() => expect(finish).toBeTypeOf('function')); expect(accepted).toBe(false);
    finish(); await waiting; expect(accepted).toBe(true);
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
  it.each(['qq', 'netease'])('still clears %s after cancellation fails, without a queued save restoring it', async provider => {
    const other = provider === 'qq' ? 'netease' : 'qq';
    const durable: Record<string, Record<string, string>> = {
      qq: { cookie: 'synthetic-qq' }, netease: { cookie: 'synthetic-netease' },
    };
    native.bootstrap.mockImplementation(async () => ({ server: 'https://music.example.com', scope: 'original', sessions: structuredClone(durable) }));
    const runtime = await import('../../../src/mobile/runtime');
    const { getMobileRuntime } = await import('../../../src/services/mobileRuntime');
    await runtime.initializeRuntime(); const port = getMobileRuntime()!;
    let finishRequest!: (value: unknown) => void, finishSave!: () => void;
    native.request.mockImplementationOnce(() => new Promise(resolve => { finishRequest = resolve; }));
    const response = port.fetch(`/mobile/${provider}/user/playlist`).catch(error => error);
    native.cancelRequests.mockRejectedValue(new Error('cancel-bridge-failed'));
    native.saveSession.mockImplementationOnce(async ({ provider, values }) => {
      await new Promise<void>(resolve => { finishSave = resolve; }); durable[provider] = values;
    });
    native.clearSession.mockImplementationOnce(async ({ provider }) => { delete durable[provider]; });
    port.write(provider, 'cookie', 'pending-save');
    await vi.waitFor(() => expect(finishSave).toBeTypeOf('function'));
    const intent = runtime.captureProviderSession(provider);
    const logout = runtime.clearProvider(provider).catch(error => error);
    await vi.waitFor(() => expect(native.cancelRequests).toHaveBeenCalledOnce());
    expect(intent()).toBe(false); expect(native.clearSession).not.toHaveBeenCalled();
    finishSave();
    expect(await logout).toMatchObject({ message: 'cancel-bridge-failed' });
    finishRequest({ status: 200, body: '{}', headers: {} });
    expect(await response).toMatchObject({ name: 'AbortError' });
    await runtime.flushSessions();
    expect(native.clearSession).toHaveBeenCalledExactlyOnceWith({ provider, scope: 'original' });
    expect(durable[provider]).toBeUndefined(); expect(port.read(provider, 'cookie')).toBeNull();
    expect(durable[other]).toEqual({ cookie: 'synthetic-' + other });
    expect(port.read(other, 'cookie')).toBe('synthetic-' + other);
    native.request.mockResolvedValueOnce({ status: 200, body: '{}', headers: {} });
    await expect(port.fetch(`/mobile/${other}/user/playlist`)).resolves.toBeInstanceOf(Response);
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
