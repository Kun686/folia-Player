import { applyQueueAddBehavior } from '../utils/queueAddBehavior';
import { applyQueueBatchOperation, shufflePlaybackQueue } from '../utils/queueBatchOperations';
import { getPlaybackSongKey } from '../utils/appPlaybackGuards';
import type { QueueAddBehavior, SongResult } from '../types';
import { native, type PlaybackSnapshot } from './bridge';

// src/mobile/queueActions.ts — shared desktop transforms with an atomic native version check.
export type QueueAction = { type: 'remove' | 'next' | 'end'; index: number } | { type: 'clear' } | { type: 'shuffle' };
const active = (state: PlaybackSnapshot) => state.queue[state.index] ?? state.currentSong;

async function commit(state: PlaybackSnapshot, songs: SongResult[]) {
  if (songs.length > 1000) throw new Error('queue-full');
  const song = active(state);
  // Reference identity retains a duplicate occurrence; shuffle intentionally deduplicates current.
  let currentIndex = song ? songs.indexOf(song) : -1;
  if (currentIndex < 0 && song && state.index >= 0) {
    currentIndex = songs.findIndex(candidate => getPlaybackSongKey(candidate) === getPlaybackSongKey(song));
  }
  return native.editQueue({ songs, currentIndex, queueRevision: state.queueRevision });
}

export async function editMobileQueue(state: PlaybackSnapshot, action: QueueAction) {
  const song = active(state);
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

export async function addMobileSongs(songs: SongResult[], behavior: QueueAddBehavior) {
  // Add is identity-based and can safely rebase once if a remote control advances the queue.
  // Row actions never retry: their index belongs to the exact list the user touched.
  for (let attempt = 0; attempt < 2; attempt++) {
    const state = await native.getState();
    const result = applyQueueAddBehavior({ queue: state.queue, songs, currentSong: active(state), behavior });
    if (!result.changed) return;
    try { await commit(state, result.nextQueue); return; }
    catch (error) { if (!(error instanceof Error) || error.message !== 'queue-changed' || attempt > 0) throw error; }
  }
}
