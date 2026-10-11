import type { LocalLyricFileFormat } from '../utils/lyrics/localLyricFormatOrder';

// nativeFolder.ts — root-relative scan plans; paths never serve as native playback identities.
export interface NativeFolderEntry { name: string; directory: boolean }
export interface NativeFolderRule { path: string; content: string }
export interface NativeFolderDirectoryRequest {
  path: string;
  entries: NativeFolderEntry[];
  rules: NativeFolderRule[];
  ignoredPaths: string[];
}
export interface NativeFolderFile { path: string; size: number; modified: number }
export interface NativeFolderTrack {
  path: string;
  audioSignature: string;
  sidecarSignature: string;
  coverSignature: string;
  lyric?: string;
  translation?: string;
  cover?: string;
}
export interface NativeFolderPlan {
  version: 1;
  tracks: NativeFolderTrack[];
  changed: string[];
  removed: string[];
}
export interface NativeFolderPlanRequest {
  files: NativeFolderFile[];
  lyricFormatOrder?: LocalLyricFileFormat[];
  previous?: NativeFolderTrack[];
}
export interface NativeFolderRoot {
  id: string;
  name: string;
  ignoredPaths: string[];
  directories: { path: string; ignored: boolean }[];
  tracks: { id: string; path: string }[];
}
export interface NativeFolderCatalog { revision: string; roots: NativeFolderRoot[] }
export interface NativeFolderProgress { token: string; rootID: string; name: string; total: number; completed: number; reused: number; path?: string }
export interface NativeFolderImportOptions { token: string; rootID?: string; pick?: boolean; ignoredPaths?: string[]; order?: LocalLyricFileFormat[] }
export interface NativeFolderImportResult { rootID: string; count: number; warnings: { path: string; code: string }[] }
