import { getSyncConfig, isSyncConfigured, setSyncStatus } from './syncConfig';
import { getRemoteState, testSyncConnection } from './syncClient';
import { assertSyncCurrent, syncStorageKey, type SyncConnection } from './syncConnection';
import { applySyncedVisualSettings, buildSyncedSettingsRecord, getSyncedSettingsSignature, readSyncableSettingsState } from './settingsSnapshot';
import {
    fetchRemoteSyncState,
    fetchRemoteSettingsIfNewer,
    listAllRemoteThemeRecords,
    mergeLocalThemesIntoRecords,
    pushMissingLocalThemesToRemote,
    pushRemoteSettings,
    pushSyncLibraryBundleToRemote,
    saveSyncLibraryBundleToLocalCache,
} from './syncRepository';
import { parseSyncLibraryExportBundle } from './syncSchema';
import type { SyncLibraryExportBundle, SyncRemoteState } from './syncTypes';
import { SYNC_SCHEMA_VERSION } from './syncTypes';

// src/services/sync/syncCoordinator.ts
// Coordinates startup theme sync and user-triggered manual sync commands.

const LOCAL_SETTINGS_UPDATED_AT_KEY = 'folia_sync_local_settings_updated_at_v1';
let applyingRemoteSettings = false;
let isSyncingInProgress = false;

const isBrowser = () => typeof window !== 'undefined';

const getLocalSettingsUpdatedAt = (config: SyncConnection) => (
    isBrowser() ? window.localStorage.getItem(syncStorageKey(config, LOCAL_SETTINGS_UPDATED_AT_KEY)) : null
);

const setLocalSettingsUpdatedAt = (config: SyncConnection, updatedAt: string) => {
    assertSyncCurrent(config);
    if (isBrowser()) {
        window.localStorage.setItem(syncStorageKey(config, LOCAL_SETTINGS_UPDATED_AT_KEY), updatedAt);
    }
};

const pushCurrentSettings = async (config: SyncConnection) => {
    if (!isSyncConfigured(config)) {
        return false;
    }

    const updatedAt = new Date().toISOString();
    const record = buildSyncedSettingsRecord(readSyncableSettingsState(), updatedAt);
    const signature = getSyncedSettingsSignature(readSyncableSettingsState());
    const pushed = await pushRemoteSettings(record, config);
    assertSyncCurrent(config);
    if (signature === getSyncedSettingsSignature(readSyncableSettingsState())) setLocalSettingsUpdatedAt(config, updatedAt);
    return pushed;
};

export const initializeSyncCoordinator = () => {
    void syncNow({ syncThemes: true, applyRemoteSettings: false, pushSettings: false }).catch(() => undefined);

    return () => {};
};

export const testSyncProviderConnection = async (config: SyncConnection) => {
    const response = await testSyncConnection(config);
    if (!response.ok) {
        return false;
    }

    return Boolean(await getRemoteState(config));
};

export const pullRemoteVisualSettings = async (remoteState?: SyncRemoteState | null, config = getSyncConfig(),
    expectedSignature = getSyncedSettingsSignature(readSyncableSettingsState())) => {
    if (!isSyncConfigured(config)) {
        return false;
    }

    const remoteSettings = await fetchRemoteSettingsIfNewer(getLocalSettingsUpdatedAt(config), remoteState, config);
    if (!remoteSettings) {
        return false;
    }

    assertSyncCurrent(config);
    if (config.nativeSession && expectedSignature !== getSyncedSettingsSignature(readSyncableSettingsState())) throw new Error('sync-local-settings-changed');
    applyingRemoteSettings = true;
    try {
        applySyncedVisualSettings(readSyncableSettingsState(), remoteSettings.data);
        setLocalSettingsUpdatedAt(config, remoteSettings.updatedAt);
        return true;
    } finally {
        applyingRemoteSettings = false;
    }
};

export type SyncNowResult = {
    uploadedThemeCount: number;
    downloadedThemeCount: number;
    checkedLocalThemeCount: number;
    diffBucketCount: number;
    skippedRemoteThemeScan: boolean;
    appliedRemoteSettings: boolean;
    pushedLocalSettings: boolean;
};

