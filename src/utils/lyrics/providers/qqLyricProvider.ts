import { getMobileRuntime, providerFetch } from '../../../services/mobileRuntime';
// src/utils/lyrics/providers/qqLyricProvider.ts

/**
 * QQ Music lyrics provider module.
 * Provides search and download/decryption capabilities for QQ Music lyrics.
 */

import { SongResult } from '../../../types';
import { OnlineProviderError } from '../../../types/onlineMusic';
import { qrcDecrypt } from './qrcDecrypt';
import { qqRequestPayload, qqLyricParams, parseQQLyricText } from './qqLyricProtocol';
import type { NeteaseChorusRange } from '../chorusEffects';
import { qqLyricSearchParams, normalizeQQLyricSearch } from './qqLyricSearch';

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
  if (data?.code !== 0 || data?.request?.code !== 0) {
    const codes = [data?.code, data?.request?.code];
    const code = codes.find(value => typeof value === 'number' && Number.isFinite(value) && value !== 0);
    // This request is anonymous: a business rejection says nothing about the saved account session.
    throw new OnlineProviderError(code === undefined ? 'invalid-response' : 'unavailable',
      code === undefined ? 'QQ Music API returned an invalid response' : `QQ Music API error: code ${code}`, 'qq');
  }

  return data.request.data;
}

/**
 * Searches songs on QQ Music.
 */
export async function searchQQLyrics(keyword: string, page = 1, pageSize = 20): Promise<SongResult[]> {
  const safeKeyword = keyword.trim();
  if (!safeKeyword) return [];

  const param = qqLyricSearchParams(safeKeyword, page, pageSize);

  try {
    const data = await requestQQ("DoSearchForQQMusicLite", "music.search.SearchCgiService", param);
    return normalizeQQLyricSearch(data);
  } catch (error) {
    // Native callers must distinguish a failed gateway/provider request from an empty search.
    if (getMobileRuntime()) throw error;
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
