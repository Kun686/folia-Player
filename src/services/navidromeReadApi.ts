import type {
    SubsonicResponse, SubsonicAlbum, SubsonicArtist, SubsonicSong, SubsonicPlaylist, StructuredLyric,
    PingResponse, AlbumList2Response, AlbumResponse, ArtistResponse, ArtistsIndexResponse, SongResponse,
    PlaylistsResponse, PlaylistResponse, RandomSongsResponse, Starred2Response, LyricsResponse, LyricsBySongIdResponse,
    Search3Response, OpenSubsonicExtensionsResponse, UserResponse, MusicFoldersResponse, LicenseResponse,
    NavidromeCapabilities, NavidromeServerProfile, OpenSubsonicExtension, MusicFolder,
} from '../types/navidrome';

// navidromeReadApi.ts — original Subsonic parsing shared by desktop fetch and the credential-free native connection.
export type NavidromeReadOperation = 'ping' | 'getOpenSubsonicExtensions' | 'getUser' | 'getMusicFolders'
    | 'getLicense' | 'getAlbumList2' | 'getAlbum' | 'getPlaylists' | 'getPlaylist' | 'getRandomSongs'
    | 'getStarred2' | 'getArtists' | 'getArtist' | 'getSong' | 'getLyrics' | 'getLyricsBySongId' | 'search3';
export type NavidromeReadParameters = Record<string, string | number | boolean>;
export type NavidromeReadRequest<Config> = <T>(config: Config, operation: NavidromeReadOperation,
    parameters?: NavidromeReadParameters) => Promise<SubsonicResponse<T>>;
export type NavidromeReadErrorHandler = (operation: NavidromeReadOperation, error: unknown) => void;

const warnOperations = new Set<NavidromeReadOperation>(['getOpenSubsonicExtensions', 'getUser', 'getMusicFolders', 'getLicense', 'getSong']);
const reportDesktopError: NavidromeReadErrorHandler = (operation, error) => {
    const level = warnOperations.has(operation) ? 'warn' : 'error';
    console[level](`[Navidrome] ${operation === 'ping' ? 'Ping' : operation} failed:`, error);
};

const buildNavidromeCapabilities = (extensions: OpenSubsonicExtension[], openSubsonic: boolean): NavidromeCapabilities => {
    const extensionVersions = extensions.reduce<Record<string, number[]>>((acc, extension) => {
        acc[extension.name] = extension.versions || [];
        return acc;
    }, {});
    return {
        openSubsonic, extensionVersions,
        supportsApiKeyAuthentication: Boolean(extensionVersions.apiKeyAuthentication),
        supportsFormPost: Boolean(extensionVersions.formPost),
        supportsPlaybackReport: Boolean(extensionVersions.playbackReport),
        supportsSongLyrics: Boolean(extensionVersions.songLyrics),
        supportsTranscoding: Boolean(extensionVersions.transcoding),
    };
};

