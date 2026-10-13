import { Buffer } from 'buffer';
import { parseQQLyricText } from '../../utils/lyrics/providers/qqLyricProtocol';
import { qrcDecryptBytes } from '../../utils/lyrics/providers/qrcDecrypt';
import type { NeteaseChorusRange } from '../../utils/lyrics/chorusEffects';

// nativeQqLyrics.ts — the existing native QRC decoder shared by own-provider and best-match loading.
function fail(code = 'invalid-lyric-response'): never { throw new Error(code); }
export function parseNativeQQLyrics(raw: any, inflate: (base64: string) => string | null,
    options: { chorusRanges?: NeteaseChorusRange[] } = {}) {
    if (raw.code !== 0 || raw.request?.code !== 0) fail('lyric-unavailable');
    const data = raw.request.data;
    if (!data?.lyric) return null;
    const decrypt = (value: unknown) => {
        if (!value) return '';
        if (typeof value !== 'string' || value.length > 2_000_000 || !/^(?:[a-fA-F0-9]{2})+$/.test(value)) fail();
        const result = inflate(Buffer.from(qrcDecryptBytes(value as string)).toString('base64'));
        if (typeof result !== 'string' || result.length > 2_000_000) fail();
        return result;
    };
    return parseQQLyricText(decrypt(data.lyric), decrypt(data.trans), decrypt(data.roma), options);
}
