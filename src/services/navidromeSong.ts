import type { NavidromeSong, SubsonicSong } from '../types/navidrome';

// navidromeSong.ts — original display and playback metadata; callers own authenticated media access.
export function createNavidromeSong(song: SubsonicSong, streamUrl: string, coverArtUrl?: string): NavidromeSong {
        const displayArtists = [{ id: 0, name: song.artist }];
        const displayAlbum = {
            id: 0,
            name: song.album,
            coverUrl: coverArtUrl,
        };

        return {
            // Use negative ID to avoid conflicts with Netease IDs
            id: -Math.abs(parseInt(song.id.replace(/\D/g, ''), 10) || Date.now()),
            name: song.title,
            artists: displayArtists,
            album: displayAlbum,
            durationMs: song.duration * 1000, // Convert to milliseconds
            isNavidrome: true,
            sourceRef: { kind: 'navidrome', mediaId: song.id },
            navidromeData: {
                id: song.id,
                streamUrl,
                coverArtUrl,
                albumId: song.albumId,
                artistId: song.artistId,
                path: song.path,
                bitRate: song.bitRate,
                suffix: song.suffix,
                starred: song.starred,
                replayGain: song.replayGain,
            },
        };
}
