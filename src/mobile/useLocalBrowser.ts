import type { NativeLibrarySnapshot } from '../types/nativeLibrary';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LocalPlaylist, SongResult } from '../types';
import type { MobileLocalSection } from '../types/mobileLibrary';
import { normalizeLocalLibraryName } from '../utils/localLibraryNames';
import { buildMobileLocalGroups, filterMobileLocalSongs } from './localLibraryGroups';

// useLocalBrowser.ts — selection resolves against the latest native metadata, never a saved song array.
export function useLocalBrowser(allSongs: SongResult[], query: string, playlists: LocalPlaylist[], snapshot?: NativeLibrarySnapshot) {
  const { t } = useTranslation();
  const [section, setSection] = useState<MobileLocalSection>('songs');
  const [selection, setSelection] = useState<string | null>(null);
  const grouped = useMemo(() => buildMobileLocalGroups(allSongs, t, playlists, snapshot), [allSongs, t, playlists, snapshot]);
  const groups = section === 'songs' || section === 'folders' ? [] : grouped[section];
  const selected = groups.find(group => group.id === selection);
  useEffect(() => { if (selection && !selected) setSelection(null); }, [selection, selected]);
  const browsing = section !== 'songs' && section !== 'folders' && !selected;
  const songs = useMemo(() => filterMobileLocalSongs(selected?.songs ?? (browsing ? [] : allSongs), query),
    [selected, browsing, allSongs, query]);
  const needle = normalizeLocalLibraryName(query);
  const collections = useMemo(() => groups.filter(group => normalizeLocalLibraryName(group.name).includes(needle)
    || (needle !== '' && filterMobileLocalSongs(group.songs, needle).length > 0)), [groups, needle]);
  const changeSection = (next: MobileLocalSection) => { setSection(next); setSelection(null); };
  return { section, changeSection, selected, select: setSelection, browsing, songs, collections };
}
