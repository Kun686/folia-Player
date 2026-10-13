import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '../../../src/types';
import { omni } from '../../../src/services/onlineMusic/omni';
import { mobileSongInfo } from '../../../src/mobile/songInfo';

// songInfo.test.ts — public-page capability is separate from media resolution and private source fields.
vi.mock('../../../src/services/onlineMusic/omni', () => ({ omni: { getSongPageUrl: vi.fn() } }));
const song: SongResult = { id: 42, name: 'Song', artists: [{ id: 7, name: 'Artist' }], album: { id: 8, name: 'Album' },
  durationMs: 123000, sourceRef: { kind: 'online', providerId: 'netease', mediaId: '42' } };
beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal('fetch', vi.fn()); });
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });
describe('mobile song information', () => {
  it('uses the public page from Omni and excludes private provider fields', () => {
    vi.mocked(omni.getSongPageUrl).mockReturnValue('https://music.163.com/#/song?id=42');
    const input = { ...song, providerData: { cookie: 'private-cookie', url: 'https://cdn.invalid/signed?token=private' } };
    expect(mobileSongInfo(input)).toMatchObject({ pageUrl: 'https://music.163.com/#/song?id=42',
      text: 'Song - Artist - Album\nhttps://music.163.com/#/song?id=42' });
    expect(omni.getSongPageUrl).toHaveBeenCalledExactlyOnceWith(input);
  });
  it('does not manufacture a page for a provider without that capability', () => {
    vi.mocked(omni.getSongPageUrl).mockReturnValue(null);
    const qq = { ...song, sourceRef: { kind: 'online' as const, providerId: 'qq', mediaId: 'mid' } };
    expect(mobileSongInfo(qq)).toMatchObject({ pageUrl: null, text: 'Song - Artist - Album' });
    expect(omni.getSongPageUrl).toHaveBeenCalledExactlyOnceWith(qq);
  });
  it('copies local metadata without asking an online provider for a page', () => {
    expect(mobileSongInfo({ ...song, sourceRef: { kind: 'local', mediaId: 'local-id' } }))
      .toMatchObject({ pageUrl: null, text: 'Song - Artist - Album' });
    expect(omni.getSongPageUrl).not.toHaveBeenCalled();
  });
  it('preserves copyable metadata when page lookup is unavailable', () => {
    vi.mocked(omni.getSongPageUrl).mockImplementation(() => { throw Error('unsupported'); });
    expect(mobileSongInfo(song)).toMatchObject({ pageUrl: null, text: 'Song - Artist - Album' });
  });
  it.each(['javascript:alert(1)', 'data:text/html,secret', 'http://music.163.com/song',
    'https://user:secret@music.163.com/song', '/relative-song'])('rejects an unsafe external page %s', value => {
    vi.mocked(omni.getSongPageUrl).mockReturnValue(value);
    expect(mobileSongInfo(song)).toMatchObject({ pageUrl: null, text: 'Song - Artist - Album' });
  });
});
