import { createNavidromeSong } from './navidromeSong';
import {
    NavidromeConfig,
    SubsonicResponse,
    SubsonicAlbum,
    SubsonicSong,
    NavidromeSong,
    CreatePlaylistResponse,
    SubsonicPlaylist,
    NavidromeServerProfile,
} from '../types/navidrome';
import md5 from 'blueimp-md5';
import { createNavidromeReadApi } from './navidromeReadApi';

// LocalStorage key for config
const CONFIG_KEY = 'navidrome_config';
const ENABLED_KEY = 'navidrome_enabled';
const SERVER_PROFILE_KEY = 'navidrome_server_profile';
// 配置从哪来：'server' 表示 Docker 预置写入的，缺省是用户自己填的。预置只覆盖前者。
const CONFIG_ORIGIN_KEY = 'navidrome_config_origin';
// 用户在这个浏览器里清除过配置：之后不再自动套用 Docker 预置，免得刚登出一刷新又登回去。
const PRESET_DISMISSED_KEY = 'navidrome_server_preset_dismissed';
const MAX_STABLE_URL_SALT_CACHE_ENTRIES = 512;
type SubsonicParamPrimitive = string | number | boolean;
type SubsonicParamValue = SubsonicParamPrimitive | SubsonicParamPrimitive[];

// Check if Navidrome is enabled
export const isNavidromeEnabled = (): boolean => {
    return localStorage.getItem(ENABLED_KEY) === 'true';
};

// Set Navidrome enabled state
export const setNavidromeEnabled = (enabled: boolean): void => {
    localStorage.setItem(ENABLED_KEY, enabled ? 'true' : 'false');
};

// Get stored configuration
export const getNavidromeConfig = (): NavidromeConfig | null => {
    try {
        const stored = localStorage.getItem(CONFIG_KEY);
        if (stored) {
            return JSON.parse(stored);
        }
    } catch (e) {
        console.error('[Navidrome] Failed to parse config:', e);
    }
    return null;
};

export type NavidromeConfigOrigin = 'manual' | 'server';

export const hasNavidromeEnabledPreference = (): boolean => localStorage.getItem(ENABLED_KEY) !== null;

export const getNavidromeConfigOrigin = (): NavidromeConfigOrigin => (
    localStorage.getItem(CONFIG_ORIGIN_KEY) === 'server' ? 'server' : 'manual'
);

export const isNavidromeServerPresetDismissed = (): boolean => localStorage.getItem(PRESET_DISMISSED_KEY) === 'true';

// Save configuration
export const saveNavidromeConfig = (config: NavidromeConfig, origin: NavidromeConfigOrigin = 'manual'): void => {
    clearStableUrlSaltCache();
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    if (origin === 'server') {
        localStorage.setItem(CONFIG_ORIGIN_KEY, 'server');
    } else {
        localStorage.removeItem(CONFIG_ORIGIN_KEY);
    }
    localStorage.removeItem(PRESET_DISMISSED_KEY);
};

// Clear configuration
export const clearNavidromeConfig = (): void => {
    clearStableUrlSaltCache();
    localStorage.removeItem(CONFIG_KEY);
    localStorage.removeItem(CONFIG_ORIGIN_KEY);
    clearNavidromeServerProfile();
};

// 只给设置页「清除」按钮用：用户主动登出才算放弃预置，程序内部的清除不该连带关掉它。
export const dismissNavidromeServerPreset = (): void => {
    localStorage.setItem(PRESET_DISMISSED_KEY, 'true');
};

export const getCachedNavidromeServerProfile = (): NavidromeServerProfile | null => {
    try {
        const stored = localStorage.getItem(SERVER_PROFILE_KEY);
        return stored ? JSON.parse(stored) : null;
    } catch (e) {
        console.error('[Navidrome] Failed to parse server profile:', e);
        return null;
    }
};

export const saveNavidromeServerProfile = (profile: NavidromeServerProfile): void => {
    localStorage.setItem(SERVER_PROFILE_KEY, JSON.stringify(profile));
};

export const clearNavidromeServerProfile = (): void => {
    localStorage.removeItem(SERVER_PROFILE_KEY);
};

