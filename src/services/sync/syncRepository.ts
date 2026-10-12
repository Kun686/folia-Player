import type { SongResult, DualTheme } from '../../types';
import { getCacheEntriesByPrefix, getFromCache, saveToCache } from '../db';
import { sanitizeDualTheme } from '../themeSanitizer';
import { getSyncConfig, isSyncConfigured, setSyncStatus } from './syncConfig';
import {
    getRemoteState,
    getRemoteSettings,
    getRemoteThemes,
    getRemoteThemeManifest,
    getRemoteThemesByBuckets,
    listRemoteThemes,
    putRemoteSettings,
    putRemoteThemes,
} from './syncClient';
import { createSongSyncFingerprint, createSongSyncFingerprintCandidates } from './syncFingerprint';
import { getPlaybackSongKey } from '../../utils/appPlaybackGuards';
import { assertSyncCurrent, syncStorageKey, type SyncConnection } from './syncConnection';
import { captureSyncLocal, collectSnapshotUploads, commitSyncThemes } from './syncLocalStore';
import { buildThemeBucketSummaries, getThemeBucketId } from './syncMerkle';
import {
    createLegacyNeteaseThemeSyncRecord,
    readThemeSyncRegistry,
    getThemeCacheKeyFromFingerprint,
    getThemeSyncRegistryRecords,
    registerThemeSyncRecordForSong,
    upsertThemeSyncRecord,
    upsertThemeSyncRecords,
    type ThemeSyncRegistryRecord,
} from './themeSyncRegistry';
import type {
    SyncLibraryExportBundle,
    SyncRemoteState,
    SyncedSettingsRecord,
    SyncedThemeRecord,
    SyncedThemeSource,
} from './syncTypes';

// src/services/sync/syncRepository.ts
// High-level sync operations for settings and row-addressed AI theme records.

const DUAL_THEME_CACHE_PREFIX = 'dual_theme_';
const THEME_SYNC_WATERMARK_KEY = 'folia_sync_theme_watermark_v1';
const THEME_BATCH_SIZE = 100;
const THEME_BUCKET_FETCH_SIZE = 32;
const LIST_PAGE_SIZE = 500;

type ThemeSyncWatermark = {
    remoteThemesUpdatedAt: string | null;
    remoteThemeCount: number;
    localRegistrySignature: string;
};

export type ThemeSyncUploadResult = {
    uploadedCount: number;
    downloadedCount: number;
    checkedLocalThemeCount: number;
    diffBucketCount: number;
    skippedRemoteThemeScan: boolean;
};

const isBrowser = () => typeof window !== 'undefined';

const isRemoteNewer = (remoteUpdatedAt: string | null | undefined, localUpdatedAt: string | null | undefined) => {
    if (!remoteUpdatedAt) {
        return false;
    }
    return !localUpdatedAt || Date.parse(remoteUpdatedAt) > Date.parse(localUpdatedAt);
};

const readThemeSyncWatermark = (config: SyncConnection): ThemeSyncWatermark | null => {
    if (!isBrowser()) {
        return null;
    }

    try {
        const parsed = JSON.parse(window.localStorage.getItem(syncStorageKey(config, THEME_SYNC_WATERMARK_KEY)) ?? 'null') as Partial<ThemeSyncWatermark> | null;
        if (!parsed || typeof parsed.localRegistrySignature !== 'string') {
            return null;
        }

        return {
            remoteThemesUpdatedAt: typeof parsed.remoteThemesUpdatedAt === 'string' ? parsed.remoteThemesUpdatedAt : null,
            remoteThemeCount: typeof parsed.remoteThemeCount === 'number' ? parsed.remoteThemeCount : -1,
            localRegistrySignature: parsed.localRegistrySignature,
        };
    } catch {
        return null;
    }
};

const writeThemeSyncWatermark = (config: SyncConnection, watermark: ThemeSyncWatermark) => {
    assertSyncCurrent(config);
    if (isBrowser()) {
        window.localStorage.setItem(syncStorageKey(config, THEME_SYNC_WATERMARK_KEY), JSON.stringify(watermark));
    }
};

