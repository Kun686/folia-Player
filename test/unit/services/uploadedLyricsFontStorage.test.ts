import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { appDatabase } from '@/services/appDatabase';
import * as cache from '@/services/repositories/cacheRepository';
import { buildStoredUploadedLyricsFont, clearUploadedLyricsFont, getStoredUploadedLyricsFont,
    restoreUploadedLyricsFont, uploadAndRegisterLyricsFont, UPLOADED_LYRICS_FONT_KEY } from '@/services/customLyricsFont';

// uploadedLyricsFontStorage.test.ts — real Dexie transactions/structured cloning; FontFace decode is covered in WebKit.
const file = (name: string) => new File(['font bytes'], name, { type: 'font/ttf' });
const faces = new Set<unknown>();
beforeEach(async () => {
    await appDatabase.open();
    vi.stubGlobal('document', { fonts: { add: (face: unknown) => faces.add(face), delete: (face: unknown) => faces.delete(face) } });
    vi.stubGlobal('FontFace', class { async load() { return this; } });
    await clearUploadedLyricsFont();
});
afterEach(async () => {
    vi.restoreAllMocks();
    await clearUploadedLyricsFont();
    vi.unstubAllGlobals();
    appDatabase.close();
});

it('durably stores one owned byte payload and reloads it through the original loader', async () => {
    const uploaded = await uploadAndRegisterLyricsFont(file('Bytes.ttf'));
    const persisted = await cache.readCacheEntry<{ version: number; data: ArrayBuffer }>(UPLOADED_LYRICS_FONT_KEY);
    expect(persisted?.version).toBe(2);
    expect(persisted).not.toHaveProperty('blob');
    expect(new TextDecoder().decode(persisted!.data)).toBe('font bytes');
    expect(await (await getStoredUploadedLyricsFont())?.blob.text()).toBe('font bytes');
    expect((await restoreUploadedLyricsFont(uploaded.meta.fontId!))?.family).toBe(uploaded.meta.family);
});

it('still reads legacy Blob records without rewriting or discarding them', async () => {
    const legacy = buildStoredUploadedLyricsFont(file('Legacy.ttf'));
    await cache.putCacheEntry(UPLOADED_LYRICS_FONT_KEY, legacy);
    expect(await (await getStoredUploadedLyricsFont())?.blob.text()).toBe('font bytes');
    expect((await restoreUploadedLyricsFont(legacy.id))?.family).toBe(legacy.family);
});

it('clear during a write aborts the stale transaction and cannot resurrect a font', async () => {
    await uploadAndRegisterLyricsFont(file('Previous.ttf'));
    const originalPut = cache.putCacheEntry;
    let clearing: Promise<void> | undefined;
    vi.spyOn(cache, 'putCacheEntry').mockImplementationOnce(async (key, data) => {
        await originalPut(key, data);
        // A user action runs outside the write's Dexie async transaction context.
        clearing = Dexie.ignoreTransaction(() => clearUploadedLyricsFont());
    });
    await expect(uploadAndRegisterLyricsFont(file('Late.ttf'))).rejects.toThrow('font-operation-cancelled');
    await clearing;
    expect(await getStoredUploadedLyricsFont()).toBeNull();
    expect(faces.size).toBe(0);
});
