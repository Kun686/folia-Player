import type { NativeLibraryOperation, NativeLibrarySnapshot } from '../types/nativeLibrary';
import type { NativeFolderCatalog, NativeFolderImportOptions, NativeFolderImportResult, NativeFolderProgress } from '../types/nativeFolder';
import type { NativeFolderLyricContents, NativeFolderLyricFiles } from './nativeFolderLyrics';
import type { LocalMatchDocument, LocalMatchSnapshot } from '../types/localSongMatch';
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import type { SongResult, ReplayGainMode, LyricData, OnlineLyricsState, LocalLyricsPriority, LyricProviderSource } from '../types';
import type { AudioEqualizerSettings } from '../utils/audioEqualizer';
import type { NativeTransitionCue } from './nativeTransitionCue';
import type { LocalLyricSnapshot } from '../utils/lyrics/localLyricSnapshot';
import type { AudioQualityPreference } from '../types/onlineMusic';
import type { NativeAISettings, NativeAISettingsEdit, NativeAIResponse } from './nativeAI';
import type { NativeSyncSettings, NativeSyncSettingsEdit, NativeSyncOperation, NativeSyncResponse } from './nativeSync';
import type { NativeModelsState } from './nativeModels';
import type { AutomixModelName } from '../services/automix/modelAvailability';
import type { PersonalFmSelection } from '../services/onlineMusic/fmModes';

