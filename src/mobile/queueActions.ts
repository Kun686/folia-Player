import { applyQueueAddBehavior } from '../utils/queueAddBehavior';
import { applyQueueBatchOperation, shufflePlaybackQueue } from '../utils/queueBatchOperations';
import { getPlaybackSongKey } from '../utils/appPlaybackGuards';
import { isSongUnavailable } from '../services/onlineMusic/songAvailability';
import type { QueueAddBehavior, SongResult } from '../types';
import { native, type PlaybackSnapshot } from './bridge';
import { buildReplacementQueue } from '../utils/queueSongReplacement';
import type { PreparedSongReplacement } from './mobileSongReplacement';
import { captureProviderSession, flushSessions } from './runtime';
import { derivePlayableTracks } from '../library/core/model/collectionView';
import type { QueueBatchAction } from '../components/command-palette/queueQuery';

// src/mobile/queueActions.ts — shared desktop transforms with an atomic native version check.
export type QueueAction = { type: 'remove' | 'next' | 'end'; index: number } | { type: 'clear' } | { type: 'shuffle' }
  | { type: 'batch'; operation: QueueBatchAction; indices: number[] };
const active = (state: PlaybackSnapshot) => state.queue[state.index] ?? state.currentSong;

async function commit(state: PlaybackSnapshot, songs: SongResult[]) {
  if (songs.length > 1000) throw new Error('queue-full');
  const song = active(state);
  // Reference identity retains a duplicate occurrence; shuffle intentionally deduplicates current.
  let currentIndex = song && state.index >= 0 ? songs.indexOf(song) : -1;
  if (currentIndex < 0 && song && state.index >= 0) {
    currentIndex = songs.findIndex(candidate => getPlaybackSongKey(candidate) === getPlaybackSongKey(song));
  }
  return native.editQueue({ songs, currentIndex, queueRevision: state.queueRevision });
}

export async function editMobileQueue(state: PlaybackSnapshot, action: QueueAction) {
  const song = active(state);
  if (action.type === 'batch') {
    if (action.indices.some(index => !Number.isInteger(index) || index < 0 || index >= state.queue.length)) throw new Error('queue-changed');
    const result = applyQueueBatchOperation({ queue: state.queue, targetIndices: action.indices,
      currentSong: state.queue[state.index] ?? null, action: action.operation });
    // Preserve the original batch rule: skip the current occurrence. A detached song is not a queue row.
    if (!result.changed) return;
    return commit(state, result.nextQueue);
  }
  let songs: SongResult[];
  if (action.type === 'clear') songs = [];
  else if (action.type === 'shuffle') songs = shufflePlaybackQueue(state.queue, song);
  else if (action.type === 'remove') {
    songs = state.queue.filter((_, index) => index !== action.index);
    // Removing the playing occurrence detaches it, even if another occurrence has the same ID.
    if (action.index === state.index) {
      return native.editQueue({ songs, currentIndex: -1, queueRevision: state.queueRevision });
    }
  } else songs = applyQueueBatchOperation({ queue: state.queue, currentSong: song,
    targetIndices: [action.index], action: action.type }).nextQueue;
  return commit(state, songs);
}

export async function addMobileSongs(songs: SongResult[], behavior: QueueAddBehavior, assertCurrent: () => void = () => {}) {
  const queueable = derivePlayableTracks(songs, isSongUnavailable);
  if (!queueable.length) return 0;
  // Add is identity-based and can safely rebase once if a remote control advances the queue.
  // Row actions never retry: their index belongs to the exact list the user touched.
  for (let attempt = 0; attempt < 2; attempt++) {
    assertCurrent();
    const state = await native.getState();
    assertCurrent();
    const result = applyQueueAddBehavior({ queue: state.queue, songs: queueable, currentSong: active(state), behavior });
    if (!result.changed) return result.affectedSongs.length;
    try { await commit(state, result.nextQueue); return result.affectedSongs.length; }
    catch (error) { if (!(error instanceof Error) || error.message !== 'queue-changed' || attempt > 0) throw error; }
  }
}

// Capture every online session before an asynchronous queue action, including collection playback.
// Mixed scopes are invalidated if any of their accounts changes while the action is pending.
const queueProviders = (songs: SongResult[]) => [...new Set(songs.flatMap(song => song.sourceRef?.kind === 'online' ? [song.sourceRef.providerId] : []))];
export function captureMobileQueueSessions(songs: SongResult[], assertCurrent: () => void = () => {}) {
  const sessions = queueProviders(songs).map(captureProviderSession);
  return () => {
    assertCurrent();
    if (sessions.some(current => !current())) throw new Error('queue-changed');
  };
}

// A whole collection checks all of its platforms; selecting an existing row checks only that song.
export async function flushMobileQueueSessions(songs: SongResult[]) {
  const providers = queueProviders(songs);
  if (providers.length) await flushSessions(providers);
}

// Capture every online session before flushing or reading the native queue. Mixed scopes keep their
// original order, and a logout/settings change cannot enqueue an old account's songs after an await.
export async function enqueueMobileSongs(songs: SongResult[], behavior: QueueAddBehavior, assertCurrent: () => void = () => {}) {
  const check = captureMobileQueueSessions(songs, assertCurrent);
  check();
  await flushMobileQueueSessions(songs);
  check();
  return addMobileSongs(songs, behavior, check);
}

// Original search playback selects an existing identity or appends just the requested song.
// Selection never retries a changed queue; a late action must not override a remote playback intent.
export async function playMobileSearchSong(song: SongResult, current: () => boolean = () => true) {
  const check = () => { if (!current()) throw new Error('queue-changed'); };
  check();
  if (isSongUnavailable(song)) throw new Error('song-unavailable');
  const key = getPlaybackSongKey(song);
  let state = await native.getState();
  check();
  let index = state.queue.findIndex(candidate => getPlaybackSongKey(candidate) === key);
  if (index < 0) {
    // The add preference helper moves existing songs and skips a detached current song;
    // search playback instead preserves the entire queue's order, as handleQueueAddAndPlay does.
    state = await commit(state, [...state.queue, song]);
    check();
    index = state.queue.findIndex(candidate => getPlaybackSongKey(candidate) === key);
  }
  if (index < 0) throw new Error('queue-changed');
  await native.selectQueue({ index, queueRevision: state.queueRevision });
}

// Confirmation preserves any newer native queue/remote-control intent via both atomic queue revisions.
export async function playMobileReplacement(request: PreparedSongReplacement) {
  const check = () => { if (!request.current()) throw new Error('queue-changed'); };
  check(); await flushMobileQueueSessions(request.queue); check();
  let state = await native.getState(); check();
  if (state.queueRevision !== request.queueRevision) throw new Error('queue-changed');
  if (isSongUnavailable(request.replacementSong)) throw new Error('song-unavailable');
  const songs = buildReplacementQueue(request.queue, request.originalSong, request.replacementSong, isSongUnavailable);
  state = await commit(state, songs); check();
  const index = state.queue.findIndex(song => getPlaybackSongKey(song) === getPlaybackSongKey(request.replacementSong));
  if (index < 0) throw new Error('queue-changed');
  await native.selectQueue({ index, queueRevision: state.queueRevision });
}
