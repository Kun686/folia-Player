import { native } from './bridge';
import { decodeNativeLyricFile } from './nativeLyricFile';
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
  if (!file.data || !file.fileName || !file.token) throw new Error('invalid-lyrics');
  const content = await decodeNativeLyricFile({ data: file.data, fileName: file.fileName });
  check();
  const parsed = await new LocalFileLyricAdapter().parse({ type: 'local', lrcContent: content,
    formatHint: resolveExplicitFileTimedLyricFormat(file.fileName) });
  check();
  if (!hasRenderableLyrics(parsed)) throw new Error('invalid-lyrics');
  await native.saveLocalLyrics({ id, token: file.token, content, fileName: file.fileName });
  check();
  return true;
}
