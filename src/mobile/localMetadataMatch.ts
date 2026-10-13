import type { LocalSong } from '../types';
import type { LocalMatchSnapshot } from '../types/localSongMatch';
import { omni } from '../services/onlineMusic/omni';
import { applyOnlineMetadataCandidate, batchAutoMatchLocalSongMetadata, useImportedSnapshotForLocalSong } from '../services/localSongMetadataMatchService';
import { findAutomaticOnlineMetadataCandidate, waitForProvider, type searchOnlineMetadata } from '../services/onlineMetadataSearchService';
import { normalizeOnlineMetadataCandidate, type OnlineMetadataSource } from '../utils/onlineMetadataCandidate';
import { localMatchTarget } from '../utils/localMatchTarget';
import { projectMobileLocalSongs } from './localSongProjection';
import { localMatchStorage } from './localMatchStorage';
import { captureProviderSession, flushSessions } from './runtime';
import { native } from './bridge';

// localMetadataMatch.ts — original metadata-only policy over Omni and atomic native song/session receipts.
export function metadataSong(snapshot: LocalMatchSnapshot): LocalSong {
  return { ...projectMobileLocalSongs([snapshot.base])[0], ...localMatchTarget(snapshot),
    localCoverAssetId: snapshot.hasLocalCover ? 'native-embedded' : undefined };
}

export function mobileMetadataServices(sources: readonly OnlineMetadataSource[], active: () => boolean) {
  const session = ['netease', 'qq', 'kugou'].map(captureProviderSession);
  const check = (signal?: AbortSignal) => {
    if (!active() || signal?.aborted) throw new DOMException('Canceled', 'AbortError');
    if (!session.every(current => current())) throw new Error('lyric-session-changed');
  };
  const search: typeof searchOnlineMetadata = async (source, query, target, options = {}) => {
    check(options.signal);
    if (!sources.includes(source) || !query.trim()) return [];
    const limit = options.limit ?? 10;
    const page = await waitForProvider(omni.searchProviderSongs(source, query.trim(), { limit, offset: 0 }), options.signal);
    check(options.signal);
    return page.items.map(song => normalizeOnlineMetadataCandidate(source, song, target))
      .sort((a, b) => b.score - a.score).slice(0, limit);
  };
  const read = async (id: string, online: boolean, includeCover = false, signal?: AbortSignal) => {
    if (online) { check(signal); await flushSessions(); }
    else if (!active()) throw new DOMException('Canceled', 'AbortError');
    const snapshot = await native.readLocalMatch({ id, online, includeCover });
    if (online) check(signal);
    if (!snapshot.contextToken || (online && !snapshot.sessionToken)) throw new Error('local-library-unavailable');
    return snapshot;
  };
  const applySnapshot = (snapshot: LocalMatchSnapshot, candidate: Parameters<typeof applyOnlineMetadataCandidate>[1], options: Parameters<typeof applyOnlineMetadataCandidate>[2], signal?: AbortSignal) => {
    const storage = localMatchStorage(snapshot, () => { check(signal); return true; }, true);
    return applyOnlineMetadataCandidate(metadataSong(snapshot), candidate, options, storage.apply);
  };
  const restore: typeof useImportedSnapshotForLocalSong = async id => {
    const snapshot = await read(id, false);
    await useImportedSnapshotForLocalSong(id, localMatchStorage(snapshot, active, true).apply);
  };
  const batch: typeof batchAutoMatchLocalSongMetadata = async (songs, options = {}) => {
    if (!sources.length) throw new Error('configure-server');
    const snapshots = new Map<string, LocalMatchSnapshot>();
    return batchAutoMatchLocalSongMetadata(songs, { ...options,
      find: async song => {
        const snapshot = await read(song.id, true, false, options.signal);
        if (snapshot.document?.noAutoMatch) throw new Error('local-library-changed');
        const candidate = await findAutomaticOnlineMetadataCandidate(metadataSong(snapshot), options.signal, search);
        if (candidate) snapshots.set(song.id, snapshot);
        return candidate;
      },
      apply: (song, candidate, policy) => {
        const snapshot = snapshots.get(song.id);
        if (!snapshot) throw new Error('local-library-unavailable');
        snapshots.delete(song.id);
        return applySnapshot(snapshot, candidate, policy, options.signal);
      },
    });
  };
  return { sources, read, search, applySnapshot, restore, batch };
}
