import type { AmllDbPlatform, SongResult } from '../../../types';

// amllDbIdentity.ts — original AMLL ID order without a browser transport or shared cache.
export type AmllDbMusicId = number | string | null | undefined;

export const normalizeMusicIds = (ids: readonly AmllDbMusicId[]): string[] => ids
    .map(id => String(id ?? '').trim())
    .filter((id, index, all) => id && all.indexOf(id) === index);

// AMLL 里 QQ 歌曲有的按 mid 收录，有的按数字 ID 收录（约 2:1），两种都要试；mid 在前
export function getAmllDbMusicIds(
    platform: AmllDbPlatform,
    song: Pick<SongResult, 'id' | 'qqMid'>,
): string[] {
    return normalizeMusicIds(platform === 'qq' ? [song.qqMid, song.id] : [song.id]);
}
