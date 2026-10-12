import type {
    SyncRemoteState,
    SyncThemeManifest,
    SyncedSettingsRecord,
    SyncedThemeRecord,
    WorkerHealthResponse,
} from './syncTypes';
import {
    parseSyncRemoteState,
    parseSyncThemeManifest,
    parseSyncedSettingsRecord,
    parseSyncedThemeRecords,
} from './syncSchema';
import { assertSyncCurrent, type SyncConnection } from './syncConnection';
import { THEME_BUCKET_COUNT } from './syncMerkle';

// src/services/sync/syncClient.ts
// HTTP adapter for Folia's user-hosted sync API.

export class SyncClientError extends Error {
    status: number;

    constructor(message: string, status: number) {
        super(message);
        this.name = 'SyncClientError';
        this.status = status;
    }
}

export type ThemeListPage = {
    themes: SyncedThemeRecord[];
    cursor: string | null;
};

const parseThemeResponse = (config: SyncConnection, value: unknown) => {
    const records = parseSyncedThemeRecords(value);
    if (config.nativeSession && (!Array.isArray(value) || records.length !== value.length
        || new Set(records.map(record => record.fingerprint)).size !== records.length)) throw new Error('sync-invalid-response');
    return records;
};

const buildUrl = (config: SyncConnection, path: string) => (
    `${config.workerBaseUrl.replace(/\/+$/, '')}${path}`
);

const requestJson = async <T,>(
    config: SyncConnection,
    path: string,
    init: RequestInit = {},
): Promise<T> => {
    assertSyncCurrent(config);
    const response = config.nativeSession ? await config.nativeSession.request(path, init) : await fetch(buildUrl(config, path), {
        ...init,
        headers: {
            Accept: 'application/json',
            ...(init.body ? { 'Content-Type': 'application/json' } : {}),
            Authorization: `Bearer ${config.authToken}`,
            ...init.headers,
        },
    });

    assertSyncCurrent(config);
    if (!response.ok) {
        throw new SyncClientError(`Sync request failed: ${response.status}`, response.status);
    }

    if (response.status === 204) {
        return null as T;
    }

    const value = await response.json() as T;
    assertSyncCurrent(config);
    return value;
};

export const testSyncConnection = async (config: SyncConnection) => (
    await requestJson<WorkerHealthResponse>(config, '/health')
);

export const getRemoteState = async (config: SyncConnection): Promise<SyncRemoteState | null> => (
    parseSyncRemoteState(await requestJson(config, '/state'))
);

export const getRemoteThemeManifest = async (config: SyncConnection): Promise<SyncThemeManifest | null> => {
    const manifest = parseSyncThemeManifest(await requestJson(config, '/themes/manifest'));
    // A missing or duplicate bucket could otherwise be mistaken for an empty library and checkpointed as complete.
    if (config.nativeSession && (!manifest || manifest.bucketCount !== THEME_BUCKET_COUNT
        || manifest.buckets.length !== THEME_BUCKET_COUNT
        || new Set(manifest.buckets.map(bucket => bucket.bucketId)).size !== THEME_BUCKET_COUNT
        || manifest.buckets.some(bucket => bucket.bucketId >= THEME_BUCKET_COUNT))) throw new Error('sync-invalid-response');
    return manifest;
};

export const getRemoteSettings = async (config: SyncConnection): Promise<SyncedSettingsRecord | null> => {
    const value = await requestJson(config, '/settings'), parsed = parseSyncedSettingsRecord(value);
    if (config.nativeSession && value !== null && !parsed) throw new Error('sync-invalid-response');
    return parsed;
};

export const putRemoteSettings = async (config: SyncConnection, record: SyncedSettingsRecord) => {
    await requestJson(config, '/settings', {
        method: 'PUT',
        body: JSON.stringify(record),
    });
};

export const getRemoteThemes = async (
    config: SyncConnection,
    fingerprints: string[],
): Promise<SyncedThemeRecord[]> => {
    const uniqueFingerprints = Array.from(new Set(fingerprints.filter(Boolean)));
    if (uniqueFingerprints.length === 0) {
        return [];
    }

    const response = await requestJson<{ themes?: unknown[] }>(config, '/themes/get', {
        method: 'POST',
        body: JSON.stringify({ fingerprints: uniqueFingerprints }),
    });

    return parseThemeResponse(config, config.nativeSession ? response.themes : response.themes ?? []);
};

export const putRemoteThemes = async (
    config: SyncConnection,
    themes: SyncedThemeRecord[],
) => {
    if (themes.length === 0) {
        return;
    }

    await requestJson(config, '/themes/put', {
        method: 'POST',
        body: JSON.stringify({ themes }),
    });
};

export const getRemoteThemesByBuckets = async (
    config: SyncConnection,
    bucketIds: number[],
): Promise<SyncedThemeRecord[]> => {
    const ids = Array.from(new Set(bucketIds.filter(Number.isInteger)));
    if (ids.length === 0) {
        return [];
    }

    const response = await requestJson<{ themes?: unknown[] }>(config, '/themes/bucket', {
        method: 'POST',
        body: JSON.stringify({ bucketIds: ids }),
    });

    return parseThemeResponse(config, config.nativeSession ? response.themes : response.themes ?? []);
};

export const listRemoteThemes = async (
    config: SyncConnection,
    options: { cursor?: string | null; limit?: number } = {},
): Promise<ThemeListPage> => {
    const response = await requestJson<{ themes?: unknown[]; cursor?: unknown }>(config, '/themes/list', {
        method: 'POST',
        body: JSON.stringify({
            cursor: options.cursor ?? null,
            limit: options.limit ?? 500,
        }),
    });

    return {
        themes: parseThemeResponse(config, config.nativeSession ? response.themes : response.themes ?? []),
        cursor: typeof response.cursor === 'string' && response.cursor ? response.cursor : null,
    };
};