const getLocalThemeRegistrySignature = (records: ThemeSyncRegistryRecord[]) => {
    let latestUpdatedAt = '';
    let hash = 2166136261;
    const tokens = records
        .map(record => `${record.fingerprint}\u0000${record.cacheKey}\u0000${record.updatedAt}\u0000${record.source}`)
        .sort();

    tokens.forEach((token) => {
        for (let index = 0; index < token.length; index += 1) {
            hash ^= token.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }
    });
    records.forEach((record) => {
        if (record.updatedAt > latestUpdatedAt) {
            latestUpdatedAt = record.updatedAt;
        }
    });

    return `${records.length}:${latestUpdatedAt}:${hash >>> 0}`;
};

const areThemeBucketsEqual = (
    localBucket: ReturnType<typeof buildThemeBucketSummaries>[number],
    remoteBucket: ReturnType<typeof buildThemeBucketSummaries>[number],
) => (
    localBucket.count === remoteBucket.count
    && localBucket.hash === remoteBucket.hash
    && localBucket.updatedAt === remoteBucket.updatedAt
);

const areDualThemesEqual = (left: DualTheme, right: DualTheme) => (
    JSON.stringify(sanitizeDualTheme(left)) === JSON.stringify(sanitizeDualTheme(right))
);

const isThemeWatermarkFresh = (
    watermark: ThemeSyncWatermark | null,
    remoteState: SyncRemoteState,
    localRegistrySignature: string,
) => (
    watermark !== null
    && watermark.remoteThemesUpdatedAt === remoteState.themesUpdatedAt
    && watermark.remoteThemeCount === remoteState.themeCount
    && watermark.localRegistrySignature === localRegistrySignature
);

export const fetchRemoteSyncState = async (config = getSyncConfig()): Promise<SyncRemoteState | null> => {
    assertSyncCurrent(config);
    if (!isSyncConfigured(config)) {
        return null;
    }

    const state = await getRemoteState(config);
    if (!state) {
        throw new Error('Invalid sync state response');
    }
    return state;
};

export const fetchRemoteSettingsIfNewer = async (
    localUpdatedAt: string | null,
    remoteState?: SyncRemoteState | null,
    config = getSyncConfig(),
): Promise<SyncedSettingsRecord | null> => {
    assertSyncCurrent(config);
    if (!isSyncConfigured(config)) {
        return null;
    }
    if (remoteState && !isRemoteNewer(remoteState.settingsUpdatedAt, localUpdatedAt)) {
        return null;
    }

    const remoteSettings = await getRemoteSettings(config);
    if (!remoteSettings || !isRemoteNewer(remoteSettings.updatedAt, localUpdatedAt)) {
        return null;
    }

    return remoteSettings;
};

export const pushRemoteSettings = async (record: SyncedSettingsRecord, config = getSyncConfig()) => {
    assertSyncCurrent(config);
    if (!isSyncConfigured(config)) {
        return false;
    }

    await putRemoteSettings(config, record);
    setSyncStatus({ state: 'success', lastSyncAt: new Date().toISOString(), lastError: null }, config);
    return true;
};

const saveRemoteThemeToLocalCache = async (
    record: SyncedThemeRecord,
    preferredCacheKey?: string,
    skipRegistryUpdate = false,
) => {
    const cacheKey = preferredCacheKey ?? getThemeCacheKeyFromFingerprint(record.fingerprint);
    if (!cacheKey) {
        return null;
    }

    await saveToCache(cacheKey, sanitizeDualTheme(record.theme));
    const registryRecord = {
        fingerprint: record.fingerprint,
        cacheKey,
        updatedAt: record.updatedAt,
        source: record.source,
    };
    if (!skipRegistryUpdate) {
        await upsertThemeSyncRecord(registryRecord);
    }
    return registryRecord;
};

export const getSyncedThemeForSong = async (song: SongResult | null, config = getSyncConfig()): Promise<DualTheme | null> => {
    assertSyncCurrent(config);
    if (!isSyncConfigured(config)) {
        return null;
    }

    const fingerprints = createSongSyncFingerprintCandidates(song);
    if (fingerprints.length === 0) {
        return null;
    }

    const snapshot = config.nativeSession ? await captureSyncLocal(config) : null;
    const records = await getRemoteThemes(config, fingerprints);
    const recordByFingerprint = new Map(records.map(record => [record.fingerprint, record]));
    const matched = fingerprints.map(fingerprint => recordByFingerprint.get(fingerprint)).find(Boolean);
    if (!matched) {
        return null;
    }

    const theme = sanitizeDualTheme(matched.theme);
    if (snapshot) {
        const written = await commitSyncThemes(config, snapshot, [matched]);
        return written ? theme : null;
    }
    if (song?.id != null) {
        await saveToCache(`dual_theme_${getPlaybackSongKey(song)}`, theme);
    }
    await saveRemoteThemeToLocalCache(matched);
    return theme;
};