// For Subsonic API, we need the plain password to compute token = md5(password + salt)
// We store it as-is (Subsonic API requirement - unfortunately cannot pre-hash)
export const hashPassword = (password: string): string => {
    // Return the password as-is - Subsonic requires plain password for token generation
    return password;
};

// Generate random salt
const generateSalt = (): string => {
    const array = new Uint8Array(8);
    crypto.getRandomValues(array);
    return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('');
};

const buildAuthParamsWithSalt = (config: NavidromeConfig, salt: string): URLSearchParams => {
    // Subsonic API: token = md5(password + salt) where password is the plain text password
    // config.passwordHash actually contains the plain password (see hashPassword function)
    const token = md5(config.passwordHash + salt);

    const params = new URLSearchParams();
    params.set('u', config.username);
    params.set('t', token);
    params.set('s', salt);
    params.set('v', '1.16.1'); // Subsonic API version
    params.set('c', 'Folia'); // Client identifier
    params.set('f', 'json'); // Response format

    return params;
};

// Build authentication parameters
const buildAuthParams = (config: NavidromeConfig): URLSearchParams => {
    return buildAuthParamsWithSalt(config, generateSalt());
};

const stableUrlSaltCache = new Map<string, string>();

export const clearStableUrlSaltCache = (): void => {
    stableUrlSaltCache.clear();
};

const getStableUrlAuthCacheKey = (config: NavidromeConfig): string => (
    md5(JSON.stringify([config.serverUrl, config.username, config.passwordHash]))
);

const buildStableUrlAuthParams = (config: NavidromeConfig, scope: string): URLSearchParams => {
    const cacheKey = `${getStableUrlAuthCacheKey(config)}:${scope}`;
    let salt = stableUrlSaltCache.get(cacheKey);
    if (salt) {
        stableUrlSaltCache.delete(cacheKey);
        stableUrlSaltCache.set(cacheKey, salt);
        return buildAuthParamsWithSalt(config, salt);
    }

    salt = generateSalt();
    stableUrlSaltCache.set(cacheKey, salt);
    if (stableUrlSaltCache.size > MAX_STABLE_URL_SALT_CACHE_ENTRIES) {
        const oldestKey = stableUrlSaltCache.keys().next().value;
        if (oldestKey) {
            stableUrlSaltCache.delete(oldestKey);
        }
    }

    return buildAuthParamsWithSalt(config, salt);
};

// Generic API fetch function
const fetchSubsonic = async <T>(
    config: NavidromeConfig,
    endpoint: string,
    extraParams?: Record<string, SubsonicParamValue>
): Promise<SubsonicResponse<T>> => {
    const url = new URL(`${config.serverUrl}/rest/${endpoint}`);
    const authParams = buildAuthParams(config);

    // Add auth params
    authParams.forEach((value, key) => {
        url.searchParams.set(key, value);
    });

    // Add extra params
    if (extraParams) {
        Object.entries(extraParams).forEach(([key, value]) => {
            if (Array.isArray(value)) {
                value.forEach(item => url.searchParams.append(key, String(item)));
                return;
            }

            url.searchParams.set(key, String(value));
        });
    }

    const response = await fetch(url.toString());
    if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
    }

    return response.json();
};

export const refreshNavidromeServerProfile = async (config: NavidromeConfig): Promise<NavidromeServerProfile> => {
    const profile = await navidromeApi.getServerProfile(config);
    saveNavidromeServerProfile(profile);
    return profile;
};

