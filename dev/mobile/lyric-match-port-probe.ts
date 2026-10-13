import { createAutoMatchBestLyric } from '../../src/utils/lyrics/autoMatchBestLyricCore';
import type { AutoMatchLyricPorts } from '../../src/utils/lyrics/autoMatchBestLyricTypes';
import type { LyricProviderSource, SongResult } from '../../src/types';
import { parseLyricsByFormat } from '../../src/utils/lyrics/parserCore';

// lyric-match-port-probe.ts — real portable policy/parser in bare JavaScriptCore, with explicit synthetic I/O.
const song = (id: string | number): SongResult => ({ id, name: 'Shared song',
  artists: [{ id: 1, name: 'Shared artist' }], album: { id: 2, name: 'Shared album' },
  durationMs: 180000, ...(typeof id === 'string' ? { qqMid: id, kgHash: id } : {}),
});

async function verify() {
  const globalsAbsent = ['window', 'document', 'fetch', 'setTimeout', 'localStorage', 'Worker']
    .every(name => typeof (globalThis as Record<string, unknown>)[name] === 'undefined');
  if (!globalsAbsent) throw new Error('probe-requires-bare-JavaScriptCore');
  const word = parseLyricsByFormat('yrc', '[1000,2000](1000,1000,0)Shared(2000,1000,0) lyric')!;
  const line = parseLyricsByFormat('lrc', '[00:01.00]Shared lyric\n[00:03.00]Next lyric')!;
  if (!word?.isWordByWord || !word.lines.length || !line?.lines.length) throw new Error('fixture-parser-failed');
  const cases = [];
  for (const preferredSource of ['qq', 'netease', 'amll', 'kugou'] as LyricProviderSource[]) {
    const calls: string[] = [], deadlines: number[] = [];
    const ports: AutoMatchLyricPorts = {
      searchSongs: async provider => { calls.push('search:' + provider); return { items: [song(provider === 'netease' ? 42 : 'HASH')], hasMore: false, nextOffset: 1 }; },
      getLyrics: async provider => { calls.push('lyrics:' + provider); return { lyrics: word, isPureMusic: false }; },
      getChorusRanges: async provider => { calls.push('chorus:' + provider); return []; },
      searchQQ: async () => { calls.push('search:qq'); return [song('mid42')]; },
      fetchQQ: async () => { calls.push('lyrics:qq'); return word; },
      fetchAmll: async () => { calls.push('lyrics:amll'); return word; },
      // Fixtures resolve immediately. Production hosts must enforce these deadlines and own cancellation.
      withTimeout: async <T,>(pending: Promise<T>, ms: number) => { deadlines.push(ms); return pending; },
    };
    const match = createAutoMatchBestLyric(ports);
    const result = await match('Shared song', 'Shared artist', 180000, { preferredSource });
    if (!result || !('lyrics' in result) || result.source !== preferredSource || !result.lyrics.isWordByWord) {
      throw new Error('source-policy-mismatch:' + preferredSource);
    }
    cases.push({ preferredSource, result, calls: [...calls], deadlines: [...deadlines] });
    // Reuse one host with a selected pure-music baseline; it must not retain the prior search state.
    calls.length = 0;
    const pure = await match('Shared song', 'Shared artist', 180000, {
      preferredSource: 'netease', providerCandidate: { providerId: 'netease', song: song(42),
        lyricsResult: { lyrics: null, isPureMusic: true } },
    });
    if (pure?.isPureMusic !== true || calls.length) throw new Error('baseline-state-leaked');
  }
  return { passed: true, globalsAbsent, cases };
}

export function run(complete: (text: string) => void) {
  void verify().then(result => complete(JSON.stringify(result)), error => complete(JSON.stringify({
    passed: false, error: error instanceof Error ? error.message : 'probe-failed',
  })));
}