export const saveSyncedThemeForSong = async (
    song: SongResult | null,
    theme: DualTheme,
    source: SyncedThemeSource,
    config = getSyncConfig(),
) => {
    assertSyncCurrent(config);
    const fingerprint = createSongSyncFingerprint(song);
    const updatedAt = new Date().toISOString();
    if (fingerprint) {
        await registerThemeSyncRecordForSong(song, source, updatedAt);
    }
    if (!isSyncConfigured(config) || !fingerprint) {
        return false;
    }

    const record = {
        fingerprint,
        theme: sanitizeDualTheme(theme),
        source,
        updatedAt,
    };
    await putRemoteThemes(config, [record]);
    setSyncStatus({ state: 'success', lastSyncAt: updatedAt, lastError: null }, config);
    console.info('[sync] Theme uploaded', {
        fingerprint,
        source,
        updatedAt,
    });
    return true;
};

const hydrateLegacyNeteaseThemeSyncRecords = async () => {
    const entries = await getCacheEntriesByPrefix<DualTheme>(DUAL_THEME_CACHE_PREFIX);
    const registry = await readThemeSyncRegistry();
    const recordsToUpsert: NonNullable<ReturnType<typeof createLegacyNeteaseThemeSyncRecord>>[] = [];
    entries.forEach((entry) => {
        const record = createLegacyNeteaseThemeSyncRecord(entry.key, entry.timestamp);
        if (record && !registry[record.fingerprint]) {
            recordsToUpsert.push(record);
        }
    });
    if (recordsToUpsert.length > 0) {
        await upsertThemeSyncRecords(recordsToUpsert);
    }
};

const collectLocalThemeUploadEntries = async (
    remoteRecords: Map<string, SyncedThemeRecord>,
    localRecords?: ThemeSyncRegistryRecord[],
) => {
    const uploadEntries: SyncedThemeRecord[] = [];
    const resolvedLocalRecords = localRecords ?? await getThemeSyncRegistryRecords();

    for (const record of resolvedLocalRecords) {
        const remoteRecord = remoteRecords.get(record.fingerprint);
        if (remoteRecord && !isRemoteNewer(record.updatedAt, remoteRecord.updatedAt)) {
            continue;
        }

        const theme = await getFromCache<DualTheme>(record.cacheKey);
        if (!theme) {
            continue;
        }
        if (remoteRecord && areDualThemesEqual(theme, remoteRecord.theme)) {
            await upsertThemeSyncRecord({
                ...record,
                updatedAt: remoteRecord.updatedAt,
                source: remoteRecord.source,
            });
            continue;
        }

        uploadEntries.push({
            fingerprint: record.fingerprint,
            theme: sanitizeDualTheme(theme),
            source: record.source,
            updatedAt: record.updatedAt,
        });
    }

    return uploadEntries;
};

const getRemoteThemesForBuckets = async (bucketIds: number[], config: SyncConnection) => {
    assertSyncCurrent(config);
    if (!isSyncConfigured(config) || bucketIds.length === 0) {
        return [];
    }

    const remoteRecords: SyncedThemeRecord[] = [];
    const size = config.nativeSession ? 1 : THEME_BUCKET_FETCH_SIZE;
    let bytes = 0;
    for (let index = 0; index < bucketIds.length; index += size) {
        const batch = await getRemoteThemesByBuckets(config, bucketIds.slice(index, index + size));
        if (config.nativeSession) {
            bytes += new TextEncoder().encode(JSON.stringify(batch)).byteLength;
            if (bytes > 16_000_000) throw new Error('sync-library-too-large');
        }
        remoteRecords.push(...batch);
    }
    return remoteRecords;
};

