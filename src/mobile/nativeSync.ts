// nativeSync.ts — public sync configuration and fixed operations; persisted tokens never return in settings snapshots.
export interface NativeSyncSettings {
  enabled: boolean; baseURL: string; hasToken: boolean; scope: string; revision: number;
}
export interface NativeSyncSettingsEdit { enabled?: boolean; baseURL?: string; token?: string }
export type NativeSyncOperation = 'health' | 'state' | 'settingsRead' | 'settingsWrite' | 'themeManifest'
  | 'themeGet' | 'themePut' | 'themeBuckets' | 'themeList';
export interface NativeSyncResponse { status: number; body: string; contentType: string }
