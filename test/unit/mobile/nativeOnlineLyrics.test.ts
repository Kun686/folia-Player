import { describe, expect, it, vi } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync, inflateSync } from 'node:zlib';
import { stripTypeScriptTypes } from 'node:module';
import { stepJSON } from '@/services/onlineMusic/nativeLyricRuntime';
import { qrcDecrypt } from '@/utils/lyrics/providers/qrcDecrypt';
import { fetchQQLyrics } from '@/utils/lyrics/providers/qqLyricProvider';
import { processNeteaseLyrics } from '@/utils/lyrics/neteaseProcessing';
import { getProcessedLyricPayload } from '@/utils/lyrics/neteasePayload';
import { plannerLinesJSON } from '@/utils/lyrics/nativeLocalRuntime';
import type { SongResult } from '@/types';

// Native reference inputs are synthetic lyrics encrypted by the original inverse transform, never account data.
vi.mock('@/utils/lyrics/workerClient', async () => {
  const { parseLyricsByFormat } = await import('@/utils/lyrics/parserCore');
  return { parseLyricsAsync: (...args: Parameters<typeof parseLyricsByFormat>) => Promise.resolve(parseLyricsByFormat(...args)) };
});
function encryptQRC(text: string) {
  const source = readFileSync(new URL('../../../src/utils/lyrics/providers/qrcDecrypt.ts', import.meta.url), 'utf8');
  const compiled = stripTypeScriptTypes(source).replace(/^export /gm, '');
  const exports: any = {};
  new Function('exports', compiled + `\nexports.encrypt = bytes => {
    const schedule = tripledes_key_setup(Uint8Array.from('!@#)(*$%123ZXC!@!@#)(NHL', c => c.charCodeAt(0)), 1);
    const out = new Uint8Array(Math.ceil(bytes.length / 8) * 8);
    for (let i = 0; i < out.length; i += 8) {
      const block = new Uint8Array(8); block.set(bytes.subarray(i, i + 8));
      out.set(tripledes_crypt(block, schedule), i);
    }
    return out;
  };`)(exports);
  return Buffer.from(exports.encrypt(deflateSync(text))).toString('hex');
}
const inflate = (base64: string) => inflateSync(Buffer.from(base64, 'base64'), { maxOutputLength: 2_000_000 }).toString('utf8');
const reply = (body: unknown, status = 200) => ({ status, body: JSON.stringify(body) });
const song = (provider: 'netease' | 'qq', cloud = false): SongResult => ({
  id: provider === 'qq' ? 'mid42' : 42, name: '合成测试', artists: [{ id: 1, name: '测试' }],
  album: { id: 2, name: '测试专辑' }, durationMs: 30000,
  sourceRef: { kind: 'online', providerId: provider, mediaId: provider === 'qq' ? 'mid42' : '42',
    ...(provider === 'qq' ? { providerData: { songId: 42 } } : {}), ...(cloud ? { variant: 'cloud' } : {}) },
});
const fixture = new URL('../../../ios/App/NativeTests/OnlineLyricReference.json', import.meta.url);

describe('native online lyric adapter', () => {
  it('reuses original QQ decryption and NetEase response parsing and records native protocol references', async () => {
    const text = '[1000,25000]合成测试(0,25000)', encrypted = encryptQRC(text);
    expect(await qrcDecrypt(encrypted)).toBe(text);
    const qq = { code: 0, request: { code: 0, data: { lyric: encrypted, trans: encryptQRC('[00:01.00]翻译'), roma: encryptQRC('[00:01.00]Fan yi') } } };
    const legacy = song('qq'); if (legacy.sourceRef?.kind === 'online') delete legacy.sourceRef.providerData;
    const inputs = [
      { name: 'netease-lrc', song: song('netease'), bodies: [{ code: 200, lrc: { lyric: '[00:01.00]普通歌词\n[00:26.00]' } }] },
      { name: 'netease-yrc', song: song('netease'), bodies: [{ code: 200, data: { yrc: { lyric: '[1000,25000](1000,25000,0)合成测试' }, lrc: { lyric: '[00:00.00]wrong fallback' } } }] },
      { name: 'netease-pure', song: song('netease'), bodies: [{ code: 200, pureMusic: true, lrc: { lyric: '纯音乐，请欣赏' } }] },
      { name: 'netease-cloud', song: song('netease', true), bodies: [{ code: 200, account: { id: 9 } }, { code: 200, data: { lyric: '[00:01.00]云盘歌词' } }] },
      { name: 'qq-qrc', song: song('qq'), bodies: [qq] },
      { name: 'qq-legacy-identity', song: legacy, bodies: [{ response: { songinfo: { data: { track_info: { id: 42, mid: 'mid42', title: '合成测试', interval: 30 } } } } }, qq] },
      { name: 'qq-no-lyrics', song: song('qq'), bodies: [{ code: 0, request: { code: 0, data: {} } }] },
    ];
    const rows = [];
    for (const input of inputs) {
      const session = { cookie: 'test-platform-session' }, responses: ReturnType<typeof reply>[] = [], steps = [];
      for (let index = 0; index <= input.bodies.length; index++) {
        const request = { version: 1, song: input.song, session, responses: [...responses] };
        const expected = JSON.parse(stepJSON(JSON.stringify(request), inflate));
        steps.push({ input: request, expected });
        if (index < input.bodies.length) {
          expect(expected.request).toBeDefined();
          if (expected.request.provider === 'lyrics') {
            expect(JSON.stringify(expected.request)).not.toContain(session.cookie);
            expect(JSON.parse(expected.request.body).request.param.songID).toBe(42);
          }
          responses.push(reply(input.bodies[index]));
        }
      }
      const last = steps.at(-1)!.expected;
      let original;
      if (input.name.startsWith('qq')) {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(input.bodies.at(-1)))));
        try { original = await fetchQQLyrics({ ...input.song, id: 42, qqMid: 'mid42' }); }
        finally { vi.unstubAllGlobals(); }
      } else {
        const raw = input.name === 'netease-cloud' ? { type: 'netease' as const, lrc: { lyric: '[00:01.00]云盘歌词' } } : getProcessedLyricPayload(input.bodies.at(-1));
        original = (await processNeteaseLyrics(raw)).lyrics;
      }
      expect(last.lines, input.name).toEqual(JSON.parse(plannerLinesJSON(original)));
      rows.push({ name: input.name, steps });
    }
    if (process.env.FOLIA_ONLINE_LYRIC_REFERENCE === '1') writeFileSync(fixture, JSON.stringify(rows) + '\n');
    expect(JSON.parse(readFileSync(fixture, 'utf8'))).toEqual(rows);
  });
  it('rejects invalid identities, authentication failures and malformed or oversized encrypted data', () => {
    const base = { version: 1, song: song('qq'), responses: [] };
    for (const value of [null, { ...base, version: 2 }, { ...base, song: { id: 42 } },
      { ...base, responses: [reply({}, 401)] }, { ...base, responses: [reply({}, 429)] },
      { ...base, responses: [{ body: '{}' }] }, { ...base, session: [] },
      { ...base, song: { sourceRef: { kind: 'online', providerId: 'qq' } } },
      { ...base, responses: [reply({ code: 0, request: { code: 0, data: { lyric: 'garbage' } } })] },
      { ...base, responses: [reply({ code: 0, request: { code: 0, data: { lyric: 'ab'.repeat(1_000_001) } } })] }]) {
      expect(() => stepJSON(JSON.stringify(value), inflate)).toThrow();
    }
    expect(JSON.parse(stepJSON(JSON.stringify(base), inflate)).request.provider).toBe('lyrics');
  });
});