export const pushMissingLocalThemesToRemote = async (
    remoteState?: SyncRemoteState | null,
    config = getSyncConfig(),
): Promise<ThemeSyncUploadResult> => {
    assertSyncCurrent(config);
    if (!isSyncConfigured(config)) {
        return {
            uploadedCount: 0,
            downloadedCount: 0,
            checkedLocalThemeCount: 0,
            diffBucketCount: 0,
            skippedRemoteThemeScan: true,
        };
    }

    const state = remoteState ?? await fetchRemoteSyncState(config);
    if (!state) {
        return {
            uploadedCount: 0,
            downloadedCount: 0,
            checkedLocalThemeCount: 0,
            diffBucketCount: 0,
            skippedRemoteThemeScan: true,
        };
    }

    const snapshot = config.nativeSession ? await captureSyncLocal(config) : null;
    if (!snapshot) await hydrateLegacyNeteaseThemeSyncRecords();
    const localRecords = snapshot?.records ?? await getThemeSyncRegistryRecords();
    assertSyncCurrent(config);
    const localRegistrySignature = getLocalThemeRegistrySignature(localRecords);
    const existingWatermark = readThemeSyncWatermark(config);
    if (isThemeWatermarkFresh(existingWatermark, state, localRegistrySignature)) {
        return {
            uploadedCount: 0,
            downloadedCount: 0,
            checkedLocalThemeCount: localRecords.length,
            diffBucketCount: 0,
            skippedRemoteThemeScan: true,
        };
    }

    const remoteManifest = await getRemoteThemeManifest(config);
    if (!remoteManifest) {
        throw new Error('Invalid theme manifest response');
    }

    const localBuckets = buildThemeBucketSummaries(localRecords);
    const remoteBuckets = new Map(remoteManifest.buckets.map(bucket => [bucket.bucketId, bucket]));
    const diffBucketIds = localBuckets
        .filter(localBucket => !areThemeBucketsEqual(localBucket, remoteBuckets.get(localBucket.bucketId) ?? {
            bucketId: localBucket.bucketId,
            count: 0,
            hash: '0',
            updatedAt: null,
        }))
        .map(bucket => bucket.bucketId);
    if (diffBucketIds.length === 0) {
        writeThemeSyncWatermark(config, {
            remoteThemesUpdatedAt: state.themesUpdatedAt,
            remoteThemeCount: state.themeCount,
            localRegistrySignature,
        });
        return {
            uploadedCount: 0,
            downloadedCount: 0,
            checkedLocalThemeCount: localRecords.length,
            diffBucketCount: 0,
            skippedRemoteThemeScan: true,
        };
    }

    const diffBucketIdSet = new Set(diffBucketIds);
    const affectedLocalRecords = localRecords.filter(record => diffBucketIdSet.has(getThemeBucketId(record.fingerprint)));
    const remoteRecords = await getRemoteThemesForBuckets(diffBucketIds, config);
    const remoteRecordMap = new Map(remoteRecords.map(record => [record.fingerprint, record]));
    const localRecordMap = new Map(localRecords.map(record => [record.fingerprint, record]));
    let downloadedCount = 0;
    const downloadedRegistryRecords: NonNullable<Awaited<ReturnType<typeof saveRemoteThemeToLocalCache>>>[] = [];

    if (snapshot) downloadedCount = await commitSyncThemes(config, snapshot, remoteRecords);
    for (const remoteRecord of snapshot ? [] : remoteRecords) {
        const localRecord = localRecordMap.get(remoteRecord.fingerprint);
        if (localRecord && !isRemoteNewer(remoteRecord.updatedAt, localRecord.updatedAt)) {
            continue;
        }

        const registryRecord = await saveRemoteThemeToLocalCache(remoteRecord, localRecord?.cacheKey, true);
        if (registryRecord) {
            downloadedRegistryRecords.push(registryRecord);
            downloadedCount += 1;
        }
    }
    if (downloadedRegistryRecords.length > 0) {
        await upsertThemeSyncRecords(downloadedRegistryRecords);
    }

    const uploadEntries = snapshot
        ? collectSnapshotUploads(snapshot, remoteRecordMap, new Set(affectedLocalRecords.map(record => record.fingerprint)))
        : await collectLocalThemeUploadEntries(remoteRecordMap, affectedLocalRecords);
    assertSyncCurrent(config);
    for (let index = 0; index < uploadEntries.length; index += THEME_BATCH_SIZE) {
        await putRemoteThemes(config, uploadEntries.slice(index, index + THEME_BATCH_SIZE));
    }

    if (uploadEntries.length === 0) {
        const nextLocalRecords = await getThemeSyncRegistryRecords({ strict: !!config.nativeSession });
        assertSyncCurrent(config);
        const nextLocalBuckets = buildThemeBucketSummaries(nextLocalRecords);
        const bucketsAreNowEqual = diffBucketIds.every((bucketId) => {
            const remoteBucket = remoteBuckets.get(bucketId);
            return remoteBucket !== undefined && areThemeBucketsEqual(nextLocalBuckets[bucketId], remoteBucket);
        });
        if (bucketsAreNowEqual) {
            writeThemeSyncWatermark(config, {
                remoteThemesUpdatedAt: state.themesUpdatedAt,
                remoteThemeCount: state.themeCount,
                localRegistrySignature: getLocalThemeRegistrySignature(nextLocalRecords),
            });
        }
    }

    if (uploadEntries.length > 0) {
        setSyncStatus({ state: 'success', lastSyncAt: new Date().toISOString(), lastError: null }, config);
    }
    return {
        uploadedCount: uploadEntries.length,
        downloadedCount,
        checkedLocalThemeCount: localRecords.length,
        diffBucketCount: diffBucketIds.length,
        skippedRemoteThemeScan: false,
    };
};