export function createNavidromeReadApi<Config extends { username: string }>(
    request: NavidromeReadRequest<Config>, onError: NavidromeReadErrorHandler = reportDesktopError,
) {
    // Desktop keeps its original empty/null fallback. Native callers throw a safe error from onError instead.
    async function read<Payload, Value>(config: Config, operation: NavidromeReadOperation, parameters: NavidromeReadParameters | undefined,
        select: (body: SubsonicResponse<Payload>['subsonic-response']) => Value, fallback: Value): Promise<Value> {
        try {
            const res = await request<Payload>(config, operation, parameters);
            if (res['subsonic-response'].status === 'ok') return select(res['subsonic-response']);
        } catch (error) { onError(operation, error); }
        return fallback;
    }
    const api = {
        // Test connection
        ping: (config: Config) => read<PingResponse, boolean>(config, 'ping', undefined, () => true, false),
        getOpenSubsonicExtensions: (config: Config) => read<OpenSubsonicExtensionsResponse, OpenSubsonicExtension[]>(
            config, 'getOpenSubsonicExtensions', undefined, body => body.openSubsonicExtensions || [], []),
        getUser: (config: Config) => read<UserResponse, NonNullable<UserResponse['user']> | null>(
            config, 'getUser', { username: config.username }, body => body.user || null, null),
        getMusicFolders: (config: Config) => read<MusicFoldersResponse, MusicFolder[]>(
            config, 'getMusicFolders', undefined, body => body.musicFolders?.musicFolder || [], []),
        getLicense: (config: Config) => read<LicenseResponse, NonNullable<LicenseResponse['license']> | null>(
            config, 'getLicense', undefined, body => body.license || null, null),
        getServerProfile: async (config: Config): Promise<NavidromeServerProfile> => {
            const [pingResult, extensions, user, musicFolders, license] = await Promise.all([
                request<PingResponse>(config, 'ping').catch(error => {
                    if (onError === reportDesktopError) console.warn('[Navidrome] profile ping failed:', error);
                    else onError('ping', error);
                    return null;
                }),
                api.getOpenSubsonicExtensions(config), api.getUser(config), api.getMusicFolders(config), api.getLicense(config),
            ]);
            const pingBody = pingResult?.['subsonic-response'];
            const openSubsonic = Boolean(pingBody?.openSubsonic || extensions.length > 0);
            return {
                fetchedAt: Date.now(), apiVersion: pingBody?.version, serverType: pingBody?.type, serverVersion: pingBody?.serverVersion,
                openSubsonic, openSubsonicExtensions: extensions, capabilities: buildNavidromeCapabilities(extensions, openSubsonic),
                user, musicFolders, license,
            };
        },
        // Get album list
        getAlbumList2: (config: Config, type: 'alphabeticalByName' | 'alphabeticalByArtist' | 'newest' | 'recent' | 'frequent' | 'random' = 'alphabeticalByName', size = 50, offset = 0) =>
            read<AlbumList2Response, SubsonicAlbum[]>(config, 'getAlbumList2', { type, size: size.toString(), offset: offset.toString() }, body => body.albumList2?.album || [], []),
        // Get album details with songs
        getAlbum: (config: Config, id: string) => read<AlbumResponse, SubsonicAlbum | null>(config, 'getAlbum', { id }, body => body.album, null),
        getPlaylists: (config: Config) => read<PlaylistsResponse, SubsonicPlaylist[]>(config, 'getPlaylists', undefined, body => body.playlists?.playlist || [], []),
        getPlaylist: (config: Config, id: string) => read<PlaylistResponse, SubsonicPlaylist | null>(config, 'getPlaylist', { id }, body => body.playlist, null),
        getRandomSongs: (config: Config, size = 100) => read<RandomSongsResponse, SubsonicSong[]>(config, 'getRandomSongs', { size: size.toString() }, body => body.randomSongs?.song || [], []),
        getStarred2: (config: Config) => read<Starred2Response, SubsonicSong[]>(config, 'getStarred2', undefined, body => body.starred2?.song || [], []),
        getArtists: (config: Config) => read<ArtistsIndexResponse, SubsonicArtist[]>(config, 'getArtists', undefined, body => (body.artists?.index || []).flatMap(index => index.artist || []), []),
        getArtist: (config: Config, id: string) => read<ArtistResponse, (SubsonicArtist & { album?: SubsonicAlbum[] }) | null>(config, 'getArtist', { id }, body => body.artist, null),
        // Fetches the full OpenSubsonic song payload, including ReplayGain when supported by the server.
        getSong: (config: Config, id: string) => read<SongResponse, SubsonicSong | null>(config, 'getSong', { id }, body => body.song || null, null),
        // Get lyrics (from Navidrome)
        getLyrics: (config: Config, artist: string, title: string) => read<LyricsResponse, string | null>(config, 'getLyrics', { artist, title }, body => body.lyrics?.value || null, null),
        // Get lyrics by song ID (OpenSubsonic)
        getLyricsBySongId: (config: Config, id: string) => read<LyricsBySongIdResponse, StructuredLyric[] | null>(config, 'getLyricsBySongId', { id, enhanced: true }, body => body.lyricsList?.structuredLyrics || null, null),
        // Search
        search: (config: Config, query: string, artistCount = 5, albumCount = 10, songCount = 20) =>
            read<Search3Response, Search3Response['searchResult3']>(config, 'search3', { query, artistCount: artistCount.toString(), albumCount: albumCount.toString(), songCount: songCount.toString() }, body => body.searchResult3 || {}, {}),
    };
    return api;
}
