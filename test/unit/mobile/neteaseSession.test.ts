import { beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/mobile/neteaseSession.test.ts — exercise actual NetEase auth and mobile storage across body parsing.
const native = vi.hoisted(() => ({
  bootstrap: vi.fn(), saveSession: vi.fn(), clearSession: vi.fn(), request: vi.fn(), cancelRequests: vi.fn(),
}));
vi.mock('../../../src/mobile/bridge', () => ({ native }));

describe('mobile NetEase authentication session ownership', () => {
  beforeEach(() => {
    vi.resetModules(); vi.resetAllMocks();
    native.bootstrap.mockResolvedValue({ server: 'https://music.example.com', scope: 'original', sessions: {
      netease: { cookie: 'old-session' }, qq: { cookie: 'qqmusic_session=unchanged' },
    } });
    native.saveSession.mockResolvedValue(undefined); native.clearSession.mockResolvedValue(undefined);
    native.cancelRequests.mockResolvedValue(undefined);
    native.request.mockImplementation(async ({ payload }) => {
      let body: unknown;
      if (payload.path.startsWith('/login/qr/check?')) body = { code: 803, cookie: 'late-session' };
      else if (payload.path.startsWith('/login/status?')) body = { code: 200, cookie: 'late-session', data: { profile: { userId: 7 } } };
      else if (payload.path.startsWith('/user/account?')) body = { code: 200, account: { id: 7 }, profile: { userId: 7, nickname: 'Account fixture' } };
      else throw new Error('Unexpected auth route in session test');
      return { status: 200, body: JSON.stringify(body), headers: {} };
    });
  });

  it.each(['qr', 'status-first', 'status-account'].flatMap(operation =>
    ['replace', 'cancel', 'replace-back', 'logout'].map(action => ({ operation, action }))))(
    'rejects stale NetEase auth after $action during $operation body parsing', async ({ operation, action }) => {
    const runtime = await import('../../../src/mobile/runtime');
    const { getMobileRuntime } = await import('../../../src/services/mobileRuntime');
    const { neteaseProvider } = await import('../../../src/services/onlineMusic/neteaseProvider');
    await runtime.initializeRuntime(); const port = getMobileRuntime()!;
    let reading!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => { reading = resolve; });
    const released = new Promise<void>(resolve => { release = resolve; });
    const readText = Response.prototype.text;
    const body = vi.spyOn(Response.prototype, 'text');
    // Account verification is the second response; QR confirmation has only one response.
    if (operation === 'status-account') body.mockImplementationOnce(function (this: Response) { return readText.call(this); });
    body.mockImplementationOnce(async function (this: Response) {
      reading(); await released; return readText.call(this);
    });
    try {
      const pending = (operation === 'qr' ? neteaseProvider.auth!.checkQr!('old-key')
        : neteaseProvider.auth!.getLoginStatus()).catch(error => error);
      await started;
      if (action === 'cancel') await runtime.cancelProvider('netease');
      else if (action === 'logout') await runtime.clearProvider('netease');
      else {
        port.write('netease', 'cookie', 'replacement-session');
        if (action === 'replace-back') port.write('netease', 'cookie', 'old-session');
      }
      const expected = port.read('netease', 'cookie');
      await runtime.flushSessions();
      const writes = native.saveSession.mock.calls.map(([args]) => args.values);
      release(); const result = await pending; await runtime.flushSessions();
      expect(port.read('netease', 'cookie')).toBe(expected);
      expect(port.read('qq', 'cookie')).toBe('qqmusic_session=unchanged');
      expect(native.saveSession.mock.calls.map(([args]) => args.values)).toEqual(writes);
      expect(result).toMatchObject({ name: 'AbortError' });
      expect(native.request).toHaveBeenCalledTimes(operation === 'status-account' ? 2 : 1);
    } finally { release(); body.mockRestore(); }
  });
  it.each(['qr', 'status'].flatMap(operation => ['other-provider', 'same-cookie'].map(action => ({ operation, action }))))(
    'accepts current $operation authentication after $action changes during parsing', async ({ operation, action }) => {
    const runtime = await import('../../../src/mobile/runtime');
    const { getMobileRuntime } = await import('../../../src/services/mobileRuntime');
    const { neteaseProvider } = await import('../../../src/services/onlineMusic/neteaseProvider');
    await runtime.initializeRuntime(); const port = getMobileRuntime()!;
    const readText = Response.prototype.text;
    const body = vi.spyOn(Response.prototype, 'text').mockImplementationOnce(async function (this: Response) {
      if (action === 'other-provider') port.write('qq', 'cookie', 'qqmusic_session=replacement');
      else port.write('netease', 'cookie', 'old-session');
      return readText.call(this);
    });
    try {
      const result = await (operation === 'qr' ? neteaseProvider.auth!.checkQr!('current-key')
        : neteaseProvider.auth!.getLoginStatus());
      await runtime.flushSessions();
      expect(result).toMatchObject(operation === 'qr' ? { state: 'confirmed' } : { id: 7, nickname: 'Account fixture' });
      expect(port.read('netease', 'cookie')).toBe('late-session');
      expect(port.read('qq', 'cookie')).toBe(action === 'other-provider' ? 'qqmusic_session=replacement' : 'qqmusic_session=unchanged');
    } finally { body.mockRestore(); }
  });
});
