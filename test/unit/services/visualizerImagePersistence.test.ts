import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appDatabase } from '@/services/appDatabase';
import { getCustomCappellaAvatar, saveCustomCappellaAvatar, clearCustomCappellaAvatar } from '@/services/cappellaAvatarPack';
import { getCustomCappellaEmojiPack, saveCustomCappellaEmojiPack, clearCustomCappellaEmojiPack } from '@/services/cappellaEmojiPack';
import { getMonetPortraitImage, saveMonetPortraitImage, clearMonetPortraitImage } from '@/services/monetPortraitImage';
import { getMonetBackgroundImage, saveMonetBackgroundImage, clearMonetBackgroundImage } from '@/services/monetBackgroundImage';
import { getTemperaLayerImage, saveTemperaLayerImage, clearTemperaLayerImage, type StoredTemperaLayerImage } from '@/services/temperaLayerImages';
import { useVisualizerAssetStore } from '@/stores/useVisualizerAssetStore';
import { useVisualizerSettingsStore } from '@/stores/useVisualizerSettingsStore';
import { useStatusMessageStore } from '@/stores/useStatusMessageStore';

// test/unit/services/visualizerImagePersistence.test.ts
// Exercises real asset services and Dexie, including storage rejection at the store action boundary.
const image = (id = 'original'): StoredTemperaLayerImage => ({
    id, name: `${id}.png`, mimeType: 'image/png',
    blob: new File([new Uint8Array([137, 80, 78, 71, 13, 10])], `${id}.png`, { type: 'image/png' }),
});

// Dexie's db.table(name) can differ from the named table property after reopening the database.
// Fail at the actual IndexedDB operation and assert it was reached, not at a facade instance.
const failWrite = () => vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => {
    throw new DOMException('disk-write-failed', 'QuotaExceededError');
});
const failDelete = () => vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementationOnce(() => {
    throw new DOMException('disk-delete-failed', 'UnknownError');
});

const services = [
    { name: 'avatar', key: 'cappella_custom_avatar', pack: true, save: (v: StoredTemperaLayerImage) => saveCustomCappellaAvatar([v]), read: async () => (await getCustomCappellaAvatar())[0] ?? null, clear: clearCustomCappellaAvatar },
    { name: 'emoji', key: 'cappella_custom_emoji_pack', pack: true, save: (v: StoredTemperaLayerImage) => saveCustomCappellaEmojiPack([v]), read: async () => (await getCustomCappellaEmojiPack())[0] ?? null, clear: clearCustomCappellaEmojiPack },
    { name: 'portrait', key: 'monet_portrait_image', pack: false, save: saveMonetPortraitImage, read: getMonetPortraitImage, clear: clearMonetPortraitImage },
    { name: 'background', key: 'monet_background_image', pack: false, save: saveMonetBackgroundImage, read: getMonetBackgroundImage, clear: clearMonetBackgroundImage },
    { name: 'tempera', key: 'tempera_layer_image_original', pack: false, save: saveTemperaLayerImage, read: () => getTemperaLayerImage('original'), clear: () => clearTemperaLayerImage('original') },
];

beforeEach(async () => {
    await appDatabase.delete();
    await appDatabase.open();
    useStatusMessageStore.setState({ message: null });
});

afterEach(async () => {
    vi.restoreAllMocks();
    await appDatabase.delete();
    useVisualizerAssetStore.setState(useVisualizerAssetStore.getInitialState());
    useVisualizerSettingsStore.setState(useVisualizerSettingsStore.getInitialState());
    useStatusMessageStore.setState({ message: null });
});

describe.each(services)('$name image persistence', service => {
    it('stores owned bytes and restores the same image after reopening the database', async () => {
        const original = image();
        await service.save(original);
        const row = (await appDatabase.api_cache.get(service.key))!.data;
        const record = service.pack ? (row as unknown[])[0] : row;
        expect(record).toMatchObject({ version: 2, data: expect.any(ArrayBuffer) });
        expect(record).not.toHaveProperty('blob');
        appDatabase.close();
        await appDatabase.open();
        const restored = await service.read();
        expect(restored).toMatchObject({ id: original.id, name: original.name, mimeType: original.mimeType });
        expect(restored?.blob.type).toBe('image/png');
        expect(await restored?.blob.arrayBuffer()).toEqual(await original.blob.arrayBuffer());
        await service.clear();
        expect(await service.read()).toBeNull();
    });

    it('reads legacy Blob records without rewriting them', async () => {
        const legacy = image();
        await appDatabase.api_cache.put({ key: service.key, data: service.pack ? [legacy] : legacy, timestamp: 1 });
        expect(await (await service.read())?.blob.arrayBuffer()).toEqual(await legacy.blob.arrayBuffer());
        expect((await appDatabase.api_cache.get(service.key))?.timestamp).toBe(1);
    });

    it('rejects a failed replacement and retains the persisted image', async () => {
        await service.save(image());
        const before = await appDatabase.api_cache.get(service.key);
        const failure = failWrite();
        await expect(service.save({ ...image(), name: 'replacement.png' })).rejects.toThrow('disk-write-failed');
        expect(failure).toHaveBeenCalledTimes(1);
        expect(await appDatabase.api_cache.get(service.key)).toEqual(before);
    });

    it('rejects a failed deletion and retains the persisted image', async () => {
        await service.save(image());
        const failure = failDelete();
        await expect(service.clear()).rejects.toThrow('disk-delete-failed');
        expect(failure).toHaveBeenCalledTimes(1);
        expect((await service.read())?.id).toBe('original');
    });

    it('rejects an unreadable file before replacing the persisted image', async () => {
        await service.save(image());
        const before = await appDatabase.api_cache.get(service.key);
        const unreadable = image();
        vi.spyOn(unreadable.blob, 'arrayBuffer').mockRejectedValueOnce(new Error('file-read-failed'));
        await expect(service.save(unreadable)).rejects.toThrow('file-read-failed');
        expect(await appDatabase.api_cache.get(service.key)).toEqual(before);
    });

    it('does not claim success for an empty file that cannot be restored', async () => {
        await service.save(image());
        const before = await appDatabase.api_cache.get(service.key);
        await expect(service.save({ ...image(), blob: new Blob([]) })).rejects.toThrow('empty visualizer image');
        expect(await appDatabase.api_cache.get(service.key)).toEqual(before);
    });

    it('ignores corrupt or unknown-version records', async () => {
        const { blob, ...meta } = image();
        for (const record of [null, { ...meta, version: 3, blob }, { ...meta, version: 2, data: 'invalid' }, { ...meta, version: 2, data: new ArrayBuffer(0) }]) {
            await appDatabase.api_cache.put({ key: service.key, data: service.pack ? [record] : record, timestamp: 1 });
            expect(await service.read()).toBeNull();
        }
    });
});

