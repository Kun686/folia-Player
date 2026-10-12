import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { appDatabase } from '../../../src/services/appDatabase';
import { BASE_DUAL_THEME } from '../../../src/services/baseThemes';
import { saveEditedSongTheme } from '../../../src/services/songThemeCache';
import { getCachedThemeStateForSong } from '../../../src/services/themeCache';
import { createSongSyncFingerprint } from '../../../src/services/sync/syncFingerprint';
import { SavedThemeUploadQueue } from '../../../src/services/sync/savedThemeUpload';
import { SYNC_PROVIDER } from '../../../src/services/sync/syncTypes';
import type { SongResult } from '../../../src/types';

// savedThemeUpload.test.ts — actual local transactions and original sync client, with bounded synthetic network and no live provider.
const theme = (name: string) => ({ light: { ...BASE_DUAL_THEME.light, name }, dark: { ...BASE_DUAL_THEME.dark, name } });
const song = (providerId: 'qq' | 'netease' = 'netease'): SongResult => ({ id: '42', name: 'Track', durationMs: 1000,
  artists: [{ id: 0, name: 'Artist' }], album: { id: 0, name: '' }, sourceRef: { kind: 'online', providerId, mediaId: '42' } });
const connection = (scope = 'one') => ({ provider: SYNC_PROVIDER, enabled: true, workerBaseUrl: 'https://sync.example', authToken: '',
  nativeSession: { hasToken: true, scope, assertCurrent: vi.fn(), request: vi.fn(async (_path: string, _init: RequestInit) => new Response('{}')) } });
beforeEach(async () => { await appDatabase.delete(); await appDatabase.open(); });
afterEach(async () => { vi.restoreAllMocks(); await appDatabase.delete(); });
it('uploads only the saved song and retains its exact provenance/timestamp without changing the local registry', async () => {
  for (const provider of ['qq', 'netease'] as const) await saveEditedSongTheme(song(provider), theme(provider), () => true, { source: 'auto' });
  const before = await appDatabase.theme_registry.toArray();
  const config = connection();
  await new SavedThemeUploadQueue().enqueue(createSongSyncFingerprint(song())!, config);
  expect(config.nativeSession.request).toHaveBeenCalledTimes(1);
  const [path, init] = config.nativeSession.request.mock.calls[0];
  expect(path).toBe('/themes/put'); expect(init.method).toBe('POST');
  const body = JSON.parse(String(init.body));
  expect(body.themes).toHaveLength(1);
  expect(body.themes[0]).toMatchObject({ fingerprint: 'netease:id:42', source: 'auto', theme: { dark: { name: 'netease' } },
    updatedAt: before.find(record => record.fingerprint === 'netease:id:42')!.updatedAt });
  expect(await appDatabase.theme_registry.toArray()).toEqual(before);
});
it('serializes requests and coalesces queued edits of the same song to the latest committed content', async () => {
  const config = connection(), queue = new SavedThemeUploadQueue();
  const fingerprint = createSongSyncFingerprint(song())!;
  let release!: (response: Response) => void;
  config.nativeSession.request.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  await saveEditedSongTheme(song(), theme('First'), () => true);
  const work = queue.enqueue(fingerprint, config);
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  await saveEditedSongTheme(song(), theme('Second'), () => true); queue.enqueue(fingerprint, config);
  await saveEditedSongTheme(song(), theme('Last'), () => true); queue.enqueue(fingerprint, config);
  expect(config.nativeSession.request).toHaveBeenCalledTimes(1);
  release(new Response('{}')); await work;
  expect(config.nativeSession.request).toHaveBeenCalledTimes(2);
  const names = config.nativeSession.request.mock.calls.map(([, init]) => JSON.parse(String(init.body)).themes[0].theme.dark.name);
  expect(names).toEqual(['First', 'Last']);
});
it('keeps local success when the optional upload fails and permits a later explicit retry', async () => {
  const config = connection(), failed = vi.fn(), queue = new SavedThemeUploadQueue(undefined, failed);
  await saveEditedSongTheme(song(), theme('Retained'), () => true, { source: 'fallback' });
  config.nativeSession.request.mockResolvedValueOnce(new Response('', { status: 401 }));
  await queue.enqueue('netease:id:42', config);
  expect(failed).toHaveBeenCalledWith(config);
  expect(await getCachedThemeStateForSong(song())).toMatchObject({ theme: { dark: { name: 'Retained' } } });
  await queue.enqueue('netease:id:42', config);
  expect(config.nativeSession.request).toHaveBeenCalledTimes(2);
});
it('orders local edits after the previous record when the device clock is behind, preventing stale bulk uploads winning', async () => {
  await saveEditedSongTheme(song(), theme('Old'), () => true);
  const old = (await appDatabase.theme_registry.get('netease:id:42'))!;
  await appDatabase.theme_registry.put({ ...old, updatedAt: '2099-01-01T00:00:00.000Z' });
  await saveEditedSongTheme(song(), theme('New'), () => true);
  const current = (await appDatabase.theme_registry.get('netease:id:42'))!;
  expect(current.updatedAt).toBe('2099-01-01T00:00:00.001Z');
  await saveEditedSongTheme(song(), theme('Newest'), () => true);
  expect((await appDatabase.theme_registry.get('netease:id:42'))!.updatedAt).toBe('2099-01-01T00:00:00.002Z');
});
it('skips disabled, stale and removed work without uploading to a different account', async () => {
  const config = connection(), send = vi.fn(async () => undefined), queue = new SavedThemeUploadQueue(send, vi.fn());
  await queue.enqueue('netease:id:42', { ...config, enabled: false });
  const work = queue.enqueue('netease:id:42', config);
  config.nativeSession.assertCurrent.mockImplementation(() => { throw Error('sync-cancelled'); });
  const next = connection('next'); queue.enqueue('netease:id:42', next); await work;
  expect(send).toHaveBeenCalledTimes(1); expect(send).toHaveBeenCalledWith('netease:id:42', next);
  const empty = connection(); await new SavedThemeUploadQueue().enqueue('netease:id:missing', empty);
  expect(empty.nativeSession.request).not.toHaveBeenCalled();
});
it('bounds pending work, reports overflow and remains usable after completion', async () => {
  let release!: () => void;
  const send = vi.fn(async (): Promise<void> => undefined).mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
  const failed = vi.fn(), queue = new SavedThemeUploadQueue(send, failed), config = connection();
  const work = queue.enqueue('first', config); await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  for (let i = 0; i < 129; i++) queue.enqueue(`next-${i}`, config);
  expect(failed).toHaveBeenCalledTimes(1); release(); await work;
  expect(send).toHaveBeenCalledTimes(129);
  await queue.enqueue('after', config); expect(send).toHaveBeenCalledTimes(130);
});
