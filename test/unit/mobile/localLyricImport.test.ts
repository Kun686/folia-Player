import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deflateSync } from 'node:zlib';
import { importMobileLocalLyrics } from '@/mobile/localLyricImport';
import { native } from '@/mobile/bridge';

// localLyricImport.test.ts — real original bytes/format parser; only the system picker and durable write are replaced.
vi.mock('@/mobile/bridge', () => ({ native: { pickLyricFile: vi.fn(), saveLocalLyrics: vi.fn() } }));
vi.mock('@/utils/lyrics/workerClient', async () => {
  const { parseLyricsByFormat } = await import('@/utils/lyrics/parserCore');
  return { parseLyricsAsync: (...args: Parameters<typeof parseLyricsByFormat>) => Promise.resolve(parseLyricsByFormat(...args)) };
});
const key = [64, 71, 97, 119, 94, 50, 116, 71, 81, 54, 49, 45, 206, 210, 110, 105];
const krc = (text: string) => Buffer.concat([Buffer.from('krc1'), Buffer.from(deflateSync(text).map((v, i) => v ^ key[i % key.length]))]);
const pick = (bytes: Uint8Array, name = '歌词.lrc') => vi.mocked(native.pickLyricFile).mockResolvedValue({
  data: Buffer.from(bytes).toString('base64'), fileName: name, token: 'revision-1',
});
beforeEach(() => { vi.resetAllMocks(); vi.mocked(native.saveLocalLyrics).mockResolvedValue(); });
describe('local file decoding before native commit', () => {
  it.each([
    ['GBK', Buffer.concat([Buffer.from('[00:01.00]'), Buffer.from([0xb9, 0xfd, 0xbb, 0xf0])]), '歌词.lrc', '[00:01.00]过火'],
    ['UTF-16', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('[00:01.00]你好\r\n', 'utf16le')]), '歌词.lrc', '[00:01.00]你好\n'],
    ['KRC', krc('[1000,2000]<0,2000,0>逐字'), '歌词.KRC', '[1000,2000]<0,2000,0>逐字'],
  ])('imports %s using the original decoder and retains its format', async (_name, bytes, fileName, content) => {
    pick(bytes, fileName);
    await expect(importMobileLocalLyrics('song', () => true)).resolves.toBe(true);
    expect(native.saveLocalLyrics).toHaveBeenCalledExactlyOnceWith({ id: 'song', token: 'revision-1', content, fileName });
  });
  it('rejects a compressed expansion before saving; the old lyric is never touched', async () => {
    pick(krc('字'.repeat(700_000)), 'huge.krc');
    await expect(importMobileLocalLyrics('song', () => true)).rejects.toThrow('lyrics-too-large');
    expect(native.saveLocalLyrics).not.toHaveBeenCalled();
  });
  it('does not save canceled selections, corrupt data, or empty timelines', async () => {
    vi.mocked(native.pickLyricFile).mockResolvedValue({ cancelled: true });
    await expect(importMobileLocalLyrics('song', () => true)).resolves.toBe(false);
    for (const bytes of [Buffer.from('krc1broken'), Buffer.from(''), Buffer.from('<unrelated/>')]) {
      pick(bytes);
      await expect(importMobileLocalLyrics('song', () => true)).rejects.toThrow();
    }
    expect(native.saveLocalLyrics).not.toHaveBeenCalled();
  });
  it('revokes a pick when the user changes song and propagates native persistence failures', async () => {
    let active = true;
    vi.mocked(native.pickLyricFile).mockImplementation(async () => {
      active = false; return { data: Buffer.from('[00:01.00]旧歌').toString('base64'), token: 'old', fileName: 'old.lrc' };
    });
    await expect(importMobileLocalLyrics('old', () => active)).rejects.toMatchObject({ name: 'AbortError' });
    expect(native.saveLocalLyrics).not.toHaveBeenCalled();
    pick(Buffer.from('[00:01.00]新歌'));
    vi.mocked(native.saveLocalLyrics).mockRejectedValue(new Error('disk-full'));
    await expect(importMobileLocalLyrics('new', () => true)).rejects.toThrow('disk-full');
  });
});