export const listAllRemoteThemeRecords = async (config = getSyncConfig()) => {
    assertSyncCurrent(config);
    if (!isSyncConfigured(config)) {
        return [];
    }

    const themes: SyncedThemeRecord[] = [];
    let cursor: string | null = null;
    const seen = new Set<string>();
    let bytes = 0;
    do {
        assertSyncCurrent(config);
        const page = await listRemoteThemes(config, { cursor, limit: config.nativeSession ? 50 : LIST_PAGE_SIZE });
        if (config.nativeSession) {
            bytes += new TextEncoder().encode(JSON.stringify(page.themes)).byteLength;
            if (bytes > 16_000_000) throw new Error('sync-library-too-large');
        }
        themes.push(...page.themes);
        cursor = page.cursor;
        if (cursor && (seen.has(cursor) || seen.size >= 1000)) throw new Error('sync-invalid-cursor');
        if (cursor) seen.add(cursor);
    } while (cursor);
    return themes;
};

export const mergeLocalThemesIntoRecords = async (
    remoteThemes: SyncedThemeRecord[],
    config = getSyncConfig(),
) => {
    const snapshot = config.nativeSession ? await captureSyncLocal(config) : null;
    if (!snapshot) await hydrateLegacyNeteaseThemeSyncRecords();
    const recordMap = new Map(remoteThemes.map(record => [record.fingerprint, record]));
    const localUploads = snapshot ? collectSnapshotUploads(snapshot, recordMap, new Set(snapshot.records.map(record => record.fingerprint)))
        : await collectLocalThemeUploadEntries(recordMap);
    assertSyncCurrent(config);
    localUploads.forEach(record => recordMap.set(record.fingerprint, record));
    return Array.from(recordMap.values()).sort((a, b) => a.fingerprint.localeCompare(b.fingerprint));
};

export const saveSyncLibraryBundleToLocalCache = async (bundle: SyncLibraryExportBundle, config = getSyncConfig()) => {
    if (config.nativeSession) {
        const snapshot = await captureSyncLocal(config);
        await commitSyncThemes(config, snapshot, bundle.themes, true);
        return;
    }
    const registryRecords: NonNullable<Awaited<ReturnType<typeof saveRemoteThemeToLocalCache>>>[] = [];
    for (const record of bundle.themes) {
        const registryRecord = await saveRemoteThemeToLocalCache(record, undefined, true);
        if (registryRecord) {
            registryRecords.push(registryRecord);
        }
    }
    if (registryRecords.length > 0) {
        await upsertThemeSyncRecords(registryRecords);
    }
};

export const pushSyncLibraryBundleToRemote = async (bundle: SyncLibraryExportBundle, config = getSyncConfig()) => {
    assertSyncCurrent(config);
    if (!isSyncConfigured(config)) {
        return false;
    }

    if (bundle.settings) {
        await putRemoteSettings(config, bundle.settings);
    }
    for (let index = 0; index < bundle.themes.length; index += THEME_BATCH_SIZE) {
        await putRemoteThemes(config, bundle.themes.slice(index, index + THEME_BATCH_SIZE));
    }
    setSyncStatus({ state: 'success', lastSyncAt: new Date().toISOString(), lastError: null }, config);
    return true;
};
