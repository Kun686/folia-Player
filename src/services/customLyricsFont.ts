import { getFromCache, removeFromCache } from './db';
import { getCacheTableName, putCacheEntry } from './repositories/cacheRepository';
import { appDatabase } from './appDatabase';
import i18n from '../i18n/config';
import type { StoredCustomLyricsFont } from '../types';

// src/services/customLyricsFont.ts
// Persists and registers the mobile uploaded lyrics font fallback.
const UPLOADED_LYRICS_FONT_KEY = 'lyrics_uploaded_font';
const UPLOADED_FONT_FAMILY_PREFIX = 'FoliaUploadedLyricsFont';
const MAX_UPLOADED_LYRICS_FONT_SIZE = 50 * 1024 * 1024;
const SUPPORTED_FONT_EXTENSIONS = ['.woff2', '.woff', '.ttf', '.otf'];
const SUPPORTED_FONT_MIME_TYPES = new Set([
    'font/woff2',
    'font/woff',
    'font/ttf',
    'font/otf',
    'application/font-woff',
    'application/font-woff2',
    'application/x-font-ttf',
    'application/x-font-otf',
    'application/vnd.ms-opentype',
]);

export interface StoredUploadedLyricsFont {
    id: string;
    name: string;
    mimeType: string;
    blob: Blob;
    family: string;
    label: string;
    createdAt: number;
}

export interface UploadLyricsFontResult {
    meta: StoredCustomLyricsFont;
    storedFont: StoredUploadedLyricsFont;
}

type PersistedUploadedLyricsFont = Omit<StoredUploadedLyricsFont, 'blob'> & {
    version: 2;
    data: ArrayBuffer;
};

const registeredUploadedFontFaces = new Map<string, FontFace>();
let fontGeneration = 0;

export class UploadedFontOperationCancelled extends Error {
    constructor() { super('font-operation-cancelled'); this.name = 'UploadedFontOperationCancelled'; }
}

const unregisterUploadedFont = (id: string) => {
    const face = registeredUploadedFontFaces.get(id);
    if (face) getDocumentFonts()?.delete(face);
    registeredUploadedFontFaces.delete(id);
};

const sanitizeUploadedFontId = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, '_');

const stripFontExtension = (name: string) => {
    const trimmed = name.trim();
    const matchedExtension = SUPPORTED_FONT_EXTENSIONS.find(extension => trimmed.toLowerCase().endsWith(extension));
    if (!matchedExtension) {
        return trimmed || 'Uploaded Font';
    }

    return trimmed.slice(0, -matchedExtension.length) || 'Uploaded Font';
};

const buildUploadedFontFamily = (id: string) => `${UPLOADED_FONT_FAMILY_PREFIX}_${sanitizeUploadedFontId(id)}`;

const buildUploadedFontId = (file: File) => {
    const baseName = stripFontExtension(file.name).replace(/\s+/g, '-').replace(/[^a-zA-Z0-9_-]/g, '_');
    // HTTP Web deployments may lack randomUUID; font identity does not require a secret token.
    const suffix = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
    return `${Date.now()}_${baseName || 'font'}_${suffix}`;
};

const getFontFaceConstructor = () => (globalThis as typeof globalThis & {
    FontFace?: new (family: string, source: BufferSource | string) => FontFace;
}).FontFace;

const getDocumentFonts = () => {
    if (typeof document === 'undefined' || !document.fonts?.add) {
        return null;
    }

    return document.fonts;
};

export const isSupportedLyricsFontFile = (file: File) => {
    const lowerName = file.name.toLowerCase();
    const hasSupportedExtension = SUPPORTED_FONT_EXTENSIONS.some(extension => lowerName.endsWith(extension));

    return hasSupportedExtension || SUPPORTED_FONT_MIME_TYPES.has(file.type);
};

export const validateUploadedLyricsFontFile = (file: File): string | null => {
    if (!isSupportedLyricsFontFile(file)) {
        return i18n.t('ui.unsupportedFontFormat');
    }

    if (file.size > MAX_UPLOADED_LYRICS_FONT_SIZE) {
        return 'Font file must not exceed 50MB.';
    }

    return null;
};

export const buildStoredUploadedLyricsFont = (file: File): StoredUploadedLyricsFont => {
    const id = buildUploadedFontId(file);

    return {
        id,
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        blob: file,
        family: buildUploadedFontFamily(id),
        label: stripFontExtension(file.name),
        createdAt: Date.now(),
    };
};

