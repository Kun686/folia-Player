import { selectEmbeddedLyrics, type ParsedLyricTag } from './embeddedMetadataSelection';

// nativeEmbeddedRuntime.ts — bounded system metadata enters the original worker's selection rules.
export function embeddedTagsJSON(text: string): string {
    const invalid = () => { throw new Error('invalid-embedded-lyrics'); };
    if (typeof text !== 'string' || text.length > 24_300_000) invalid();
    const request = JSON.parse(text);
    if (request?.version !== 1 || !Array.isArray(request.tags) || request.tags.length > 64) invalid();
    let total = 0;
    const tags: ParsedLyricTag[] = request.tags.map((tag: ParsedLyricTag) => {
        if (!tag || typeof tag !== 'object' || Array.isArray(tag)
            || typeof tag.value !== 'string' || tag.value.length > 2_000_000) invalid();
        total += (tag.value as string).length;
        if (total > 4_000_000) invalid();
        for (const key of ['id', 'language', 'descriptor'] as const) {
            if (tag[key] !== undefined && (typeof tag[key] !== 'string' || tag[key]!.length > 1024)) invalid();
        }
        return { value: tag.value, id: tag.id, language: tag.language, descriptor: tag.descriptor };
    });
    return JSON.stringify(selectEmbeddedLyrics(tags));
}
