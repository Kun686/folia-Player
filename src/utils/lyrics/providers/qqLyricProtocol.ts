import type { SongResult } from '../../../types';
import { parseLyricsByFormat } from '../parserCore';
import { detectTimedLyricFormat } from '../formatDetection';
import { applyDetectedChorusEffects, applyNeteaseChorusByTime } from '../chorusEffects';
import type { NeteaseChorusRange } from '../chorusEffects';

// qqLyricProtocol.ts — shared original provider mapping and parsing, with transport owned by each host.
export function qqRequestPayload(method: string, module: string, param: unknown) {
  return {
    comm: {
      ct: 11,
      cv: "1003006",
      v: "1003006",
      os_ver: "15",
      phonetype: "24122RKC7C",
      rom: "Redmi/miro/miro:15/AE3A.240806.005/OS2.0.102.0.VOMCNXM:user/release-keys",
      tmeAppID: "qqmusiclight",
      nettype: "NETWORK_WIFI",
      udid: "0",
      uid: "0",
    },
    request: {
      method,
      module,
      param,
    },
  };
}

/**
 * Encodes string to Base64 in UTF-8.
 */
function toBase64(str: string): string {
  try {
    return btoa(unescape(encodeURIComponent(str)));
  } catch {
    return btoa(
      encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, p1) =>
        String.fromCharCode(parseInt(p1, 16))
      )
    );
  }
}

/**
 * Detects if a lyric string is in QRC format.
 */
function detectIsQrc(content: string): boolean {
  return content.includes('(') && content.includes(')') && /\[\d+,\d+\]/.test(content);
}

export function qqLyricParams(song: SongResult, encode = toBase64) {
  const artistsStr = song.artists?.map(a => a.name).join(', ') || '';
  
  return {
    albumName: encode(song.album?.name || ''),
    crypt: 1,
    ct: 19,
    cv: 2111,
    interval: Math.floor(song.durationMs / 1000),
    lrc_t: 0,
    qrc: 1,
    qrc_t: 0,
    roma: 1,
    roma_t: 0,
    singerName: encode(artistsStr),
    songID: Number(song.id),
    songName: encode(song.name),
    trans: 1,
    trans_t: 0,
    type: 0,
  };

}

export function parseQQLyricText(decryptedLyric: string, decryptedTrans = '', decryptedRomanization = '',
  options: { chorusRanges?: NeteaseChorusRange[] } = {}) {
  const isQrc = detectIsQrc(decryptedLyric);
  const format = isQrc ? 'qrc' : detectTimedLyricFormat(decryptedLyric);

  const parsed = parseLyricsByFormat(format, decryptedLyric, decryptedTrans, {}, decryptedRomanization);
  if (!parsed) {
    return null;
  }
  parsed.isWordByWord = isQrc;
  if (options.chorusRanges && options.chorusRanges.length > 0) {
    return applyNeteaseChorusByTime(parsed, options.chorusRanges);
  }
  return applyDetectedChorusEffects(parsed, decryptedLyric);
}

export function qqLyricSong(song: SongResult): SongResult {
  const ref = song.sourceRef?.kind === 'online' && song.sourceRef.providerId === 'qq' ? song.sourceRef : undefined;
  return { ...song, id: (ref?.providerData?.songId ?? song.id) as SongResult['id'], qqMid: song.qqMid || ref?.mediaId || '' };
}