export const registerUploadedLyricsFont = async (storedFont: StoredUploadedLyricsFont): Promise<StoredCustomLyricsFont> => {
    if (registeredUploadedFontFaces.has(storedFont.id)) {
        return {
            source: 'uploaded',
            family: storedFont.family,
            label: storedFont.label,
            fontId: storedFont.id,
        };
    }

    const FontFaceConstructor = getFontFaceConstructor();
    const documentFonts = getDocumentFonts();

    if (!FontFaceConstructor || !documentFonts) {
        throw new Error('This browser does not support loading uploaded fonts.');
    }

    const generation = fontGeneration;
    const fontData = await storedFont.blob.arrayBuffer();
    const fontFace = new FontFaceConstructor(storedFont.family, fontData);
    await fontFace.load();
    if (generation !== fontGeneration) throw new UploadedFontOperationCancelled();
    if (!registeredUploadedFontFaces.has(storedFont.id)) {
        documentFonts.add(fontFace);
        registeredUploadedFontFaces.set(storedFont.id, fontFace);
    }

    return {
        source: 'uploaded',
        family: storedFont.family,
        label: storedFont.label,
        fontId: storedFont.id,
    };
};

export const uploadAndRegisterLyricsFont = async (file: File): Promise<UploadLyricsFontResult> => {
    const validationError = validateUploadedLyricsFontFile(file);
    if (validationError) {
        throw new Error(validationError);
    }

    const storedFont = buildStoredUploadedLyricsFont(file);
    const generation = ++fontGeneration;
    // WebKit can reject IndexedDB Blob/File writes even after copying a picker-backed File.
    // Store owned bytes; keep the Blob-facing loader/API and old persisted records compatible.
    const data = await file.arrayBuffer();
    storedFont.blob = new Blob([data], { type: storedFont.mimeType });
    if (generation !== fontGeneration) throw new UploadedFontOperationCancelled();
    const meta = await registerUploadedLyricsFont(storedFont);
    try {
        // A user font is durable state, not a best-effort cache: failed writes must not report success.
        const { blob: _blob, ...metadata } = storedFont;
        const persisted: PersistedUploadedLyricsFont = { ...metadata, version: 2, data };
        // Abort the write if clear/replacement wins while it is pending, preserving the previous record.
        await appDatabase.transaction('rw', appDatabase.table(getCacheTableName(UPLOADED_LYRICS_FONT_KEY)), async () => {
            if (generation !== fontGeneration) throw new UploadedFontOperationCancelled();
            await putCacheEntry(UPLOADED_LYRICS_FONT_KEY, persisted);
            if (generation !== fontGeneration) throw new UploadedFontOperationCancelled();
        });
        if (generation !== fontGeneration) throw new UploadedFontOperationCancelled();
    } catch (error) {
        unregisterUploadedFont(storedFont.id);
        throw error;
    }
    for (const id of registeredUploadedFontFaces.keys()) if (id !== storedFont.id) unregisterUploadedFont(id);

    return { meta, storedFont };
};

export const getStoredUploadedLyricsFont = async (): Promise<StoredUploadedLyricsFont | null> => {
    const stored = await getFromCache<StoredUploadedLyricsFont | PersistedUploadedLyricsFont>(UPLOADED_LYRICS_FONT_KEY);

    if (!stored || typeof stored.id !== 'string' || !stored.id || typeof stored.family !== 'string'
        || !stored.family || typeof stored.label !== 'string' || !stored.label) {
        return null;
    }
    if ('version' in stored) {
        if (stored.version !== 2 || !(stored.data instanceof ArrayBuffer) || stored.data.byteLength === 0
            || stored.data.byteLength > MAX_UPLOADED_LYRICS_FONT_SIZE) return null;
        const { version: _version, data, ...metadata } = stored;
        return { ...metadata, blob: new Blob([data], { type: typeof stored.mimeType === 'string' ? stored.mimeType : '' }) };
    }
    return stored.blob instanceof Blob && stored.blob.size > 0 && stored.blob.size <= MAX_UPLOADED_LYRICS_FONT_SIZE ? stored : null;
};

export const restoreUploadedLyricsFont = async (fontId: string): Promise<StoredCustomLyricsFont | null> => {
    const generation = fontGeneration;
    const storedFont = await getStoredUploadedLyricsFont();
    if (generation !== fontGeneration) throw new UploadedFontOperationCancelled();
    if (!storedFont || storedFont.id !== fontId) {
        return null;
    }

    return registerUploadedLyricsFont(storedFont);
};

export const clearUploadedLyricsFont = async (): Promise<void> => {
    fontGeneration++;
    for (const id of registeredUploadedFontFaces.keys()) unregisterUploadedFont(id);
    await removeFromCache(UPLOADED_LYRICS_FONT_KEY);
};

export { MAX_UPLOADED_LYRICS_FONT_SIZE, UPLOADED_LYRICS_FONT_KEY };