it('keeps a Tempera thumbnail as bytes and restores its MIME type and contents', async () => {
    const original = { ...image(), thumbnail: new Blob(['small-preview'], { type: 'image/webp' }) };
    await appDatabase.api_cache.put({ key: 'tempera_layer_image_original', data: original, timestamp: 1 });
    expect(await (await getTemperaLayerImage('original'))?.thumbnail?.text()).toBe('small-preview');
    await saveTemperaLayerImage(original);
    const row = (await appDatabase.api_cache.get('tempera_layer_image_original'))!.data;
    expect(row).toMatchObject({ thumbnail: { data: expect.any(ArrayBuffer), mimeType: 'image/webp' } });
    appDatabase.close();
    await appDatabase.open();
    const restored = await getTemperaLayerImage('original');
    expect(await restored?.thumbnail?.text()).toBe('small-preview');
    expect(restored?.thumbnail?.type).toBe('image/webp');
});

it('retains the image when its new thumbnail cannot be read', async () => {
    await saveTemperaLayerImage(image());
    const thumbnail = new Blob(['preview']);
    vi.spyOn(thumbnail, 'arrayBuffer').mockRejectedValueOnce(new Error('thumbnail-read-failed'));
    await expect(saveTemperaLayerImage({ ...image(), thumbnail })).rejects.toThrow('thumbnail-read-failed');
    expect((await getTemperaLayerImage('original'))?.thumbnail).toBeUndefined();
});

const storeActions = [
    { name: 'avatar', import: (file: File) => useVisualizerSettingsStore.getState().handleImportCustomCappellaAvatar([file]), clear: () => useVisualizerSettingsStore.getState().handleClearCustomCappellaAvatar() },
    { name: 'emoji', import: (file: File) => useVisualizerSettingsStore.getState().handleImportCustomCappellaEmojiPack([file]), clear: () => useVisualizerSettingsStore.getState().handleClearCustomCappellaEmojiPack() },
    { name: 'portrait', import: (file: File) => useVisualizerSettingsStore.getState().handleUploadMonetPortraitImage([file]), clear: () => useVisualizerSettingsStore.getState().handleClearMonetPortraitImage() },
    { name: 'background', import: (file: File) => useVisualizerSettingsStore.getState().handleUploadMonetBackgroundImage([file]), clear: () => useVisualizerSettingsStore.getState().handleClearMonetBackgroundImage() },
];

describe.each(storeActions)('$name store error propagation', action => {
    it('does not publish new assets or success when persistence fails', async () => {
        const file = image().blob as File;
        await action.import(file);
        useStatusMessageStore.setState({ message: null });
        const assets = useVisualizerAssetStore.getState();
        const failure = failWrite();
        await expect(action.import(file)).rejects.toThrow('disk-write-failed');
        expect(failure).toHaveBeenCalledTimes(1);
        expect(useVisualizerAssetStore.getState()).toBe(assets);
        expect(useStatusMessageStore.getState().message).toBeNull();
    });

    it('does not clear assets or settings or publish success when deletion fails', async () => {
        await action.import(image().blob as File);
        useStatusMessageStore.setState({ message: null });
        const assets = useVisualizerAssetStore.getState();
        const settings = useVisualizerSettingsStore.getState();
        const failure = failDelete();
        await expect(action.clear()).rejects.toThrow('disk-delete-failed');
        expect(failure).toHaveBeenCalledTimes(1);
        expect(useVisualizerAssetStore.getState()).toBe(assets);
        expect(useVisualizerSettingsStore.getState()).toBe(settings);
        expect(useStatusMessageStore.getState().message).toBeNull();
    });
});
