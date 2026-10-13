import type { NoCopyrightRecommendation, SongPrivilege, SongResult, UnifiedSong } from '../../src/types.ts';

// neteaseSong.ts — original transport normalization, shared with the native-facing FM endpoint.
export const toHttps = (url?: unknown) => {
  if (typeof url !== 'string' || !url) return '';
  return url.replace(/^http:/, 'https:');
};

const normalizeArtistName = (value: any): string => {
  if (typeof value === 'string') return value;
  if (value && typeof value.name === 'string') return value.name;
  return '';
};

const normalizeArtists = (source: any): { id: number; name: string }[] => {
  if (!source) return [];
  if (Array.isArray(source)) {
    return source
      .map((artist: any, index: number) => ({
        id: Number(artist?.id ?? index),
        name: normalizeArtistName(artist),
      }))
      .filter((artist) => artist.name);
  }

  if (typeof source === 'string') {
    return source
      .split(/[\/,]/)
      .map((name) => name.trim())
      .filter(Boolean)
      .map((name, index) => ({ id: index, name }));
  }

  return [];
};

const getCloudCoverFallback = (raw: any) =>
  raw?.simpleSong?.al?.picUrl ||
  raw?.simpleSong?.album?.coverUrl ||
  raw?.simpleSong?.album?.picUrl ||
  raw?.al?.picUrl ||
  raw?.album?.coverUrl ||
  raw?.album?.picUrl ||
  raw?.cover;

export const normalizeSongPrivilege = (raw: any): SongPrivilege | undefined => {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }

  return {
    id: typeof raw.id === 'number' ? raw.id : undefined,
    fee: typeof raw.fee === 'number' ? raw.fee : undefined,
    payed: typeof raw.payed === 'number' ? raw.payed : undefined,
    st: typeof raw.st === 'number' ? raw.st : undefined,
    pl: typeof raw.pl === 'number' ? raw.pl : undefined,
    dl: typeof raw.dl === 'number' ? raw.dl : undefined,
    flag: typeof raw.flag === 'number' ? raw.flag : undefined,
    cs: typeof raw.cs === 'boolean' ? raw.cs : undefined,
  };
};

const normalizeNoCopyrightRecommendation = (raw: any): NoCopyrightRecommendation | null => {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  return {
    type: typeof raw.type === 'number' ? raw.type : undefined,
    typeDesc: typeof raw.typeDesc === 'string' ? raw.typeDesc : undefined,
    songId: typeof raw.songId === 'string' || typeof raw.songId === 'number' ? raw.songId : undefined,
    thirdPartySong: raw.thirdPartySong ?? null,
    expInfo: raw.expInfo ?? null,
  };
};

export const normalizeSongResult = (raw: any): SongResult => {
  const base = raw?.simpleSong || raw;
  const tValue = Number(base?.t ?? raw?.t ?? 0) as 0 | 1 | 2;
  const sourceType: SongResult['sourceType'] = tValue === 1 || tValue === 2 ? 'cloud' : 'netease';

  const artists = normalizeArtists(
    base?.ar ||
    base?.artists
  );

  const albumName =
    base?.al?.name ||
    base?.album?.name ||
    'Unknown Album';

  const albumId = Number(
    base?.al?.id ??
    base?.album?.id ??
    raw?.al?.id ??
    raw?.album?.id ??
    0
  );

  const picUrl = toHttps(getCloudCoverFallback(raw));
  const duration = Number(
    base?.durationMs ??
    base?.dt ??
    base?.duration ??
    raw?.duration ??
    raw?.songLength ??
    0
  );

  return {
    id: Number(base?.id ?? raw?.id ?? 0),
    name: base?.name || raw?.songName || raw?.fileName || 'Unknown Song',
    artists,
    album: {
      id: albumId,
      name: albumName,
      coverUrl: picUrl || undefined,
    },
    durationMs: duration,
    aliases: Array.isArray(base?.alia) ? base.alia : [],
    translatedNames: Array.isArray(base?.tns) ? base.tns : [],
    t: tValue,
    sourceType,
    sourceRef: {
      kind: 'online',
      providerId: 'netease',
      mediaId: String(Number(base?.id ?? raw?.id ?? 0)),
      ...(sourceType === 'cloud' ? { variant: 'cloud' } : {}),
    },
    fee: typeof (base?.fee ?? raw?.fee) === 'number' ? Number(base?.fee ?? raw?.fee) : undefined,
    noCopyrightRcmd: normalizeNoCopyrightRecommendation(base?.noCopyrightRcmd ?? raw?.noCopyrightRcmd),
    resourceState: typeof (base?.resourceState ?? raw?.resourceState) === 'boolean'
      ? Boolean(base?.resourceState ?? raw?.resourceState)
      : undefined,
    privilege: normalizeSongPrivilege(base?.privilege ?? raw?.privilege),
  };
};

export const canonicalNeteaseSong = (normalized: SongResult): UnifiedSong => {
    const isCloud = normalized.t === 1 || normalized.t === 2 || normalized.sourceType === 'cloud';
    return {
        id: normalized.id,
        name: normalized.name,
        artists: normalized.artists,
        album: normalized.album,
        durationMs: normalized.durationMs,
        aliases: normalized.aliases || [],
        translatedNames: normalized.translatedNames || [],
        isPureMusic: normalized.isPureMusic,
        fee: normalized.fee,
        noCopyrightRcmd: normalized.noCopyrightRcmd,
        resourceState: normalized.resourceState,
        privilege: normalized.privilege,
        sourceRef: {
            kind: 'online',
            providerId: 'netease',
            mediaId: String(normalized.id),
            ...(isCloud ? { variant: 'cloud' } : {}),
        },
    };
};

export const mergeSongsWithPrivileges = (songs: any, privileges: any): SongResult[] => {
  const normalizedSongs = Array.isArray(songs)
    ? songs.map((song: any) => normalizeSongResult(song))
    : [];

  if (!Array.isArray(privileges) || privileges.length === 0 || normalizedSongs.length === 0) {
    return normalizedSongs;
  }

  const normalizedPrivileges = privileges.map((privilege: any) => normalizeSongPrivilege(privilege));
  const privilegeById = new Map<number, SongPrivilege>();

  normalizedPrivileges.forEach((privilege) => {
    if (typeof privilege?.id === 'number') {
      privilegeById.set(privilege.id, privilege);
    }
  });

  return normalizedSongs.map((song, index) => {
    const alignedPrivilege = normalizedPrivileges[index];
    const privilege = alignedPrivilege?.id === song.id
      ? alignedPrivilege
      : privilegeById.get(Number(song.id)) ?? alignedPrivilege;

    if (!privilege) {
      return song;
    }

    return {
      ...song,
      privilege,
    };
  });
};
