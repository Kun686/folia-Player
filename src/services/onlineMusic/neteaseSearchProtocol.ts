import { OnlineProviderError } from '../../types/onlineMusic';
import type { UnifiedSong } from '../../types';

// neteaseSearchProtocol.ts — original search envelope and pagination validation with shared normalization.
// Catalog errors must not become successful empty pages and poison collection caches.
export function requireCatalogResponse(response: any, validPayload: boolean): void {
    const code = Number(response?.code);
    if ([301, 401, 403].includes(code)) {
        throw new OnlineProviderError('auth-required', 'NetEase catalog requires sign-in', 'netease');
    }
    if (code !== 200 || !validPayload) {
        throw new OnlineProviderError('unavailable', 'NetEase catalog response is unavailable', 'netease');
    }
}

export function neteaseSearchPage(response: any, offset: number, normalizeNeteaseSong: (raw: unknown) => UnifiedSong) {
            const result = response?.result;
            requireCatalogResponse(response, Array.isArray(result?.songs) || (result?.songs === undefined && result?.songCount === 0));
            const items = (result.songs ?? []).map(normalizeNeteaseSong);
            const count = result.songCount;
            const total = count === undefined ? offset + items.length : Number(count);
            requireCatalogResponse(response, (count === undefined || (typeof count === 'number' || typeof count === 'string') && String(count).trim() !== '')
                && Number.isSafeInteger(total) && total >= items.length && total >= 0);
            return { items, total, hasMore: offset + items.length < total, nextOffset: offset + items.length };
}
