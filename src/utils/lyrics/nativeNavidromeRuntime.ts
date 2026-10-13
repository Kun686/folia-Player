import { Buffer } from 'buffer';
import type { NavidromeSong, StructuredLyric } from '../../types/navidrome';
import { hydrateNavidromeLyricPayload, resolvePreferredNavidromeLyrics } from './navidromePayload';
import { parseNavidromeLyrics } from './adapters/navidromeParsing';
import { parseLyricsByFormat } from './parserCore';
import { resolveLyricProcessingOptions } from './filtering';
import { onlineLyricResult } from './nativeCacheRuntime';

// nativeNavidromeRuntime.ts — replay at most two original Subsonic reads; no credentials or replacement parser.
type Request = { operation: 'getLyricsBySongId' | 'getLyrics'; parameters: Record<string, string> };
class PendingRead { constructor(readonly request: Request) {} }
export function navidromeStepJSON(text: string, done: (value: string) => void): void {
  void (async () => {
    if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > 8_000_000) throw new Error();
    const input = JSON.parse(text), ref = input?.song?.sourceRef;
    if (input.version !== 1 || ref?.kind !== 'navidrome' || typeof ref.mediaId !== 'string' || !ref.mediaId
      || !Array.isArray(input.responses) || input.responses.length > 2) throw new Error();
    let index = 0;
    const read = async (request: Request) => {
      const reply = input.responses[index++];
      if (reply === undefined) throw new PendingRead(request);
      if (reply.operation !== request.operation || !reply.parameters || Object.keys(reply.parameters).length !== Object.keys(request.parameters).length
        || Object.entries(request.parameters).some(([key, value]) => reply.parameters[key] !== value)) throw new Error();
      return reply.response?.['subsonic-response'] ?? null;
    };
    const song: NavidromeSong = { ...input.song, navidromeData: { id: ref.mediaId, streamUrl: '' } };
    await hydrateNavidromeLyricPayload(null, song, {
      getLyricsBySongId: async (_, id) => (await read({ operation: 'getLyricsBySongId', parameters: { id, enhanced: 'true' } }))
        ?.lyricsList?.structuredLyrics as StructuredLyric[] | null ?? null,
      getLyrics: async (_, artist, title) => (await read({ operation: 'getLyrics', parameters: { artist, title } }))?.lyrics?.value ?? null,
    });
    if (index !== input.responses.length) throw new Error();
    done(onlineLyricResult(await resolvePreferredNavidromeLyrics(song, source => parseNavidromeLyrics(source, resolveLyricProcessingOptions(), async (...args) => parseLyricsByFormat(...args))), true));
  })().catch(error => done(JSON.stringify(error instanceof PendingRead ? { request: error.request } : { error: 'invalid-navidrome-lyrics' })));
}
