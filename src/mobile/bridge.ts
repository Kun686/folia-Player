import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import type { SongResult } from '../types';

// src/mobile/bridge.ts — native owns transport secrets, playback and queue state.
export interface PlaybackSnapshot {
  queue: SongResult[]; index: number; position: number; duration: number; playing: boolean;
  repeat: 'off' | 'all' | 'one'; error?: string; revision: number;
  currentSong: SongResult | null; queueRevision: number;
}
export type PlaybackEvent = Omit<PlaybackSnapshot, 'queue' | 'currentSong'> & Partial<Pick<PlaybackSnapshot, 'queue' | 'currentSong'>>;
export interface FoliaNativePlugin {
  localCatalog(): Promise<{ songs: SongResult[] }>;
  importAudio(): Promise<{ songs?: SongResult[]; failures?: { name: string; code: string }[]; cancelled?: boolean }>;
  localDetails(options: { id: string }): Promise<{ content?: string; cover?: string }>;
  importLyrics(options: { id: string }): Promise<{ content?: string; cover?: string; cancelled?: boolean }>;
  removeLocal(options: { id: string }): Promise<void>;
  audioLevels(): Promise<{ available: boolean; spectrum: number[]; sampleRate: number }>;
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
