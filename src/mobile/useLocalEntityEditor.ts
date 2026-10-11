import { useMemo, useRef, useState } from 'react';
import type { NativeLibraryOperation, NativeLibrarySnapshot } from '../types/nativeLibrary';
import { followEntityRedirect } from '../utils/localLibraryIndex';
import { native } from './bridge';

// useLocalEntityEditor.ts — retain the form and its revision after failures; refresh is an explicit user action.
export function useLocalEntityEditor(initial: NativeLibrarySnapshot, initialId: string, selected: (id: string) => void) {
  const [snapshot, setSnapshot] = useState(initial), [id, setId] = useState(initialId);
  const [pending, setPending] = useState(false), [error, setError] = useState('');
  const lock = useRef(false);
  const entity = snapshot.entities.find(item => item.id === id && !item.mergedInto);
  const memberSongs = useMemo(() => {
    const ids = new Set(snapshot.assignments.filter(item => entity?.kind === 'artist'
      ? item.artistEntityIds.includes(id) : item.albumEntityId === id).map(item => item.songId));
    return snapshot.editorSongs.filter(song => ids.has(song.id));
  }, [snapshot, entity, id]);
  const accept = (next: NativeLibrarySnapshot, target: string) => {
    const resolved = followEntityRedirect(target, new Map(next.entities.map(item => [item.id, item]))) ?? target;
    setSnapshot(next); setId(resolved); selected(resolved);
  };
  const run = async (operation?: NativeLibraryOperation, target = id) => {
    if (lock.current) return false;
    lock.current = true; setPending(true); setError('');
    try {
      accept(operation ? await native.editLocalLibrary({ revision: snapshot.revision, operation })
        : await native.readLocalLibrary(), target);
      return true;
    } catch (cause) {
      setError(cause instanceof Error && cause.message === 'local-library-changed' ? 'entityChanged' : 'entityError');
      return false;
    } finally { lock.current = false; setPending(false); }
  };
  return { entity, snapshot, memberSongs, pending, error, run };
}
