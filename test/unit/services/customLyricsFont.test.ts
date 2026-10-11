import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n/config';
import {
    buildStoredUploadedLyricsFont,
    clearUploadedLyricsFont,
    getStoredUploadedLyricsFont,
    isSupportedLyricsFontFile,
    registerUploadedLyricsFont,
    restoreUploadedLyricsFont,
    uploadAndRegisterLyricsFont,
    UploadedFontOperationCancelled,
    validateUploadedLyricsFontFile,
} from '@/services/customLyricsFont';
import { getFromCache, removeFromCache } from '@/services/db';
import { putCacheEntry } from '@/services/repositories/cacheRepository';

vi.mock('@/services/db', () => ({
    getFromCache: vi.fn(),
    removeFromCache: vi.fn(),
}));
vi.mock('@/services/repositories/cacheRepository', () => ({ putCacheEntry: vi.fn(), getCacheTableName: () => 'api_cache' }));
vi.mock('@/services/appDatabase', () => ({ appDatabase: { table: vi.fn(), transaction: (_mode: string, _table: unknown, work: () => Promise<void>) => work() } }));

const createFileLike = (content: string, name: string, type = ''): File => {
    const blob = new Blob([content], { type }) as File;
    Object.defineProperty(blob, 'name', { value: name });
    Object.defineProperty(blob, 'lastModified', { value: Date.now() });
    return blob;
};

