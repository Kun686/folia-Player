import type { SongResult } from '../types';
import type { omni } from '../services/onlineMusic/omni';

// mobileSongLikes.ts — account-scoped reads and explicit, serialized like writes through Omni.
type LikeAPI = Pick<typeof omni, 'getLoginStatus' | 'getProviderLikedSongIds' | 'canLikeSong' | 'likeSong'>;
export interface SongLikeState {
  phase: 'loading' | 'ready' | 'saving' | 'anonymous' | 'error';
  liked: boolean | null;
  writable: boolean;
}

export function createMobileSongLikes(api: LikeAPI, captureSession: (provider: string) => () => boolean) {
  // Keep a sent mutation alive across dialog dismissal. A reopened dialog waits before reading
  // server state, so an uncertain response cannot turn a second tap into an accidental inverse.
  const pending = new Map<string, Promise<void>>();
  return {
    createSession(song: SongResult, writable: boolean) {
      const ref = song.sourceRef;
      if (ref?.kind !== 'online') throw new Error('online-song-required');
      let state: SongLikeState = { phase: 'loading', liked: null, writable: false };
      let active = false, epoch = 0, accountCurrent = () => false;
      const listeners = new Set<() => void>();
      const publish = (patch: Partial<SongLikeState>) => {
        state = { ...state, ...patch }; listeners.forEach(listener => listener());
      };
      const read = async () => {
        if (!active || state.phase === 'saving') return;
        const ticket = ++epoch, sessionCurrent = captureSession(ref.providerId);
        const current = () => active && ticket === epoch;
        publish({ phase: 'loading', liked: null, writable: false });
        try {
          await pending.get(ref.providerId)?.catch(() => undefined);
          if (!current()) return;
          if (!sessionCurrent()) throw new Error('account-changed');
          const user = await api.getLoginStatus(ref.providerId);
          if (!current()) return;
          if (!sessionCurrent()) throw new Error('account-changed');
          if (!user) { publish({ phase: 'anonymous' }); return; }
          const ids = await api.getProviderLikedSongIds(ref.providerId, user.id, () => current() && sessionCurrent());
          if (!current()) return;
          if (!sessionCurrent()) throw new Error('account-changed');
          accountCurrent = sessionCurrent;
          publish({ phase: 'ready', liked: ids.some(id => String(id) === String(ref.mediaId)),
            writable: writable && api.canLikeSong(song) });
        } catch { if (current()) publish({ phase: 'error', writable: false }); }
      };
      const change = async () => {
        if (!active || state.phase !== 'ready' || !state.writable || state.liked === null) return;
        if (!accountCurrent()) { publish({ phase: 'error', writable: false }); return; }
        if (pending.has(ref.providerId)) { await read(); return; }
        const ticket = ++epoch, desired = !state.liked, isCurrent = accountCurrent;
        publish({ phase: 'saving' });
        const operation = Promise.resolve().then(() => api.likeSong(song, desired, { isCurrent }));
        pending.set(ref.providerId, operation);
        try {
          await operation;
          if (active && ticket === epoch) {
            publish(isCurrent() ? { phase: 'ready', liked: desired } : { phase: 'error', writable: false });
          }
        } catch { if (active && ticket === epoch) publish({ phase: 'error', writable: false }); }
        finally { if (pending.get(ref.providerId) === operation) pending.delete(ref.providerId); }
      };
      return {
        getSnapshot: () => state,
        subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
        start() { active = true; publish({ phase: 'loading', liked: null, writable: false }); void read(); },
        dispose() { active = false; epoch++; },
        read, change,
      };
    },
  };
}
export type MobileSongLikes = ReturnType<typeof createMobileSongLikes>;
