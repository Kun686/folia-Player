import type { SubsonicResponse } from '../types/navidrome';
import type { NavidromeReadOperation } from '../services/navidromeReadApi';

// nativeNavidrome.ts — public connection checkpoint; password is write-only and never restored into JavaScript.
export interface NativeNavidromeSettings {
  enabled: boolean; baseURL: string; username: string; hasPassword: boolean; scope: string; revision: number;
}
export interface NativeNavidromeSettingsEdit { enabled?: boolean; baseURL?: string; username?: string; password?: string }
export type NativeNavidromeOperation = NavidromeReadOperation;
export interface NativeNavidromeResponse {
  scope: string; revision: number; response: SubsonicResponse<Record<string, unknown>>;
}
