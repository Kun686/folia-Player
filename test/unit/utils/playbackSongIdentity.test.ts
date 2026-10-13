import { describe, expect, it } from 'vitest';
import type { SongResult } from '@/types';
import type { NavidromeSong } from '@/types/navidrome';
import { buildNavidromeQueue, buildUnifiedNavidromeSong } from '@/services/playbackAdapters';
import {
    getPlaybackSongKey,
    hasMixedPlaybackSources,
    isSamePlaybackSong,
    replacePlaybackSongInQueue,
} from '@/utils/appPlaybackGuards';

// test/unit/utils/playbackSongIdentity.test.ts

const neteaseSong = (id: number, name = 'NetEase'): SongResult => ({
    id,
    name,
    artists: [],
    album: { id: 1, name: 'Album' },
    durationMs: 1000,
    sourceRef: { kind: 'online', providerId: 'netease', mediaId: String(id) },
});

const kugouSong = (hash: string, id = -1): SongResult => ({
    ...neteaseSong(id, 'Kugou'),
    id: hash,
    sourceRef: { kind: 'online', providerId: 'kugou', mediaId: hash, providerData: { hash } },
});

const localSong = (songId: string, id = -1, name = 'Local'): SongResult => ({
    ...neteaseSong(id, name),
    isLocal: true,
    localRef: { songId },
    sourceRef: { kind: 'local', mediaId: songId },
} as SongResult);

const navidromeSong = (songId: string, id = -1, name = 'Navidrome'): SongResult => ({
    ...neteaseSong(id, name),
    isNavidrome: true,
    navidromeData: {
        id: songId,
        streamUrl: `https://example.com/${songId}`,
        albumId: 'album-1',
        artistId: 'artist-1',
        path: `${songId}.flac`,
        suffix: 'flac',
    },
    sourceRef: { kind: 'navidrome', mediaId: songId },
} as SongResult);

describe('playback song identity', () => {
    it('distinguishes Navidrome servers/accounts while preserving unscoped desktop keys', () => {
        const legacy = navidromeSong('same-id');
        const first = { ...legacy, sourceRef: { kind: 'navidrome' as const, mediaId: 'same-id', scope: 'account-a' } };
        const second = { ...legacy, sourceRef: { kind: 'navidrome' as const, mediaId: 'same-id', scope: 'account-b' } };
        expect(new Set([legacy, first, second].map(getPlaybackSongKey)).size).toBe(3);
        expect(getPlaybackSongKey(legacy)).toBe('navidrome:same-id');
        expect(isSamePlaybackSong(first, second)).toBe(false);
        const colon = navidromeSong('account-a:same-id');
        expect(isSamePlaybackSong(first, colon)).toBe(false);
        expect(getPlaybackSongKey(buildUnifiedNavidromeSong(first as NavidromeSong))).toBe(getPlaybackSongKey(first));
        const wrapped = buildUnifiedNavidromeSong(first as NavidromeSong);
        delete wrapped.sourceRef;
        expect(getPlaybackSongKey(wrapped)).toBe(getPlaybackSongKey(first));
    });
    it('does not keep another server song merely because generated numeric ids match', () => {
        const before = { ...navidromeSong('same-id'), sourceRef: { kind: 'navidrome' as const, mediaId: 'same-id', scope: 'before' } };
        const after = { ...navidromeSong('same-id'), sourceRef: { kind: 'navidrome' as const, mediaId: 'same-id', scope: 'after' } };
        const queue = buildNavidromeQueue([after as NavidromeSong], before);
        expect(queue[0]).not.toBe(before); expect(getPlaybackSongKey(queue[0])).toBe(getPlaybackSongKey(after));
        expect(buildNavidromeQueue([before as NavidromeSong], before)[0]).toBe(before);
    });
    it('keeps distinct media ids in the same server when their generated numbers collide', () => {
        const current = navidromeSong('abc123', -123), other = navidromeSong('def123', -123);
        expect(getPlaybackSongKey(buildNavidromeQueue([other as NavidromeSong], current)[0])).toBe('navidrome:def123');
    });
    it('keeps equal numeric ids distinct across playback sources', () => {
        const netease = neteaseSong(-1);
        const kugou = kugouSong('-1');
        const local = localSong('local-1');
        const navidrome = navidromeSong('navi-1');

        expect(new Set([
            getPlaybackSongKey(netease),
            getPlaybackSongKey(kugou),
            getPlaybackSongKey(local),
            getPlaybackSongKey(navidrome),
        ]).size).toBe(4);
        expect(isSamePlaybackSong(local, navidrome)).toBe(false);
    });

    it('uses stable source ids instead of generated numeric ids', () => {
        expect(getPlaybackSongKey(localSong('local-stable', -123))).toBe('local:local-stable');
        expect(getPlaybackSongKey(navidromeSong('navi-stable', -123))).toBe('navidrome:navi-stable');
        expect(getPlaybackSongKey(kugouSong('ABCDEF'))).toBe('online:kugou:ABCDEF');
    });

    it('replaces the loaded song without discarding other queue sources', () => {
        const local = localSong('local-1', -1, 'Before');
        const queue = [neteaseSong(1), local, navidromeSong('navi-1')];
        const replacement = localSong('local-1', -99, 'After');

        const nextQueue = replacePlaybackSongInQueue(queue, replacement);

        expect(nextQueue.map(getPlaybackSongKey)).toEqual([
            'online:netease:1',
            'local:local-1',
            'navidrome:navi-1',
        ]);
        expect(nextQueue[1].name).toBe('After');
        expect(hasMixedPlaybackSources(nextQueue)).toBe(true);
    });
});
