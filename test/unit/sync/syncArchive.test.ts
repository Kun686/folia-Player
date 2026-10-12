import { describe, expect, it } from 'vitest';
import { createSyncLibraryZipBlob, readSyncLibraryZipFile } from '@/services/sync/syncArchive';
import { SYNC_SCHEMA_VERSION, type SyncLibraryExportBundle } from '@/services/sync/syncTypes';
import { zipSync } from 'fflate';

// test/unit/sync/syncArchive.test.ts
// Ensures full-library backups are stored as multi-file zip archives.

describe('sync archive', () => {
    it('rejects oversized input and expanded ZIP contents before parsing', async () => {
        const file = new File([zipSync({ 'themes/themes.json': new Uint8Array(200_000) })], 'large.zip');
        expect(file.size).toBeLessThan(10_000);
        await expect(readSyncLibraryZipFile(file, 10_000)).rejects.toThrow('sync-library-too-large');
        await expect(readSyncLibraryZipFile(new File([new Uint8Array(101)], 'large.zip'), 100)).rejects.toThrow('sync-library-too-large');
    });
    it('round-trips a multi-file sync zip export', async () => {
        const exportedAt = '2026-07-08T00:00:00.000Z';
        const bundle: SyncLibraryExportBundle = {
            kind: 'folia-sync-export',
            schemaVersion: SYNC_SCHEMA_VERSION,
            exportedAt,
            settings: null,
            themes: [{
                fingerprint: 'netease:id:123',
                theme: {
                    light: { name: 'Light', backgroundColor: '#fff', primaryColor: '#111', secondaryColor: '#333', accentColor: '#555', fontStyle: 'sans', animationIntensity: 'normal' },
                    dark: { name: 'Dark', backgroundColor: '#111', primaryColor: '#fff', secondaryColor: '#ddd', accentColor: '#aaa', fontStyle: 'sans', animationIntensity: 'normal' },
                },
                updatedAt: exportedAt,
                source: 'manual',
            }],
        };

        const blob = createSyncLibraryZipBlob(bundle);
        const file = new File([blob], 'folia-sync.zip', { type: 'application/zip' });
        const parsed = await readSyncLibraryZipFile(file);

        expect(parsed.kind).toBe('folia-sync-export');
        expect(parsed.exportedAt).toBe(exportedAt);
        expect(parsed.themes).toHaveLength(1);
        expect(parsed.themes[0].fingerprint).toBe('netease:id:123');
    });
});
