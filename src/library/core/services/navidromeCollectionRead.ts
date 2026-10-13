import type { SubsonicSong } from '../../../types/navidrome';
import type { NavidromeGridViewCollectionDescriptor } from '../contracts/collection';
import type { createNavidromeReadApi } from '../../../services/navidromeReadApi';

// navidromeCollectionRead.ts — original album/playlist/artist/random/favorites expansion with injectable transport.
export async function readNavidromeCollection<Config extends { username: string }>(
    config: Config, descriptor: Pick<NavidromeGridViewCollectionDescriptor, 'type' | 'id'>,
    api: Pick<ReturnType<typeof createNavidromeReadApi<Config>>, 'getAlbum' | 'getPlaylist' | 'getArtist' | 'getRandomSongs' | 'getStarred2'>,
    albumBatchSize = Infinity,
): Promise<SubsonicSong[]> {
    let subsonicSongs: SubsonicSong[] = [];

    if (descriptor.type === 'album') {
        const albumDetail = await api.getAlbum(config, descriptor.id);
        subsonicSongs = albumDetail?.song || [];
    } else if (descriptor.type === 'playlist') {
        const playlistDetail = await api.getPlaylist(config, descriptor.id);
        subsonicSongs = playlistDetail?.entry || [];
    } else if (descriptor.type === 'artist') {
        const artistDetail = await api.getArtist(config, descriptor.id);
        const albums = artistDetail?.album || [];
        const albumResults = [];
        // Native uses two reads at a time; desktop retains its original parallel read.
        const batchSize = Math.max(1, Math.floor(albumBatchSize));
        for (let offset = 0; offset < albums.length; offset += batchSize) {
            albumResults.push(...await Promise.all(albums.slice(offset, offset + batchSize).map(album => api.getAlbum(config, album.id))));
        }
        subsonicSongs = albumResults.flatMap(album => album?.song || []);
    } else if (descriptor.type === 'random') {
        subsonicSongs = await api.getRandomSongs(config, 100);
    } else if (descriptor.type === 'favorites') {
        subsonicSongs = await api.getStarred2(config);
    }

    return subsonicSongs;
}
