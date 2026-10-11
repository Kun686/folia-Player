import { selectEmbeddedLyrics, type ParsedLyricTag } from './embeddedMetadataSelection';
import { Buffer } from 'buffer';
import { decodeNativeSylt, parseMetadataLyricText } from './nativeMetadataDecoding';

// nativeEmbeddedRuntime.ts — bounded system metadata enters the original worker's selection rules.
export function embeddedTagsJSON(text: string): string {
    const invalid = () => { throw new Error('invalid-embedded-lyrics'); };
    if (typeof text !== 'string' || text.length > 24_300_000) invalid();
    const request = JSON.parse(text);
    if (request?.version !== 1 || !Array.isArray(request.tags) || request.tags.length > 64) invalid();
    let total = 0, commonPriority = Infinity;
    const common: ParsedLyricTag[] = [], native: ParsedLyricTag[] = [];
    for (const tag of request.tags) {
        if (!tag || typeof tag !== 'object' || Array.isArray(tag)
            || typeof tag.value !== 'string' || tag.value.length > 2_000_000) invalid();
        if (tag.representation !== undefined && !['text', 'lrc', 'sylt'].includes(tag.representation)) invalid();
        if (tag.fallback !== undefined && tag.fallback !== 'native') invalid();
        if (tag.tagFormat !== undefined && !['vorbis', 'id3', 'itunes'].includes(tag.tagFormat)) invalid();
        const size = tag.representation === 'sylt' ? Buffer.from(tag.value, 'base64').length : Buffer.byteLength(tag.value, 'utf8');
        if (size > 2_000_000) invalid();
        total += size;
        if (total > 4_000_000) invalid();
        for (const key of ['id', 'language', 'descriptor'] as const) {
            if (tag[key] !== undefined && (typeof tag[key] !== 'string' || Buffer.byteLength(tag[key], 'utf8') > 1024)) invalid();
        }
        let decoded: ParsedLyricTag = { value: tag.value, id: tag.id, language: tag.language, descriptor: tag.descriptor };
        if (tag.representation === 'sylt') decoded = { ...decodeNativeSylt(tag.value), id: tag.id };
        native.push(decoded);
        if (tag.fallback !== 'native') {
            // Preserve MetadataCollector's priority across the system tag formats supported here.
            const priority = ['vorbis', 'id3', 'itunes'].indexOf(tag.tagFormat ?? 'id3');
            if (priority < commonPriority) { common.length = 0; commonPriority = priority; }
            // music-metadata converts Vorbis/iTunes string tags to common lyrics before desktop selection.
            if (priority === commonPriority) common.push(tag.representation === 'lrc' ? { ...parseMetadataLyricText(tag.value), id: tag.id } : decoded);
        }
    }
    const result = selectEmbeddedLyrics(common, { native });
    if ([result.lyrics, result.translationLyrics].some(value => value && Buffer.byteLength(value, 'utf8') > 2_000_000)) invalid();
    return JSON.stringify(result);
}
