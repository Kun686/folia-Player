import type { CreatePlaylistResponse, SubsonicPlaylist, SubsonicResponse } from '../types/navidrome';

// navidromeWriteApi.ts — original Subsonic write mapping shared by desktop and native transports.
export type NavidromeWriteOperation = 'createPlaylist' | 'updatePlaylist' | 'deletePlaylist' | 'star' | 'unstar';
export type NavidromeWriteParameters = Record<string, string | number | boolean | string[] | number[]>;
export type NavidromePlaylistEdit = { name?: string; comment?: string; public?: boolean; songIdsToAdd?: string[]; songIndexesToRemove?: number[] };
export type NavidromeWriteRequest<Config> = <T>(config: Config, operation: NavidromeWriteOperation,
    parameters: NavidromeWriteParameters) => Promise<SubsonicResponse<T>>;
export function createNavidromeWriteApi<Config>(request: NavidromeWriteRequest<Config>,
    onError: (operation: NavidromeWriteOperation, error: unknown) => void = (operation, error) => console.error(`[Navidrome] ${operation} failed:`, error)) {
    async function write(config: Config, operation: NavidromeWriteOperation, parameters: NavidromeWriteParameters): Promise<boolean> {
        try { return (await request<Record<string, never>>(config, operation, parameters))['subsonic-response'].status === 'ok'; }
        catch (error) { onError(operation, error); return false; }
    }
    return {
        async createPlaylist(config: Config, name: string, songIds: string[] = []): Promise<SubsonicPlaylist | null> {
            try {
                const res = await request<CreatePlaylistResponse>(config, 'createPlaylist', { name, songId: songIds });
                if (res['subsonic-response'].status === 'ok') return res['subsonic-response'].playlist || null;
            } catch (error) { onError('createPlaylist', error); }
            return null;
        },
        deletePlaylist: (config: Config, playlistId: string) => write(config, 'deletePlaylist', { id: playlistId }),
        updatePlaylist: (config: Config, playlistId: string, options: NavidromePlaylistEdit) => write(config, 'updatePlaylist', {
            playlistId,
            ...(options.name ? { name: options.name } : {}),
            ...(options.comment ? { comment: options.comment } : {}),
            ...(typeof options.public === 'boolean' ? { public: options.public } : {}),
            ...(options.songIdsToAdd?.length ? { songIdToAdd: options.songIdsToAdd } : {}),
            ...(options.songIndexesToRemove?.length ? { songIndexToRemove: options.songIndexesToRemove } : {}),
        }),
        // Star a song on the Navidrome server
        star: (config: Config, songId: string) => write(config, 'star', { id: songId }),
        // Unstar a song on the Navidrome server
        unstar: (config: Config, songId: string) => write(config, 'unstar', { id: songId }),
    };
}