describe('customLyricsFont', () => {
    // The rejection message comes back through i18n, and i18next detects the language from the
    // environment - under vitest that is the *developer machine's* `navigator.language`. Asserting
    // an English sentence without pinning the language made this file pass or fail depending on
    // whose laptop it ran on.
    const originalLanguage = i18n.language;

    beforeAll(async () => {
        await i18n.changeLanguage('en');
    });

    afterAll(async () => {
        await i18n.changeLanguage(originalLanguage);
    });

    const getFromCacheMock = vi.mocked(getFromCache);
    const saveToCacheMock = vi.mocked(putCacheEntry);
    const removeFromCacheMock = vi.mocked(removeFromCache);
    const originalFontFace = globalThis.FontFace;
    const originalDocument = globalThis.document;
    let addFontFace: ReturnType<typeof vi.fn>;
    let loadFontFace: ReturnType<typeof vi.fn>;
    let deleteFontFace: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-05-24T00:00:00.000Z'));
        getFromCacheMock.mockReset();
        saveToCacheMock.mockReset();
        removeFromCacheMock.mockReset();
        addFontFace = vi.fn();
        deleteFontFace = vi.fn();
        loadFontFace = vi.fn().mockResolvedValue(undefined);

        class MockFontFace {
            family: string;
            source: BufferSource | string;

            constructor(family: string, source: BufferSource | string) {
                this.family = family;
                this.source = source;
            }

            load = loadFontFace;
        }

        vi.stubGlobal('FontFace', MockFontFace);
        vi.stubGlobal('document', {
            fonts: {
                add: addFontFace,
                delete: deleteFontFace,
            },
        });
    });

    afterEach(async () => {
        await clearUploadedLyricsFont();
        vi.useRealTimers();
        vi.stubGlobal('FontFace', originalFontFace);
        vi.stubGlobal('document', originalDocument);
    });

    it('accepts supported font extensions and rejects unsupported files', () => {
        expect(isSupportedLyricsFontFile(createFileLike('font', 'lyrics.woff2'))).toBe(true);
        expect(isSupportedLyricsFontFile(createFileLike('font', 'lyrics.ttf'))).toBe(true);
        expect(isSupportedLyricsFontFile(createFileLike('font', 'lyrics.png', 'image/png'))).toBe(false);
        expect(validateUploadedLyricsFontFile(createFileLike('font', 'lyrics.png', 'image/png'))).toBe('Only woff2, woff, ttf, otf font files are supported.');
    });

    it('registers a stored uploaded font with FontFace', async () => {
        const storedFont = buildStoredUploadedLyricsFont(createFileLike('font', 'My Font.ttf', 'font/ttf'));

        const meta = await registerUploadedLyricsFont(storedFont);

        expect(meta).toEqual({
            source: 'uploaded',
            family: storedFont.family,
            label: 'My Font',
            fontId: storedFont.id,
        });
        expect(loadFontFace).toHaveBeenCalledTimes(1);
        expect(addFontFace).toHaveBeenCalledTimes(1);
    });

    it('saves the uploaded font after successful registration', async () => {
        const file = createFileLike('font', 'Mobile.otf', 'font/otf');

        const result = await uploadAndRegisterLyricsFont(file);

        expect(result.meta.fontId).toMatch(/^1779580800000_Mobile_/);
        expect(saveToCacheMock).toHaveBeenCalledWith('lyrics_uploaded_font', expect.objectContaining({
            id: result.meta.fontId,
            name: 'Mobile.otf',
            label: 'Mobile',
            version: 2,
            data: expect.any(ArrayBuffer),
        }));
        expect(saveToCacheMock.mock.calls[0][1]).not.toHaveProperty('blob');
        expect(await result.storedFont.blob.text()).toBe('font');
    });

    it('restores a matching font from IndexedDB', async () => {
        const storedFont = buildStoredUploadedLyricsFont(createFileLike('font', 'Restore.woff', 'font/woff'));
        getFromCacheMock.mockResolvedValueOnce(storedFont);

        const restored = await restoreUploadedLyricsFont(storedFont.id);

        expect(getFromCacheMock).toHaveBeenCalledWith('lyrics_uploaded_font');
        expect(restored?.family).toBe(storedFont.family);
    });

    it('clears the persisted uploaded font', async () => {
        await clearUploadedLyricsFont();

        expect(removeFromCacheMock).toHaveBeenCalledWith('lyrics_uploaded_font');
    });

    it('restores byte records while rejecting corrupt and oversized payloads', async () => {
        const { blob, ...meta } = buildStoredUploadedLyricsFont(createFileLike('font', 'Bytes.ttf'));
        getFromCacheMock.mockResolvedValueOnce({ ...meta, version: 2, data: await blob.arrayBuffer() });
        expect(await (await getStoredUploadedLyricsFont())?.blob.text()).toBe('font');
        for (const data of [null, 'font', new ArrayBuffer(0), new ArrayBuffer(50 * 1024 * 1024 + 1)]) {
            getFromCacheMock.mockResolvedValueOnce({ ...meta, version: 2, data });
            expect(await getStoredUploadedLyricsFont()).toBeNull();
        }
    });

    it('keeps the previous registered font when a replacement cannot be saved', async () => {
        const previous = await uploadAndRegisterLyricsFont(createFileLike('font', 'Previous.ttf'));
        saveToCacheMock.mockRejectedValueOnce(new Error('quota-exceeded'));
        await expect(uploadAndRegisterLyricsFont(createFileLike('font', 'Failed.ttf'))).rejects.toThrow('quota-exceeded');
        expect(deleteFontFace).toHaveBeenCalledTimes(1);
        expect(deleteFontFace.mock.calls[0][0].family).not.toBe(previous.meta.family);
        await registerUploadedLyricsFont(previous.storedFont);
        expect(addFontFace).toHaveBeenCalledTimes(2);
    });

    it('rejects failed persistence without keeping the new font registered', async () => {
        saveToCacheMock.mockRejectedValueOnce(new Error('quota-exceeded'));
        await expect(uploadAndRegisterLyricsFont(createFileLike('font', 'Failed.ttf'))).rejects.toThrow('quota-exceeded');
        expect(deleteFontFace).toHaveBeenCalledTimes(1);
    });

    it('releases replaced and cleared FontFaces', async () => {
        await uploadAndRegisterLyricsFont(createFileLike('first', 'First.ttf'));
        await uploadAndRegisterLyricsFont(createFileLike('second', 'Second.ttf'));
        expect(deleteFontFace).toHaveBeenCalledTimes(1);
        await clearUploadedLyricsFont();
        expect(deleteFontFace).toHaveBeenCalledTimes(2);
    });

    it('gives repeated same-name uploads distinct font identities at the same timestamp', () => {
        const file = createFileLike('font', 'Same.ttf');
        expect(buildStoredUploadedLyricsFont(file).id).not.toBe(buildStoredUploadedLyricsFont(file).id);
    });

    it('keeps HTTP Web uploads usable when randomUUID is unavailable', () => {
        const cryptoApi = globalThis.crypto;
        vi.stubGlobal('crypto', {});
        try {
            expect(buildStoredUploadedLyricsFont(createFileLike('font', 'HTTP.ttf')).id).toMatch(/^1779580800000_HTTP_[a-z0-9]+$/);
        } finally { vi.stubGlobal('crypto', cryptoApi); }
    });

    it('does not resurrect an upload cleared during FontFace loading', async () => {
        let resolve!: () => void;
        loadFontFace.mockImplementationOnce(() => new Promise<void>(r => { resolve = r; }));
        const upload = uploadAndRegisterLyricsFont(createFileLike('font', 'Slow.ttf'));
        await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
        await clearUploadedLyricsFont(); resolve();
        await expect(upload).rejects.toThrow('font-operation-cancelled');
        expect(saveToCacheMock).not.toHaveBeenCalled();
        expect(addFontFace).not.toHaveBeenCalled();
    });

    it('distinguishes a superseded restore read from a missing stored font', async () => {
        const stored = buildStoredUploadedLyricsFont(createFileLike('old', 'Old.ttf'));
        let resolve!: (value: unknown) => void;
        getFromCacheMock.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
        const restoring = restoreUploadedLyricsFont(stored.id);
        await uploadAndRegisterLyricsFont(createFileLike('new', 'New.ttf'));
        resolve(stored);
        await expect(restoring).rejects.toBeInstanceOf(UploadedFontOperationCancelled);
        expect(addFontFace).toHaveBeenCalledTimes(1);
    });

    it('distinguishes a superseded restore load from a corrupt font', async () => {
        const stored = buildStoredUploadedLyricsFont(createFileLike('old', 'Old.ttf'));
        getFromCacheMock.mockResolvedValueOnce(stored);
        let resolve!: () => void;
        loadFontFace.mockImplementationOnce(() => new Promise<void>(r => { resolve = r; }));
        const restoring = restoreUploadedLyricsFont(stored.id);
        await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
        await uploadAndRegisterLyricsFont(createFileLike('new', 'New.ttf'));
        resolve();
        await expect(restoring).rejects.toBeInstanceOf(UploadedFontOperationCancelled);
        expect(addFontFace).toHaveBeenCalledTimes(1);
    });
});
