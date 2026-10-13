import { describe, it, expect } from 'vitest';
import { inflateSync } from 'node:zlib';
import { createJobJSON } from '@/services/onlineMusic/nativeLyricMatchRuntime';
import { lyricQuery, type LyricEvent, type LyricReply, type LyricRequest } from '@/services/onlineMusic/nativeLyricRequests';
import { kugouSessionCookie } from '@/services/onlineMusic/kugouSearchProtocol';
import references from '../../../ios/App/NativeTests/OnlineLyricReference.json';

// nativeLyricMatch.test.ts — controlled raw provider replies, original parsing, event deadlines and isolated jobs.
const input = { version: 1, title: '合成测试', artist: '测试', durationMs: 30000, options: { album: '测试专辑', preferredSource: 'qq' } };
const inflate = (value: string) => inflateSync(Buffer.from(value, 'base64')).toString('utf8');
const json = (body: unknown): LyricReply => ({ status: 200, body: JSON.stringify(body) });
const qqSongs = json({ code: 0, request: { code: 0, data: { body: { item_song: [
    { id: 42, mid: 'mid42', title: input.title, singer: [{ id: 1, name: input.artist }], album: { id: 2, name: input.options.album }, interval: 30 },
] } } } });
const ncmSongs = json({ code: 200, result: { songCount: 1, songs: [
    { id: 42, name: input.title, ar: [{ id: 1, name: input.artist }], al: { id: 2, name: input.options.album }, dt: 30000 },
] } });
const kgSongs = json({ data: { total: 1, lists: [{ FileHash: 'ABC123', SongName: input.title, SingerName: input.artist,
    AlbumName: input.options.album, Duration: 30, album_audio_id: 76 }] } });
const rawFixture = (name: string) => references.find(row => row.name === name)!.steps.at(-1)!.input.responses.at(-1)!;
const flush = async () => { for (let step = 0; step < 32; step++) await Promise.resolve(); };
function job(options = {}) { return createJobJSON(JSON.stringify({ ...input, ...options }), inflate); }
async function drive(instance: ReturnType<typeof job>, reply: (request: LyricRequest) => LyricReply, clock?: number) {
    const calls: LyricRequest[] = [], timers = new Map<number, number>(), cancelled: number[] = [];
    for (let step = 0; step < 128; step++) {
        await flush();
        const state = JSON.parse(instance.stateJSON());
        for (const event of state.events as LyricEvent[]) {
            if (event.kind === 'cancel') { timers.delete(event.id); cancelled.push(event.id); }
            if (event.kind === 'timer') timers.set(event.id, event.milliseconds);
            if (event.kind === 'request') { calls.push(event.request); instance.replyJSON(JSON.stringify({ id: event.id, reply: reply(event.request) })); }
        }
        if (state.done) return { ...state, calls, cancelled };
        if (clock !== undefined) for (const [id, milliseconds] of timers) if (milliseconds === clock) {
            timers.delete(id); instance.replyJSON(JSON.stringify({ id, reply: { status: 200, body: '' } }));
        }
    }
    throw new Error('job did not finish');
}
const sessions = { netease: { cookie: 'ncm-test-cookie' }, qq: { cookie: 'qq-test-cookie' },
    kugou: { token: 'kg-test-token', userid: '123', dfid: 'test-device' } };

