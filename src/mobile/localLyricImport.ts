import { native } from './bridge';
import { decodeLyricFileBytes } from '../utils/lyrics/lyricFileDecoding';
import { LocalFileLyricAdapter } from '../utils/lyrics/adapters/LocalFileLyricAdapter';
import { resolveExplicitFileTimedLyricFormat } from '../utils/lyrics/formatDetection';
import { hasRenderableLyrics } from '../utils/lyrics/validity';

// localLyricImport.ts — use the original file decoder/parser after a system pick; commit only to the still-current song.
export async function importMobileLocalLyrics(id: string, isCurrent: () => boolean) {
  const check = () => { if (!isCurrent()) throw new DOMException('Canceled', 'AbortError'); };
  check();
  const file = await native.pickLyricFile({ id });
  check();
  if (file.cancelled) return false;
  if (!file.data || file.data.length > 2_666_668 || !file.fileName || !file.token
      || new TextEncoder().encode(file.fileName).length > 1024) throw new Error('invalid-lyrics');
  const bytes = Uint8Array.from(atob(file.data), value => value.charCodeAt(0));
  if (bytes.length > 2_000_000) throw new Error('lyrics-too-large');
  const content = await decodeLyricFileBytes(bytes, 2_000_000);
  check();
  if (new TextEncoder().encode(content).length > 2_000_000) throw new Error('lyrics-too-large');
  const parsed = await new LocalFileLyricAdapter().parse({ type: 'local', lrcContent: content,
    formatHint: resolveExplicitFileTimedLyricFormat(file.fileName) });
  check();
  if (!hasRenderableLyrics(parsed)) throw new Error('invalid-lyrics');
  await native.saveLocalLyrics({ id, token: file.token, content, fileName: file.fileName });
  check();
  return true;
}
