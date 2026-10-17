import type { SongResult } from '../types';
import type { omni } from '../services/onlineMusic/omni';

// mobileSongLikes.ts — account-scoped reads and explicit, serialized like writes through Omni.
type LikeAPI = Pick<typeof omni, 'getLoginStatus' | 'getProviderLikedSongIds' | 'canLikeSong' | 'likeSong'>;
export interface SongLikeState {
  phase: 'loading' | 'ready' | 'saving' | 'anonymous' | 'error';
  liked: boolean | null;
  writable: boolean;
}

export function createMobileSongLikes(api: LikeAPI, captureSession: (provider: string) => () => boolean,
  changed?: (provider: string) => void) {
  // Keep a sent mutation alive across dialog dismissal. A reopened dialog waits before reading
  // server state, so an uncertain response cannot turn a second tap into an accidental inverse.
  const pending = new Map<string, Promise<void>>();
  const openSessions = new Map<string, number>();
  const refreshPending = new Map<string, () => boolean>();
  // Wait for every menu for this provider to close, including one reopened during
  // an in-flight write. Reloading its host rows would otherwise dismiss that menu.
  const refreshLibrary = (provider: string) => {
    if (openSessions.has(provider)) return;
    const current = refreshPending.get(provider); refreshPending.delete(provider);
    if (!current?.()) return;
    try { changed?.(provider); }
    catch { console.warn('[Mobile] Unable to refresh the library after a song like'); }
  };
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
          // A sent write can finish after its dialog closes. Refresh the owning library
          // independently of that dialog, but never notify a replacement account.
          if (isCurrent()) {
            refreshPending.set(ref.providerId, isCurrent);
            refreshLibrary(ref.providerId);
          }
          if (active && ticket === epoch) {
            publish(isCurrent() ? { phase: 'ready', liked: desired } : { phase: 'error', writable: false });
          }
        } catch { if (active && ticket === epoch) publish({ phase: 'error', writable: false }); }
        finally { if (pending.get(ref.providerId) === operation) pending.delete(ref.providerId); }
      };
      return {
        getSnapshot: () => state,
        subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
        start() {
          if (!active) openSessions.set(ref.providerId, (openSessions.get(ref.providerId) ?? 0) + 1);
          active = true; publish({ phase: 'loading', liked: null, writable: false }); void read();
        },
        dispose() {
          if (active) {
            const count = (openSessions.get(ref.providerId) ?? 1) - 1;
            if (count) openSessions.set(ref.providerId, count); else openSessions.delete(ref.providerId);
          }
          active = false; epoch++; refreshLibrary(ref.providerId);
        },
        read, change,
      };
    },
  };
}
export type MobileSongLikes = ReturnType<typeof createMobileSongLikes>;
