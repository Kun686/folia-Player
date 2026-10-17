import { getFromCache } from './db';
import { putCacheEntry, removeCacheEntry } from './repositories/cacheRepository';

// src/services/visualizerImageAsset.ts
// Shared storage for visualizer images and packs; renderers continue receiving Blobs.
interface StoredVisualizerImageAsset {
    id: string;
    name: string;
    mimeType: string;
    blob: Blob;
    thumbnail?: Blob;
}

interface PersistedVisualizerImageAsset {
    version: 2;
    id: string;
    name: string;
    mimeType: string;
    data: ArrayBuffer;
    thumbnail?: { mimeType: string; data: ArrayBuffer };
}

const SUPPORTED_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'];

// Like uploaded fonts, persist owned bytes: WebKit can fail preparing Blob/File data for IndexedDB.
// Include Tempera's small preview, otherwise the thumbnail would keep the failing Blob write path.
const encodeImage = async (image: StoredVisualizerImageAsset): Promise<PersistedVisualizerImageAsset> => {
    const data = await image.blob.arrayBuffer();
    const thumbnail = image.thumbnail
        ? { mimeType: image.thumbnail.type, data: await image.thumbnail.arrayBuffer() }
        : undefined;
    if (!image.id || !data.byteLength || (thumbnail && !thumbnail.data.byteLength)) {
        throw new Error('Cannot persist an empty visualizer image');
    }
    return {
        version: 2, id: image.id, name: image.name, mimeType: image.mimeType, data,
        ...(thumbnail ? { thumbnail } : {}),
    };
};

const decodeImage = <T extends StoredVisualizerImageAsset>(value: unknown): T | null => {
    if (!value || typeof value !== 'object') return null;
    const record = value as Partial<PersistedVisualizerImageAsset> & { blob?: unknown };
    if (typeof record.id !== 'string' || !record.id || typeof record.name !== 'string'
        || typeof record.mimeType !== 'string') return null;

    if ('version' in record) {
        if (record.version !== 2 || !(record.data instanceof ArrayBuffer) || record.data.byteLength === 0) return null;
        if (record.thumbnail !== undefined && (!record.thumbnail || !(record.thumbnail.data instanceof ArrayBuffer)
            || record.thumbnail.data.byteLength === 0 || typeof record.thumbnail.mimeType !== 'string')) return null;
        return {
            id: record.id, name: record.name, mimeType: record.mimeType,
            blob: new Blob([record.data], { type: record.mimeType }),
            ...(record.thumbnail ? { thumbnail: new Blob([record.thumbnail.data], { type: record.thumbnail.mimeType }) } : {}),
        } as T;
    }

    // Existing installations keep their Blob records; migrate only when the user next saves.
    return record.blob instanceof Blob && record.blob.size > 0 ? value as T : null;
};

export const getStoredVisualizerImageAsset = async <T extends StoredVisualizerImageAsset>(key: string): Promise<T | null> => (
    decodeImage<T>(await getFromCache<unknown>(key))
);

export const getStoredVisualizerImagePack = async <T extends StoredVisualizerImageAsset>(key: string): Promise<T[]> => {
    const stored = await getFromCache<unknown>(key);
    if (!Array.isArray(stored)) return [];
    return stored.map(entry => decodeImage<T>(entry)).filter((entry): entry is T => entry !== null);
};

export const saveStoredVisualizerImagePack = async (key: string, images: StoredVisualizerImageAsset[]): Promise<void> => {
    const records: PersistedVisualizerImageAsset[] = [];
    for (const image of images) records.push(await encodeImage(image));
    // A user asset is durable state: reject on failure so callers cannot publish false success.
    await putCacheEntry(key, records);
};

export const saveStoredVisualizerImageAsset = async <T extends StoredVisualizerImageAsset>(
    key: string,
    image: T,
): Promise<void> => {
    await putCacheEntry(key, await encodeImage(image));
};

export const clearStoredVisualizerImageAsset = async (key: string): Promise<void> => {
    await removeCacheEntry(key);
};

export const isSupportedVisualizerImageFile = (file: File) => {
    const lowerName = file.name.toLowerCase();
    const hasSupportedExtension = SUPPORTED_IMAGE_EXTENSIONS.some(extension => lowerName.endsWith(extension));
    return file.type.startsWith('image/') || hasSupportedExtension;
};

export const buildStoredVisualizerImageAsset = <T extends StoredVisualizerImageAsset>(file: File): T => ({
    id: `${Date.now()}-${file.name}`,
    name: file.name,
    mimeType: file.type || 'application/octet-stream',
    blob: file,
} as unknown as T);
