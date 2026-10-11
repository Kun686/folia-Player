import { decodeLyricFileBytes } from '../utils/lyrics/lyricFileDecoding';

// nativeLyricFile.ts — system-picked and folder sidecars share the original browser byte decoder.
export interface NativeLyricFile { data: string; fileName: string }
export async function decodeNativeLyricFile(file: NativeLyricFile): Promise<string> {
  if (typeof file?.data !== 'string' || file.data.length > 2_666_668
    || typeof file.fileName !== 'string' || !file.fileName || new TextEncoder().encode(file.fileName).length > 1024) {
    throw new Error('invalid-lyrics');
  }
  const bytes = Uint8Array.from(atob(file.data), value => value.charCodeAt(0));
  if (bytes.length > 2_000_000) throw new Error('lyrics-too-large');
  const content = await decodeLyricFileBytes(bytes, 2_000_000);
  if (new TextEncoder().encode(content).length > 2_000_000) throw new Error('lyrics-too-large');
  return content;
}