// src/mobile/bridge.ts — native owns transport secrets, playback and queue state.
export interface PlaybackSnapshot {
  listening?: { ready: boolean; error: string | null };
  personalFM?: { active: boolean; selection: PersonalFmSelection | null; loading: boolean; fallback: boolean; error: string | null };
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
export interface GatewayBootstrap { server: string; scope: string; sessions: Record<string, Record<string, string>> }
export interface NativeAudioSettings { playbackFadeEnabled?: boolean; neteaseScrobbleEnabled?: boolean; volume: number; isMuted: boolean; equalizer: AudioEqualizerSettings; replayGainMode: ReplayGainMode; audioQuality: AudioQualityPreference }
export interface NativeTransitionSettings { enabled: boolean; mode: 'crossfade' | 'automix'; crossfadeMaxSec: number; performance: boolean }
export interface NativeLyricSettings {
  localLyricsPriority: LocalLyricsPriority;
  autoUseBestLyric?: boolean;
  preferredAlternativeLyricSource?: LyricProviderSource;
}
export interface NativeSleepTimerState { hours: number; minutes: number; enabled: boolean; deadlineMs: number | null; revision: number }
export type NativeSleepTimerEdit = Partial<Pick<NativeSleepTimerState, 'hours' | 'minutes' | 'enabled'>>;
export type PlaybackEvent = Omit<PlaybackSnapshot, 'queue' | 'currentSong'> & Partial<Pick<PlaybackSnapshot, 'queue' | 'currentSong'>>;
export interface FoliaNativePlugin {
  getLyricSettings(): Promise<NativeLyricSettings>;
  setLyricSettings(options: { settings: NativeLyricSettings }): Promise<NativeLyricSettings>;
  getModels(): Promise<NativeModelsState>;
  downloadModel(options: { name: AutomixModelName }): Promise<NativeModelsState>;
  cancelModel(options: { name: AutomixModelName }): Promise<NativeModelsState>;
  removeModels(): Promise<NativeModelsState>;
  importModel(): Promise<{ cancelled: boolean }>;
  addListener(name: 'models', listener: () => void): Promise<PluginListenerHandle>;
  getSyncSettings(): Promise<NativeSyncSettings>;
  setSyncSettings(options: { revision: number; settings: NativeSyncSettingsEdit }): Promise<NativeSyncSettings>;
  syncRequest(options: { id: string; revision: number; operation: NativeSyncOperation; body?: string }): Promise<NativeSyncResponse>;
  cancelSyncRequest(options: { id: string }): Promise<void>;
  getAISettings(): Promise<NativeAISettings>;
  setAISettings(options: { revision: number; settings: NativeAISettingsEdit }): Promise<NativeAISettings>;
  aiRequest(options: { id: string; revision: number; provider: NativeAISettings['provider']; body: string }): Promise<NativeAIResponse>;
  cancelAIRequest(options: { id: string }): Promise<void>;
  readLocalFolders(): Promise<NativeFolderCatalog>;
  beginFolderImport(options: NativeFolderImportOptions): Promise<NativeFolderProgress | { cancelled: true }>;
  readFolderImport(options: { token: string; index: number }): Promise<NativeFolderLyricFiles>;
  prepareFolderImport(options: { token: string; index: number; contents: NativeFolderLyricContents; skipped: ('lyric' | 'translation')[] }): Promise<NativeFolderProgress>;
  finishFolderImport(options: { token: string }): Promise<NativeFolderImportResult>;
  cancelFolderImport(options: { token: string }): Promise<void>;
  removeLocalFolder(options: { rootID: string; revision: string }): Promise<void>;
  getSleepTimer(): Promise<NativeSleepTimerState>;
  setSleepTimer(options: { edit: NativeSleepTimerEdit }): Promise<NativeSleepTimerState>;
  addListener(name: 'sleepTimer', listener: (state: NativeSleepTimerState) => void): Promise<PluginListenerHandle>;
  listExportLyrics(): Promise<{ token: string; entries: { key: string; song?: SongResult }[] }>;
  readExportLyrics(options: { key: string; token: string }): Promise<Pick<Awaited<ReturnType<FoliaNativePlugin['readLyricCache']>>, 'payload'>>;
  shareLyricArchive(options: { fileName: string; data: string; token?: string }): Promise<{ completed: boolean }>;
  readLocalLibrary(): Promise<NativeLibrarySnapshot>;
  editLocalLibrary(options: { revision: string; operation: NativeLibraryOperation }): Promise<NativeLibrarySnapshot>;
  readLocalMatch(options: { id: string; online?: boolean; includeCover?: boolean }): Promise<LocalMatchSnapshot>;
  writeLocalMatch(options: { id: string; token: string; document: LocalMatchDocument; source: 'local' | 'embedded' | 'online' | null; cacheCover: boolean; libraryRevision?: string; contextToken?: string; sessionToken?: string; metadata: 'keep' | 'online' | 'imported'; updateArtists: boolean; updateAlbum: boolean; protectOrigins?: string[] }): Promise<{ coverCached: boolean }>;
  addListener(name: 'localCatalog', listener: () => void): Promise<PluginListenerHandle>;
  readLocalLyrics(options: { id: string }): Promise<LocalLyricSnapshot>;
  selectLocalLyrics(options: { id: string; token: string; source: 'local' | 'embedded' | 'online' }): Promise<LocalLyricSnapshot>;
  readLyricCache(options: { song: SongResult }): Promise<{ token: string; selectionToken?: string; sessionToken?: string; payload: { lyrics?: LyricData | null; state?: OnlineLyricsState | null } }>;
  writeLyricCache(options: { song: SongResult; token: string; selectionToken?: string; sessionToken?: string; field: 'lyrics' | 'state'; value: LyricData | OnlineLyricsState | null }): Promise<void>;
  addListener(name: 'lyrics', listener: (event: { song: SongResult }) => void): Promise<PluginListenerHandle>;
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
  localCatalog(options?: { requireComplete: boolean }): Promise<{ songs: SongResult[] }>;
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
  bootstrap(): Promise<GatewayBootstrap>;
  configure(options: { server: string; token: string; scope: string }): Promise<GatewayBootstrap>;
  health(): Promise<{ protocol: number; providers: string[]; playbackReportProviders?: string[]; songLikeProviders?: string[]; replacementProviders?: string[]; catalogProviders?: string[]; playlistEditProviders?: string[]; subscriptionProviders?: string[]; dailyProviders?: string[]; personalFmProviders?: string[]; recommendedCollectionProviders?: string[]; userAlbumProviders?: string[]; cloudProviders?: string[] }>;
  saveSession(options: { provider: string; values: Record<string, string>; scope: string }): Promise<void>;
  clearSession(options: { provider: string; scope: string }): Promise<void>;
  request(options: { id: string; scope: string; payload: Record<string, unknown> }): Promise<{ status: number; body: string; headers: Record<string, string> }>;
  cancelRequests(options: { ids: string[] }): Promise<void>;
  setQueue(options: { songs: SongResult[]; index: number }): Promise<void>;
  startPersonalFM(options: { selection: PersonalFmSelection }): Promise<PlaybackSnapshot>;
  leavePersonalFM(): Promise<void>;
  editQueue(options: { songs: SongResult[]; currentIndex: number; queueRevision: number }): Promise<PlaybackSnapshot>;
  selectQueue(options: { index: number; queueRevision: number }): Promise<void>;
  command(options: { action: 'play' | 'pause' | 'next' | 'previous' | 'seek' | 'repeat'; position?: number; mode?: string }): Promise<void>;
  getState(): Promise<PlaybackSnapshot>;
  shareQR(options: { image: string }): Promise<void>;
  copyText(options: { text: string }): Promise<void>;
  shareLyricFile(options: { fileName: string; content: string }): Promise<{ completed: boolean }>;
  sharePlaylistFile(options: { fileName: string; content: string }): Promise<{ completed: boolean }>;
  addListener(name: 'playback', listener: (state: PlaybackEvent) => void): Promise<PluginListenerHandle>;
}
export const native = registerPlugin<FoliaNativePlugin>('FoliaNative');
export const isNative = Capacitor.isNativePlatform();
