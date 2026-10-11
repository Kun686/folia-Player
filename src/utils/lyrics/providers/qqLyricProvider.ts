import { getMobileRuntime, providerFetch } from '../../../services/mobileRuntime';
// src/utils/lyrics/providers/qqLyricProvider.ts

/**
 * QQ Music lyrics provider module.
 * Provides search and download/decryption capabilities for QQ Music lyrics.
 */

import { SongResult } from '../../../types';
import { qrcDecrypt } from './qrcDecrypt';
import { qqRequestPayload, qqLyricParams, parseQQLyricText } from './qqLyricProtocol';
import type { NeteaseChorusRange } from '../chorusEffects';
import { getOriginalCoverUrl } from '../../coverUrl';

const isElectron = typeof window !== 'undefined' && (window as any).electron;

/**
 * Sends a POST request to u.y.qq.com via proxy or directly in Electron.
 */
async function requestQQ(method: string, module: string, param: any): Promise<any> {
  const payload = qqRequestPayload(method, module, param);

  const targetUrl = 'https://u.y.qq.com/cgi-bin/musicu.fcg';
  const url = isElectron ? targetUrl : `/api/lyric-proxy?url=${encodeURIComponent(targetUrl)}`;

  const response = await providerFetch(url, {
    method: 'POST',
    credentials: isElectron ? 'omit' : 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': 'tmeLoginType=-1;',
      'User-Agent': 'okhttp/3.14.9',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`QQ Music API request failed: ${response.status}`);
  }

  const data = await response.json();
  if (data.code !== 0 || data.request?.code !== 0) {
    throw new Error(`QQ Music API error: code ${data.code || data.request?.code}`);
  }

  return data.request.data;
}

/**
 * Searches songs on QQ Music.
 */
export async function searchQQLyrics(keyword: string, page = 1, pageSize = 20): Promise<SongResult[]> {
  const safeKeyword = keyword.trim();
  if (!safeKeyword) return [];

  const pagesize = pageSize;
  const param = {
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

  try {
    const data = await requestQQ("DoSearchForQQMusicLite", "music.search.SearchCgiService", param);
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
  } catch (error) {
    console.error('[QQMusic] Search failed:', error);
    return [];
  }
}

/**
 * Fetches and decrypts QQ Music lyrics.
 */
export async function fetchQQLyrics(
  song: SongResult,
  options: { chorusRanges?: NeteaseChorusRange[] } = {}
): Promise<any | null> {
  if (!song.id || !song.qqMid) {
    throw new Error('Missing song ID or mid');
  }

  const param = qqLyricParams(song);

  try {
    const data = await requestQQ("GetPlayLyricInfo", "music.musichallSong.PlayLyricInfo", param);
    const encryptedLyricHex = data?.lyric;
    const encryptedTransHex = data?.trans;
    const encryptedRomanizationHex = data?.roma;

    if (!encryptedLyricHex) {
      return null;
    }

    const decryptedLyric = await qrcDecrypt(encryptedLyricHex);
    const decryptedTrans = encryptedTransHex ? await qrcDecrypt(encryptedTransHex) : '';
    const decryptedRomanization = encryptedRomanizationHex ? await qrcDecrypt(encryptedRomanizationHex) : '';

    return parseQQLyricText(decryptedLyric, decryptedTrans, decryptedRomanization, options);
  } catch (error) {
    console.error('[QQMusic] Fetch lyrics failed:', error);
    return null;
  }
}