export const syncNow = async (options: { syncThemes?: boolean; applyRemoteSettings?: boolean; pushSettings?: boolean } = {}, config = getSyncConfig()): Promise<SyncNowResult | null> => {
    if (isSyncingInProgress) {
        return null;
    }

    if (!isSyncConfigured(config)) {
        return null;
    }

    assertSyncCurrent(config);
    const expectedSignature = getSyncedSettingsSignature(readSyncableSettingsState());
    isSyncingInProgress = true;
    try {
        setSyncStatus({ state: 'syncing', lastError: null }, config);
        const remoteState = await fetchRemoteSyncState(config);
        let themeSyncResult = {
            uploadedCount: 0,
            downloadedCount: 0,
            checkedLocalThemeCount: 0,
            diffBucketCount: 0,
            skippedRemoteThemeScan: true,
        };
        if (options.syncThemes ?? true) {
            themeSyncResult = await pushMissingLocalThemesToRemote(remoteState, config);
        }
        
        let appliedRemoteSettings = false;
        let pushedLocalSettings = false;
        if (options.applyRemoteSettings) {
            appliedRemoteSettings = await pullRemoteVisualSettings(remoteState, config, expectedSignature);
        }
        if (options.pushSettings) {
            pushedLocalSettings = await pushCurrentSettings(config);
        }
        setSyncStatus({ state: 'success', lastSyncAt: new Date().toISOString(), lastError: null }, config);
        const summary = {
            uploadedThemeCount: themeSyncResult.uploadedCount,
            downloadedThemeCount: themeSyncResult.downloadedCount,
            checkedLocalThemeCount: themeSyncResult.checkedLocalThemeCount,
            diffBucketCount: themeSyncResult.diffBucketCount,
            skippedRemoteThemeScan: themeSyncResult.skippedRemoteThemeScan,
            appliedRemoteSettings,
            pushedLocalSettings,
        };
        console.info('[sync] Sync completed', summary);
        if (summary.downloadedThemeCount > 0 && typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('folia-themes-synced'));
        }
        return summary;
    } catch (error) {
        if (config.nativeSession) {
            assertSyncCurrent(config);
            setSyncStatus({ state: 'error', lastError: 'sync-failed' }, config);
            throw error;
        }
        console.error('[sync] Sync failed:', error);
        assertSyncCurrent(config);
        setSyncStatus({ state: 'error', lastError: config.nativeSession ? 'sync-failed' : error instanceof Error ? error.message : String(error) }, config);
        return null;
    } finally {
        isSyncingInProgress = false;
    }
};

export const exportSyncLibraryBundle = async (config = getSyncConfig()): Promise<SyncLibraryExportBundle> => {
    setSyncStatus({ state: 'syncing', lastError: null }, config);
    try {
        const settings = buildSyncedSettingsRecord(readSyncableSettingsState(), new Date().toISOString());
        const themes = await mergeLocalThemesIntoRecords(await listAllRemoteThemeRecords(config), config);
        const bundle: SyncLibraryExportBundle = {
            kind: 'folia-sync-export',
            schemaVersion: SYNC_SCHEMA_VERSION,
            exportedAt: new Date().toISOString(),
            settings,
            themes,
        };
        setSyncStatus({ state: 'success', lastSyncAt: bundle.exportedAt, lastError: null }, config);
        console.info('[sync] Export completed', {
            themeCount: bundle.themes.length,
        });
        return bundle;
    } catch (error) {
        assertSyncCurrent(config);
        setSyncStatus({ state: 'error', lastError: config.nativeSession ? 'sync-failed' : error instanceof Error ? error.message : String(error) }, config);
        throw error;
    }
};

export const isSyncLibraryExportBundle = (value: unknown): value is SyncLibraryExportBundle => (
    parseSyncLibraryExportBundle(value) !== null
);

export const importSyncLibraryBundle = async (
    bundle: unknown,
    options: { pushRemote?: boolean } = {},
    config = getSyncConfig(),
) => {
    const validatedBundle = parseSyncLibraryExportBundle(bundle);
    if (!validatedBundle) {
        throw new Error('Invalid Folia sync export');
    }

    setSyncStatus({ state: 'syncing', lastError: null }, config);
    try {
        const signature = getSyncedSettingsSignature(readSyncableSettingsState());
        await saveSyncLibraryBundleToLocalCache(validatedBundle, config);
        assertSyncCurrent(config);
        if (config.nativeSession && signature !== getSyncedSettingsSignature(readSyncableSettingsState())) throw new Error('sync-local-settings-changed');
        if (validatedBundle.settings) {
            applyingRemoteSettings = true;
            try {
                applySyncedVisualSettings(readSyncableSettingsState(), validatedBundle.settings.data);
                setLocalSettingsUpdatedAt(config, validatedBundle.settings.updatedAt);
            } finally {
                applyingRemoteSettings = false;
            }
        }
        if (options.pushRemote ?? true) {
            await pushSyncLibraryBundleToRemote(validatedBundle, config);
        }
        setSyncStatus({ state: 'success', lastSyncAt: new Date().toISOString(), lastError: null }, config);
        console.info('[sync] Import completed', {
            pushedRemote: options.pushRemote ?? true,
            themeCount: validatedBundle.themes.length,
            appliedSettings: Boolean(validatedBundle.settings),
        });
        return true;
    } catch (error) {
        assertSyncCurrent(config);
        setSyncStatus({ state: 'error', lastError: config.nativeSession ? 'sync-failed' : error instanceof Error ? error.message : String(error) }, config);
        throw error;
    }
};
