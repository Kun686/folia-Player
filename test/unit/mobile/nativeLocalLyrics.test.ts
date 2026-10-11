import { describe, expect, it, vi } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseJSON } from '@/utils/lyrics/nativeLocalRuntime';
import { parseLyricsByFormat } from '@/utils/lyrics/parserCore';
import { LocalFileLyricAdapter } from '@/utils/lyrics/adapters/LocalFileLyricAdapter';
import { planForMode } from '@/services/automix/transitionStrategy';
import { buildFoliaLyricDocument, serializeFoliaLyricDocument } from '@/utils/lyrics/foliaLyricDocument';
import { makeProfile } from '../automix/trackProfileFixture';
import { resolveExplicitFileTimedLyricFormat } from '@/utils/lyrics/formatDetection';

// Compare the native boundary to the original frontend adapter using its real parser, not fake lyric timing.
vi.mock('@/utils/lyrics/workerClient', async () => {
  const { parseLyricsByFormat } = await import('@/utils/lyrics/parserCore');
  return { parseLyricsAsync: (...args: Parameters<typeof parseLyricsByFormat>) => Promise.resolve(parseLyricsByFormat(...args)) };
});
const fixture = new URL('../../../ios/App/NativeTests/LocalLyricReference.json', import.meta.url);
const cases = [
  ['lrc', '[00:04.00]测试歌词\n[00:16.00]Another line\n[00:20.00]'],
  ['enhanced', '[00:04.00]<00:04.00>你<00:05.00>好<00:06.00>\n[00:16.00]End'],
  ['yrc', '[4000,2000](4000,1000,0)你(5000,1000,0)好\n[16000,1000](16000,1000,0)End'],
  ['qrc', '[4000,2000]你(0,1000)好(1000,1000)\n[16000,1000]End(0,1000)'],
  ['krc', '[language:' + Buffer.from(JSON.stringify({ content: [{ type: 1, lyricContent: [['你好'], ['结束']] }] })).toString('base64') + ']\n[4000,2000]<0,1000,0>你<1000,1000,0>好\n[16000,1000]<0,1000,0>End'],
  ['vtt', 'WEBVTT\n\n00:00:04.000 --> 00:00:06.000\nHello\n\n00:00:16.000 --> 00:00:17.000\nEnd'],
  ['ttml', '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" itunes:timing="Word"><body><div><p itunes:key="L1" begin="4s" end="6s"><span begin="4s" end="5s">你</span><span begin="5s" end="6s">好</span></p><p itunes:key="L2" begin="16s" end="17s">End</p></div></body></tt>'],
  ['combined', '[00:04.00]君のことが好き\n[00:04.00]我喜欢你\n[00:04.00]Kimi no koto ga suki\n[00:16.00]End'],
  ['awlrc', '[00:00.00]Wrong fallback\n[awlrc:awlrc:' + Buffer.from('[00:04.000]<0,1000>你好\n[00:16.000]<0,1000>End').toString('base64') + ']'],
  ['fia', serializeFoliaLyricDocument(buildFoliaLyricDocument(parseLyricsByFormat('lrc', '[00:04.00]你好\n[00:16.00]End')!, { exportedAt: new Date('2026-10-11T00:00:00Z') }))],
  ['empty', ''], ['untimed', 'Only plain text'],
];

describe('native local lyrics', () => {
  it('matches original format handling and planning, including interludes and empty timelines', async () => {
    const adapter = new LocalFileLyricAdapter(), rows = [];
    for (const [name, content] of cases) {
      const fileName = `lyrics.${name}`;
      const original = await adapter.parse({ type: 'local', lrcContent: content, formatHint: resolveExplicitFileTimedLyricFormat(fileName) });
      const lines = JSON.parse(parseJSON(JSON.stringify({ version: 1, content, fileName })));
      const expected = original?.lines.map(({ startTime, endTime, fullText }) => ({ startTime, endTime, fullText, words: [] })) ?? null;
      expect(lines, name).toEqual(expected);
      if (!['empty', 'untimed'].includes(name)) expect(lines.length, name).toBeGreaterThan(0);
      for (const mode of ['automix', 'crossfade'] as const) {
        const settings = { mode, crossfadeMaxSec: 5, performance: false };
        const to = { duration: 30, lines: null, profile: makeProfile({ duration: 30 }) };
        const from = { duration: 30, profile: makeProfile({ duration: 30 }) };
        expect(planForMode(settings, { ...from, lines }, to, 120, 0), name)
          .toEqual(planForMode(settings, { ...from, lines: original?.lines ?? null }, to, 120, 0));
      }
      rows.push({ name, content, fileName, expected });
    }
    const fromProfile = makeProfile({ duration: 30, bodyOut: 10, gridless: true });
    const toProfile = makeProfile({ duration: 30, gridless: true });
    const content = '[1000,25000](1000,25000,0)唱到最后';
    const fileName = 'ending.YRC';
    const original = await adapter.parse({ type: 'local', lrcContent: content, formatHint: 'yrc' });
    const settings = { mode: 'automix' as const, crossfadeMaxSec: 5, performance: false };
    const from = { duration: 30, profile: fromProfile }, to = { duration: 30, profile: toProfile, lines: null };
    const baseline = planForMode(settings, { ...from, lines: null }, to, 120, 0);
    const delayed = planForMode(settings, { ...from, lines: original!.lines }, to, 120, 0);
    expect(baseline.kind).toBe('fade'); expect(delayed.kind).toBe('fade');
    expect(delayed.outStart).toBeGreaterThan(baseline.outStart + 2);
    expect(delayed.outStart).toBeGreaterThanOrEqual(26);
    const reference = { rows, queue: { fromProfile, toProfile, content, fileName, baseline, delayed } };
    if (process.env.FOLIA_LOCAL_LYRIC_REFERENCE === '1') writeFileSync(fixture, JSON.stringify(reference) + '\n');
    expect(JSON.parse(readFileSync(fixture, 'utf8'))).toEqual(reference);
  });

  it('bounds malformed input and can parse again after failure', () => {
    for (const request of [null, { version: 2, content: '' }, { version: 1, content: [] },
      { version: 1, content: 'a'.repeat(2_000_001) }, { version: 1, content: '', fileName: [] },
      { version: 1, content: '', fileName: 'a'.repeat(1025) }]) expect(() => parseJSON(JSON.stringify(request))).toThrow();
    expect(() => parseJSON('{')).toThrow();
    expect(JSON.parse(parseJSON(JSON.stringify({ version: 1, content: '[00:01.00]OK' }))))
      .toEqual([{ startTime: 1, endTime: 6, fullText: 'OK', words: [] }]);
  });
});
