import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { appDatabase } from '../../../src/services/appDatabase';
import { buildThemeBucketSummaries } from '../../../src/services/sync/syncMerkle';
import { listAllRemoteThemeRecords, pushMissingLocalThemesToRemote } from '../../../src/services/sync/syncRepository';
import { getRemoteThemes, getRemoteSettings, getRemoteThemeManifest } from '../../../src/services/sync/syncClient';
import { syncNow } from '../../../src/services/sync/syncCoordinator';
import { SYNC_PROVIDER } from '../../../src/services/sync/syncTypes';
import { getSyncConfig, saveSyncConfig } from '../../../src/services/sync/syncConfig';
import { installMobileRuntime } from '../../../src/services/mobileRuntime';

// syncSession.test.ts — captured server identity, watermark isolation, bounded pagination and protection of settings edited while awaiting network.
const visual = vi.hoisted(() => ({ value: 1, apply: vi.fn() }));
vi.mock('../../../src/services/sync/settingsSnapshot', () => ({
  readSyncableSettingsState: () => ({ value: visual.value }), getSyncedSettingsSignature: () => String(visual.value),
  buildSyncedSettingsRecord: () => ({ schemaVersion: 1, updatedAt: '2026-01-01T00:00:00Z', data: {} }),
  applySyncedVisualSettings: visual.apply,
}));
const remoteState = { schemaVersion: 1, settingsUpdatedAt: '2026-01-01T00:00:00Z', themesUpdatedAt: null, themeCount: 0 };
const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });
const connection = (scope = 'one') => ({ provider: SYNC_PROVIDER, enabled: true, workerBaseUrl: 'https://sync.example', authToken: '',
  nativeSession: { hasToken: true, scope, assertCurrent: vi.fn(), request: vi.fn(async (path: string, _init: RequestInit) => {
    if (path === '/state') return json(remoteState);
    return json({ schemaVersion: 1, bucketCount: 256, buckets: buildThemeBucketSummaries([]) });
  }) } });
beforeEach(async () => {
  const values = new Map<string, string>();
  const localStorage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) };
  vi.stubGlobal('window', Object.assign(new EventTarget(), { localStorage })); vi.stubGlobal('localStorage', localStorage);
  visual.value = 1; visual.apply.mockClear(); await appDatabase.delete(); await appDatabase.open();
});
afterEach(async () => { await appDatabase.delete(); vi.unstubAllGlobals(); });
it('does not reuse another server or account checkpoint', async () => {
  const first = connection('first'), second = connection('second');
  await pushMissingLocalThemesToRemote(remoteState, first);
  await pushMissingLocalThemesToRemote(remoteState, first);
  await pushMissingLocalThemesToRemote(remoteState, second);
  expect(first.nativeSession.request).toHaveBeenCalledTimes(1);
  expect(second.nativeSession.request).toHaveBeenCalledTimes(1);
  expect(localStorage.getItem('folia_sync_theme_watermark_v1:first')).not.toBeNull();
  expect(localStorage.getItem('folia_sync_theme_watermark_v1:second')).not.toBeNull();
});
it('rejects repeated pagination cursors and invalid records instead of silently reporting success', async () => {
  const config = connection();
  config.nativeSession.request.mockResolvedValue(json({ themes: [], cursor: 'same' }));
  // Responses are bodies consumed once, as in the real bridge.
  config.nativeSession.request.mockImplementation(async () => json({ themes: [], cursor: 'same' }));
  await expect(listAllRemoteThemeRecords(config)).rejects.toThrow('sync-invalid-cursor');
  expect(config.nativeSession.request).toHaveBeenCalledTimes(2);
  config.nativeSession.request.mockImplementation(async () => json({ themes: [{ fingerprint: 'bad' }] }));
  await expect(getRemoteThemes(config, ['netease:id:42'])).rejects.toThrow('sync-invalid-response');
  config.nativeSession.request.mockImplementation(async () => json({ schemaVersion: 99 }));
  await expect(getRemoteSettings(config)).rejects.toThrow('sync-invalid-response');
});
it('does not checkpoint a missing or duplicate manifest bucket as an empty library', async () => {
  const config = connection();
  for (const buckets of [[], buildThemeBucketSummaries([]).map(bucket => ({ ...bucket, bucketId: 0 }))]) {
    config.nativeSession.request.mockImplementation(async () => json({ schemaVersion: 1, bucketCount: 256, buckets }));
    await expect(getRemoteThemeManifest(config)).rejects.toThrow('sync-invalid-response');
  }
  config.nativeSession.request.mockImplementation(async () => json({}));
  await expect(getRemoteThemes(config, ['netease:id:42'])).rejects.toThrow('sync-invalid-response');
  expect(localStorage.getItem('folia_sync_theme_watermark_v1:one')).toBeNull();
});
it('keeps a local visual edit made during an in-flight pull and does not push it implicitly', async () => {
  const config = connection();
  let release!: (response: Response) => void;
  config.nativeSession.request.mockImplementation(async path => {
    if (path === '/state') return json(remoteState);
    if (path === '/settings') return new Promise(resolve => { release = resolve; });
    throw Error('unexpected request');
  });
  const work = syncNow({ syncThemes: false, applyRemoteSettings: true, pushSettings: true }, config);
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  visual.value = 2;
  const rejected = expect(work).rejects.toThrow('sync-local-settings-changed');
  release(json({ schemaVersion: 1, updatedAt: remoteState.settingsUpdatedAt, data: { lyricsFontScale: 1.4 } }));
  await rejected; expect(visual.apply).not.toHaveBeenCalled(); expect(config.nativeSession.request).toHaveBeenCalledTimes(2);
});
it('native runtime cannot read or save a legacy localStorage token', () => {
  localStorage.setItem('folia_sync_config_v1', JSON.stringify({ enabled: true, workerBaseUrl: 'https://old.example', authToken: 'legacy-secret' }));
  installMobileRuntime({ fetch: vi.fn(), read: () => null, write: () => undefined });
  expect(getSyncConfig()).toMatchObject({ enabled: false, workerBaseUrl: '', authToken: '' });
  expect(() => saveSyncConfig({ ...getSyncConfig(), authToken: 'new-secret' })).toThrow('sync-native-settings-required');
});
