import { describe, expect, it } from 'vitest';
import { deflateSync } from 'node:zlib';
import { decodeNativeFolderLyrics } from '@/mobile/nativeFolderLyrics';
import { decodeNativeLyricFile } from '@/mobile/nativeLyricFile';
import { decodeLyricFileBytes } from '@/utils/lyrics/lyricFileDecoding';

// nativeFolderLyrics.test.ts — the same byte decoder serves manual imports and selected folder sidecars.
const file = (bytes: Uint8Array, fileName = 'song.lrc') => ({ data: Buffer.from(bytes).toString('base64'), fileName });
describe('native folder lyric decoding', () => {
  it('preserves original UTF BOM, GBK, line-ending and malformed-byte behavior', async () => {
    const bytes = [
      Buffer.from('[00:00.00]中文\r\r\n[00:01.00]末尾\r', 'utf8'),
      Buffer.from('\ufeff[00:00.00]中文', 'utf8'),
      Buffer.from('\ufeff[00:00.00]中文', 'utf16le'),
      new Uint8Array([0xfe, 0xff, 0, 0x5b, 0, 0x30, 0, 0x30, 0, 0x3a, 0, 0x30, 0, 0x30, 0, 0x5d, 0x8f, 0xc7, 0x70, 0x6b]),
      new Uint8Array([...Buffer.from('[00:00.00]'), 0xb9, 0xfd, 0xbb, 0xf0]),
      new Uint8Array([...Buffer.from('[00:00.00]'), 0x81, 0x20, ...Buffer.from('End')]),
    ];
    for (const input of bytes) {
      expect(await decodeNativeLyricFile(file(input))).toBe(await decodeLyricFileBytes(input));
    }
    expect(await decodeNativeLyricFile(file(bytes[4]))).toBe('[00:00.00]过火');
    expect(await decodeNativeLyricFile(file(bytes[5]))).toBe('[00:00.00]� End');
    const result = await decodeNativeFolderLyrics({ lyric: file(bytes[0]), translation: file(bytes[4], 'song.t.lrc') });
    expect(result).toEqual({ lyric: '[00:00.00]中文\n\n[00:01.00]末尾\n', translation: '[00:00.00]过火' });
  });
  it('decrypts KRC with the original key/inflater and bounds expanded payloads', async () => {
    const key = [64, 71, 97, 119, 94, 50, 116, 71, 81, 54, 49, 45, 206, 210, 110, 105];
    const encrypt = (text: string) => Buffer.concat([Buffer.from('krc1'), deflateSync(text).map((byte, index) => byte ^ key[index % key.length])]);
    const content = '[0,1000]<0,1000,0>原文\r\n';
    expect(await decodeNativeFolderLyrics({ lyric: file(encrypt(content), 'song.krc') })).toEqual({ lyric: content.replace('\r\n', '\n') });
    await expect(decodeNativeLyricFile(file(encrypt('a'.repeat(2_000_001)), 'song.krc'))).rejects.toThrow('lyrics-too-large');
  });
  it('allows empty sidecars but rejects oversized and malformed bridge input', async () => {
    expect(await decodeNativeFolderLyrics({ lyric: file(new Uint8Array()) })).toEqual({ lyric: '' });
    expect(await decodeNativeFolderLyrics({})).toEqual({});
    await expect(decodeNativeLyricFile({ data: '%', fileName: 'song.lrc' })).rejects.toThrow();
    await expect(decodeNativeLyricFile(file(Buffer.alloc(2_000_001)))).rejects.toThrow();
    await expect(decodeNativeLyricFile(file(Buffer.from('x'), '歌'.repeat(342)))).rejects.toThrow();
  });
  it('returns no decoded batch after cancellation', async () => {
    const controller = new AbortController(), input = { lyric: file(Buffer.from('[00:00.00]OK')) };
    const task = decodeNativeFolderLyrics(input, controller.signal);
    controller.abort();
    await expect(task).rejects.toMatchObject({ name: 'AbortError' });
    await expect(decodeNativeFolderLyrics(input, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});
