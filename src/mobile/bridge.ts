import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import type { SongResult, ReplayGainMode, LyricData, OnlineLyricsState } from '../types';
import type { AudioEqualizerSettings } from '../utils/audioEqualizer';
import type { NativeTransitionCue } from './nativeTransitionCue';
import type { LocalLyricSnapshot } from '../utils/lyrics/localLyricSnapshot';

// src/mobile/bridge.ts — native owns transport secrets, playback and queue state.
export interface PlaybackSnapshot {
  queue: SongResult[]; index: number; position: number; duration: number; playing: boolean;
  repeat: 'off' | 'all' | 'one'; error?: string; revision: number;
  currentSong: SongResult | null; queueRevision: number;
  audioProcessingAvailable?: boolean;
  audioEffects?: { available: boolean; pending: boolean; error?: string };
  transitionCue?: NativeTransitionCue | null;
}
export interface NativeMediaCacheSettings { enabled: boolean; limitGB: number }
export interface NativeMediaCacheState {
  settings: NativeMediaCacheSettings; count: number; bytes: number; pending: number;
  revision: number; error: string | null; songs: SongResult[];
}
export interface NativeAudioSettings { volume: number; isMuted: boolean; equalizer: AudioEqualizerSettings; replayGainMode: ReplayGainMode }
export interface NativeTransitionSettings { enabled: boolean; mode: 'crossfade' | 'automix'; crossfadeMaxSec: number }
export type PlaybackEvent = Omit<PlaybackSnapshot, 'queue' | 'currentSong'> & Partial<Pick<PlaybackSnapshot, 'queue' | 'currentSong'>>;
export interface FoliaNativePlugin {
  readLocalLyrics(options: { id: string }): Promise<LocalLyricSnapshot>;
  selectLocalLyrics(options: { id: string; token: string; source: 'local' | 'embedded' }): Promise<LocalLyricSnapshot>;
  readLyricCache(options: { song: SongResult }): Promise<{ token: string; payload: { lyrics?: LyricData | null; state?: OnlineLyricsState | null } }>;
  writeLyricCache(options: { song: SongResult; token: string; field: 'lyrics' | 'state'; value: LyricData | OnlineLyricsState | null }): Promise<void>;
  lyricCacheState(): Promise<{ bytes: number; count: number }>;
  clearLyricCache(): Promise<void>;
  songCover(options: { song: SongResult }): Promise<{ url?: string }>;
  coverCacheState(): Promise<{ bytes: number; count: number }>;
  clearCoverCache(): Promise<void>;
  getMediaCacheSettings(): Promise<NativeMediaCacheSettings>;
  setMediaCacheSettings(options: { settings: NativeMediaCacheSettings }): Promise<NativeMediaCacheSettings>;
  mediaCacheState(): Promise<NativeMediaCacheState>;
  clearMediaCache(): Promise<void>;
  addListener(name: 'mediaCache', listener: () => void): Promise<PluginListenerHandle>;
  localCatalog(): Promise<{ songs: SongResult[] }>;
  importAudio(): Promise<{ songs?: SongResult[]; failures?: { name: string; code: string }[]; cancelled?: boolean }>;
  localDetails(options: { id: string }): Promise<{ content?: string; fileName?: string; cover?: string }>;
  importLyrics(options: { id: string }): Promise<{ content?: string; fileName?: string; cover?: string; cancelled?: boolean }>;
  pickLyricFile(options: { id: string }): Promise<{ data?: string; fileName?: string; token?: string; cancelled?: boolean }>;
  saveLocalLyrics(options: { id: string; token: string; content: string; fileName: string }): Promise<void>;
  removeLocal(options: { id: string }): Promise<void>;
  audioLevels(): Promise<{ available: boolean; spectrum: number[]; sampleRate: number }>;
  getAudioSettings(): Promise<NativeAudioSettings>;
  setAudioSettings(options: { settings: NativeAudioSettings }): Promise<NativeAudioSettings>;
  getTransitionSettings(): Promise<NativeTransitionSettings>;
  setTransitionSettings(options: { settings: NativeTransitionSettings }): Promise<NativeTransitionSettings>;
  bootstrap(): Promise<{ server: string; sessions: Record<string, Record<string, string>> }>;
  configure(options: { server: string; token: string }): Promise<void>;
  health(): Promise<{ protocol: number; providers: string[] }>;
  saveSession(options: { provider: string; values: Record<string, string> }): Promise<void>;
  clearSession(options: { provider: string }): Promise<void>;
  request(options: { id: string; payload: Record<string, unknown> }): Promise<{ status: number; body: string; headers: Record<string, string> }>;
  cancelRequests(options: { ids: string[] }): Promise<void>;
  setQueue(options: { songs: SongResult[]; index: number }): Promise<void>;
  editQueue(options: { songs: SongResult[]; currentIndex: number; queueRevision: number }): Promise<PlaybackSnapshot>;
  selectQueue(options: { index: number; queueRevision: number }): Promise<void>;
  command(options: { action: 'play' | 'pause' | 'next' | 'previous' | 'seek' | 'repeat'; position?: number; mode?: string }): Promise<void>;
  getState(): Promise<PlaybackSnapshot>;
  shareQR(options: { image: string }): Promise<void>;
  addListener(name: 'playback', listener: (state: PlaybackEvent) => void): Promise<PluginListenerHandle>;
}
export const native = registerPlugin<FoliaNativePlugin>('FoliaNative');
export const isNative = Capacitor.isNativePlatform();