// API Methods
export const navidromeApi = Object.assign(createNavidromeReadApi<NavidromeConfig>(fetchSubsonic), {

    createPlaylist: async (
        config: NavidromeConfig,
        name: string,
        songIds: string[] = []
    ): Promise<SubsonicPlaylist | null> => {
        try {
            const res = await fetchSubsonic<CreatePlaylistResponse>(config, 'createPlaylist', {
                name,
                songId: songIds,
            });
            if (res['subsonic-response'].status === 'ok') {
                return res['subsonic-response'].playlist || null;
            }
        } catch (e) {
            console.error('[Navidrome] createPlaylist failed:', e);
        }
        return null;
    },

    deletePlaylist: async (config: NavidromeConfig, playlistId: string): Promise<boolean> => {
        try {
            const res = await fetchSubsonic<Record<string, never>>(config, 'deletePlaylist', {
                id: playlistId,
            });
            return res['subsonic-response'].status === 'ok';
        } catch (e) {
            console.error('[Navidrome] deletePlaylist failed:', e);
        }
        return false;
    },

    updatePlaylist: async (
        config: NavidromeConfig,
        playlistId: string,
        options: {
            name?: string;
            comment?: string;
            public?: boolean;
            songIdsToAdd?: string[];
            songIndexesToRemove?: number[];
        }
    ): Promise<boolean> => {
        try {
            const res = await fetchSubsonic<Record<string, never>>(config, 'updatePlaylist', {
                playlistId,
                ...(options.name ? { name: options.name } : {}),
                ...(options.comment ? { comment: options.comment } : {}),
                ...(typeof options.public === 'boolean' ? { public: options.public } : {}),
                ...(options.songIdsToAdd?.length ? { songIdToAdd: options.songIdsToAdd } : {}),
                ...(options.songIndexesToRemove?.length ? { songIndexToRemove: options.songIndexesToRemove } : {}),
            });
            return res['subsonic-response'].status === 'ok';
        } catch (e) {
            console.error('[Navidrome] updatePlaylist failed:', e);
        }
        return false;
    },

    // Star a song on the Navidrome server
    star: async (config: NavidromeConfig, songId: string): Promise<boolean> => {
        try {
            const res = await fetchSubsonic<Record<string, never>>(config, 'star', { id: songId });
            return res['subsonic-response'].status === 'ok';
        } catch (e) {
            console.error('[Navidrome] star failed:', e);
        }
        return false;
    },

    // Unstar a song on the Navidrome server
    unstar: async (config: NavidromeConfig, songId: string): Promise<boolean> => {
        try {
            const res = await fetchSubsonic<Record<string, never>>(config, 'unstar', { id: songId });
            return res['subsonic-response'].status === 'ok';
        } catch (e) {
            console.error('[Navidrome] unstar failed:', e);
        }
        return false;
    },

    scrobble: async (
        config: NavidromeConfig,
        songId: string,
        options: {
            time?: number;
            submission?: boolean;
        } = {}
    ): Promise<boolean> => {
        try {
            const res = await fetchSubsonic<Record<string, never>>(config, 'scrobble', {
                id: songId,
                time: options.time ?? Date.now(),
                submission: options.submission ?? true,
            });
            return res['subsonic-response'].status === 'ok';
        } catch (e) {
            console.warn('[Navidrome] scrobble failed:', e);
        }
        return false;
    },

    // Get streaming URL
    getStreamUrl: (config: NavidromeConfig, songId: string, format?: string): string => {
        const url = new URL(`${config.serverUrl}/rest/stream`);
        const authParams = buildStableUrlAuthParams(config, `stream:${songId}:${format || ''}`);

        authParams.forEach((value, key) => {
            url.searchParams.set(key, value);
        });

        url.searchParams.set('id', songId);
        if (format) {
            url.searchParams.set('format', format);
        }

        return url.toString();
    },

    // Get cover art URL
    getCoverArtUrl: (config: NavidromeConfig, coverArtId: string, size?: number): string => {
        const url = new URL(`${config.serverUrl}/rest/getCoverArt`);
        const authParams = buildStableUrlAuthParams(config, `cover:${coverArtId}:${size || ''}`);

        authParams.forEach((value, key) => {
            url.searchParams.set(key, value);
        });

        url.searchParams.set('id', coverArtId);
        if (size) {
            url.searchParams.set('size', size.toString());
        }

        return url.toString();
    },

    // Convert SubsonicSong to NavidromeSong (for playback)
    toNavidromeSong: (
        config: NavidromeConfig,
        song: SubsonicSong,
        album?: SubsonicAlbum
    ): NavidromeSong => {
        const coverArtId = song.coverArt || album?.coverArt;
        const coverArtUrl = coverArtId
            ? navidromeApi.getCoverArtUrl(config, coverArtId, 600)
            : undefined;

        return createNavidromeSong(song, navidromeApi.getStreamUrl(config, song.id), coverArtUrl);
    },
});
