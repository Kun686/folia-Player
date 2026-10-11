import { decodeNativeLyricFile, type NativeLyricFile } from './nativeLyricFile';

// nativeFolderLyrics.ts — foreground byte decoding; unfinished/cancelled batches never reach native commit.
export interface NativeFolderLyricFiles { lyric?: NativeLyricFile; translation?: NativeLyricFile }
export interface NativeFolderLyricContents { lyric?: string; translation?: string }
export async function decodeNativeFolderLyrics(files: NativeFolderLyricFiles, signal?: AbortSignal): Promise<NativeFolderLyricContents> {
  const check = () => signal?.throwIfAborted();
  check();
  const result: NativeFolderLyricContents = {};
  for (const key of ['lyric', 'translation'] as const) {
    if (files[key] !== undefined) result[key] = await decodeNativeLyricFile(files[key]);
    check();
  }
  return result;
}
