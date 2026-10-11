import { getPlaylistNameFromFile, parseM3uPlaylist } from '../services/localPlaylistM3u';
import { sanitizeDownloadFileName } from '../utils/downloadFileName';

// localPlaylistFiles.ts — bounded UTF-8 file input and safe names for the native share sheet.
export async function readMobilePlaylistFile(file: File) {
  if (!/\.m3u8?$/i.test(file.name) || file.size > 2_000_000) throw new Error('invalid-playlist-file');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
  const parsed = parseM3uPlaylist(text);
  if (text.includes('\0') || parsed.paths.length > 10_000) throw new Error('invalid-playlist-file');
  return { text, name: (parsed.name?.trim() || getPlaylistNameFromFile(file.name)).slice(0, 256) };
}
export function mobilePlaylistFileName(name: string) {
  const safe = Array.from(sanitizeDownloadFileName(name, 'playlist')).slice(0, 60).join('').replace(/^\.+/, '') || 'playlist';
  return `${safe}.m3u8`;
}
