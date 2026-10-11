import { Buffer } from 'buffer';
import type { LocalMatchDocument } from '../../types/localSongMatch';
import type { LocalSongOnlineMetadata } from '../../types/localLibrary';
import { validateNativeLyricData } from './nativeCacheRuntime';

// nativeLocalMatchRuntime.ts — bounded native storage schema; original parsed lyric documents are validated unchanged.
const invalid = (): never => { throw new Error('invalid-local-match'); };
const object = (x: unknown): Record<string, unknown> => {
  if (!x || typeof x !== 'object' || Array.isArray(x)) invalid();
  return x as Record<string, unknown>;
};
const text = (x: unknown, max = 512): string => typeof x === 'string' && Buffer.byteLength(x, 'utf8') <= max ? x : invalid();
const id = (x: unknown): number | string | undefined => x === undefined ? undefined
  : typeof x === 'number' && Number.isSafeInteger(x) ? x : typeof x === 'string' ? text(x, 128) : invalid();
function online(value: unknown): LocalSongOnlineMetadata | undefined {
  if (value === undefined) return undefined;
  const v = object(value);
  if (!['netease', 'qq', 'kugou'].includes(v.source as string) || !['auto', 'manual', 'legacy'].includes(v.matchMode as string)
    || typeof v.matchedAt !== 'number' || !Number.isFinite(v.matchedAt) || !Array.isArray(v.artists) || v.artists.length > 100) invalid();
  const album = v.album === undefined ? undefined : object(v.album);
  return { source: v.source as LocalSongOnlineMetadata['source'], songId: id(v.songId), albumId: id(v.albumId),
    title: v.title === undefined ? undefined : text(v.title),
    artists: (v.artists as unknown[]).map(x => { const item = object(x); return { id: id(item.id), name: text(item.name) }; }),
    album: album ? { id: id(album.id), name: text(album.name) } : undefined,
    coverUrl: v.coverUrl === undefined ? undefined : text(v.coverUrl, 4096),
    matchMode: v.matchMode as LocalSongOnlineMetadata['matchMode'], matchedAt: v.matchedAt as number };
}
export function localMatchJSON(input: string): string {
  if (typeof input !== 'string' || Buffer.byteLength(input, 'utf8') > 8_000_000) invalid();
  const v = object(JSON.parse(input));
  if (!['import', 'manual-match', 'auto-match'].includes(v.titleOrigin as string)
    || !Array.isArray(v.artistNames) || v.artistNames.length > 100) invalid();
  const result: LocalMatchDocument = { title: text(v.title), titleOrigin: v.titleOrigin as LocalMatchDocument['titleOrigin'],
    artistNames: (v.artistNames as unknown[]).map(x => text(x)),
    albumName: v.albumName === undefined ? undefined : text(v.albumName), onlineMetadata: online(v.onlineMetadata) };
  for (const key of ['useOnlineCover', 'noAutoMatch', 'matchedIsPureMusic', 'hasManualLyricSelection'] as const) {
    if (v[key] !== undefined) { if (typeof v[key] !== 'boolean') invalid(); result[key] = v[key] as boolean; }
  }
  if (v.matchedLyrics !== undefined) result.matchedLyrics = validateNativeLyricData(v.matchedLyrics) ?? undefined;
  result.matchedLyricsSongId = id(v.matchedLyricsSongId);
  if (v.matchedLyricsSource !== undefined) {
    if (!['netease', 'qq', 'kugou', 'amll'].includes(v.matchedLyricsSource as string)) invalid();
    result.matchedLyricsSource = v.matchedLyricsSource as LocalMatchDocument['matchedLyricsSource'];
  }
  if (v.matchedLyricsProviderPlatform !== undefined) {
    if (!['ncm', 'qq'].includes(v.matchedLyricsProviderPlatform as string)) invalid();
    result.matchedLyricsProviderPlatform = v.matchedLyricsProviderPlatform as LocalMatchDocument['matchedLyricsProviderPlatform'];
  }
  return JSON.stringify(result);
}
