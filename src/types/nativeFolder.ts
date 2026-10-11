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