describe('native original lyric matcher', () => {
    it('executes QQ raw search and real QRC decoding without sending account credentials', async () => {
        const result = await drive(job({ sessions }), request => {
            expect(request.provider).toBe('lyrics');
            expect(JSON.stringify(request)).not.toContain('test-cookie');
            expect(request.headers?.Cookie).toBe('tmeLoginType=-1;');
            const payload = JSON.parse(request.body!);
            return payload.request.method === 'DoSearchForQQMusicLite' ? qqSongs : rawFixture('qq-qrc');
        });
        expect(result.result.source).toBe('qq');
        expect(result.result.lyrics.isWordByWord).toBe(true);
        expect(result.result.lyrics.lines.at(-1).endTime).toBe(26);
        expect(result.calls).toHaveLength(2);
    });
    it('executes NetEase search, YRC normalization and chorus through the original helpers', async () => {
        const result = await drive(job({ sessions, options: { ...input.options, preferredSource: 'netease' } }), request => {
            expect(request.provider).toBe('netease');
            expect(request.query?.cookie).toBe('ncm-test-cookie');
            if (request.path === '/cloudsearch') return ncmSongs;
            if (request.path === '/lyric/new') return rawFixture('netease-yrc');
            expect(request.path).toBe('/song/chorus');
            return json({ code: 200, chorus: [{ startTime: 2000, endTime: 27000 }] });
        });
        expect(result.result.source).toBe('netease');
        expect(result.result.lyrics.isWordByWord).toBe(true);
        expect(result.result.lyrics.lines.some((line: any) => line.isChorus)).toBe(true);
        expect(result.calls).toHaveLength(3);
    });
    it('executes authenticated KuGou search, original lyric candidate, KRC and climax flow', async () => {
        const result = await drive(job({ sessions, options: { ...input.options, preferredSource: 'kugou' } }), request => {
            expect(request.provider).toBe('kugou');
            expect(request.query?.cookie).toBe('dfid=test-device;token=kg-test-token;userid=123');
            if (request.path === '/search') return kgSongs;
            if (request.path === '/search/lyric') {
                expect(request.query).toMatchObject({ hash: 'ABC123', duration: 30000, man: 'no', album_audio_id: '76' });
                return json({ candidates: [{ id: 1, accesskey: 'fixture-key' }] });
            }
            if (request.path === '/lyric') return json({ decodeContent: '[1000,3000]<0,1000,0>合成<1000,2000,0>歌词' });
            expect(request.path).toBe('/song/climax');
            return json({ data: [] });
        });
        expect(result.result.source).toBe('kugou');
        expect(result.result.lyrics.lines[0].fullText).toBe('合成歌词');
        expect(result.calls).toHaveLength(4);
    });
    it('retains anonymous KuGou signing, identity normalization and no private session', async () => {
        const result = await drive(job({ options: { ...input.options, preferredSource: 'kugou' } }), request => {
            if (request.provider === 'lyrics') {
                const url = new URL(request.path);
                expect(url.hostname).toBe('complexsearch.kugou.com');
                expect(url.searchParams.get('signature')).toMatch(/^[a-f0-9]{32}$/);
                expect(url.searchParams.get('userid')).toBe('0');
                expect(request.headers).not.toHaveProperty('Cookie');
                return kgSongs;
            }
            if (request.path === '/search/lyric') return json({ candidates: [{ id: 1, accesskey: 'fixture' }] });
            return request.path === '/lyric' ? json({ decodeContent: '[1000,3000]<0,3000,0>歌词' }) : json({ data: [] });
        });
        expect(result.result.kgHash).toBe('ABC123');
    });
    it('fetches original AMLL TTML with no platform cookie and decorates NetEase chorus', async () => {
        const result = await drive(job({ sessions, options: { ...input.options, preferredSource: 'amll' } }), request => {
            if (request.path === '/cloudsearch') return ncmSongs;
            if (request.provider === 'amll') {
                expect(request).toEqual({ provider: 'amll', path: 'https://api.amll.dev/v1/lyrics/get?ncmMusicId=42' });
                return json({ status: 200, data: { lyrics: '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" itunes:timing="Word"><body><div><p itunes:key="L1" begin="1s" end="3s"><span begin="1s" end="3s">歌词</span></p></div></body></tt>' } });
            }
            return json({ code: 200, chorus: [] });
        });
        expect(result.result.source).toBe('amll');
        expect(result.result.matchedLyricsProviderPlatform).toBe('ncm');
        expect(result.calls).toHaveLength(3);
    });
    it('preserves pure-music short circuit and avoids other sources', async () => {
        const result = await drive(job({ options: { preferredSource: 'netease' } }), request =>
            request.path === '/cloudsearch' ? ncmSongs : request.path === '/lyric/new' ? rawFixture('netease-pure') : json({ code: 200, chorus: [] }));
        expect(result.result.isPureMusic).toBe(true);
        expect(result.calls.every((request: LyricRequest) => request.provider === 'netease')).toBe(true);
    });
    it('cancels outstanding raw requests at the 3500ms search deadline and ignores late replies', async () => {
        const instance = job();
        await flush();
        const initial = JSON.parse(instance.stateJSON()).events as LyricEvent[];
        const request = initial.find(event => event.kind === 'request')!;
        for (const event of initial) if (event.kind === 'timer') {
            expect(event.milliseconds).toBe(3500);
            instance.replyJSON(JSON.stringify({ id: event.id, reply: { status: 200, body: '' } }));
        }
        await flush();
        const state = JSON.parse(instance.stateJSON());
        expect(state.events).toContainEqual({ kind: 'cancel', id: request.id });
        instance.replyJSON(JSON.stringify({ id: request.id, reply: qqSongs }));
        instance.cancel(); await flush();
        expect(JSON.parse(instance.stateJSON())).toMatchObject({ done: true, error: 'cancelled', result: null });
    });
    it('keeps concurrent jobs isolated when one is cancelled', async () => {
        const first = job(), second = job();
        first.cancel();
        const result = await drive(second, request => JSON.parse(request.body!).request.method === 'DoSearchForQQMusicLite' ? qqSongs : rawFixture('qq-qrc'));
        expect(result.result.source).toBe('qq');
        expect(JSON.parse(first.stateJSON())).toMatchObject({ error: 'cancelled', result: null });
    });
    it('rejects unbounded inputs/sessions and keeps original cookie precedence', () => {
        expect(() => job({ title: 'a'.repeat(1025) })).toThrow('invalid-lyric-job');
        expect(() => job({ sessions: { qq: { cookie: 'a'.repeat(24001) } } })).toThrow('invalid-session');
        expect(() => job({ sessions: { unknown: {} } })).toThrow('invalid-session');
        expect(kugouSessionCookie({ cookie: 'token=old;userid=12;dfid=old', token: 'new' })).toBe('token=new;userid=12;dfid=old');
        for (const value of ['中文 空格&+~!*\'()', 'a/b?=é', '🎵']) expect(lyricQuery({ q: value })).toBe(new URLSearchParams({ q: value }).toString());
    });
});
