import type { SongResult } from '../../../types';
import { getOriginalCoverUrl } from '../../coverUrl';

// qqLyricSearch.ts — original QQ lyric search parameters and response mapping, free of Web transport.
export function qqLyricSearchParams(safeKeyword: string, page: number, pageSize: number) {
  const pagesize = pageSize;
  return {
    search_id: String(
      Math.floor(
        Math.random() * 100000000000000 + Date.now() % 86400000
      )
    ),
    remoteplace: "search.android.keyboard",
    query: safeKeyword.length > 60 ? safeKeyword.slice(0, 60) : safeKeyword,
    search_type: 0, // 0 = SONG
    num_per_page: pagesize,
    page_num: page,
    highlight: 0,
    nqc_flag: 0,
    page_id: 1,
    grp: 1,
  };

}

export function normalizeQQLyricSearch(data: any): SongResult[] {
    const songs = data?.body?.item_song || [];
    
    return songs.map((info: any) => {
      const artists = (info.singer || []).map((s: any, idx: number) => ({
        id: s.id || idx,
        name: s.name || 'Unknown Artist',
      }));
      
      const albumMid = info.album?.mid;
      const picUrl = albumMid
        ? getOriginalCoverUrl(`https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}.jpg?max_age=2592000`)
        : undefined;

      return {
        id: Number(info.id || 0),
        name: info.title || 'Unknown Song',
        artists,
        album: {
          id: Number(info.album?.id || 0),
          name: info.album?.name || 'Unknown Album',
          coverUrl: picUrl,
        },
        durationMs: (info.interval || 0) * 1000,
        qqMid: info.mid,
      };
    });
}
