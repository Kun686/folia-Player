import { describe, expect, it } from 'vitest';
import { mobilePlaylistFileName, readMobilePlaylistFile } from '../../../src/mobile/localPlaylistFiles';

// localPlaylistFiles.test.ts — mobile file bounds and Unicode filenames for the native filesystem.
describe('mobile M3U files', () => {
  it('reads UTF-8 BOM, original playlist names and extension fallback', async () => {
    expect(await readMobilePlaylistFile(new File(['\ufeff#EXTM3U\r\n#PLAYLIST:通勤\r\n歌.wav\r\n'], 'a.M3U8')))
      .toMatchObject({ name: '通勤' });
    expect((await readMobilePlaylistFile(new File(['歌.wav'], '夜晚.m3u'))).name).toBe('夜晚');
  });
  it('rejects wrong extensions, size/entry excess, binary and malformed UTF-8', async () => {
    const files = [new File(['x'], 'a.zip'), new File(['x'.repeat(2_000_001)], 'a.m3u'),
      new File(['song.wav\n'.repeat(10_001)], 'a.m3u8'), new File(['\0'], 'a.m3u'),
      new File([new Uint8Array([0xff, 0xfe, 0x41])], 'a.m3u')];
    for (const file of files) await expect(readMobilePlaylistFile(file)).rejects.toThrow();
  });
  it('sanitizes share filenames and bounds UTF-8 bytes without splitting emoji', () => {
    for (const title of ['../路径', '.hidden', 'CON', '歌'.repeat(256), '😀'.repeat(256), '...']) {
      const name = mobilePlaylistFileName(title);
      expect(name).not.toMatch(/^[.]|[\r\n/:\\]/);
      expect(name).toMatch(/\.m3u8$/);
      expect(new TextEncoder().encode(name).length).toBeLessThanOrEqual(255);
      expect(name).not.toContain('\ufffd');
    }
  });
});
