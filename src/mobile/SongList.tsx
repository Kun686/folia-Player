import { List, type RowComponentProps } from 'react-window';
import { Music2, Plus, MoreHorizontal } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';
import type { QueueAddBehavior, SongResult } from '../types';
import type { QueueAction } from './queueActions';
import { isSongUnavailable, getSongUnavailableLabel } from '../services/onlineMusic/songAvailability';
import SongInfoActions from './SongInfoActions';

// src/mobile/SongList.tsx — virtualized, touch-accessible rows; no hover-only actions.
interface Props {
  trackLabels?: ReadonlyMap<string, string | null>;
  libraryActions?(song: SongResult, close: () => void): ReactNode;
  songs: SongResult[]; play: (index: number) => void; add: (song: SongResult, behavior?: QueueAddBehavior) => void;
  remove?: (song: SongResult) => void; edit?: (action: QueueAction) => void; currentIndex?: number; busy?: boolean; respectAvailability?: boolean;
}
function Row({ index, style, songs, play, add, remove, edit, currentIndex, busy, respectAvailability, trackLabels, open }: RowComponentProps<Props & { open: (index: number) => void }>) {
  const { t } = useTranslation();
  const song = songs[index];
  const unavailable = respectAvailability && isSongUnavailable(song);
  const track = song.sourceRef?.kind === 'local' ? trackLabels?.get(song.sourceRef.mediaId) : null;
  return <div className="song-row" style={style}>
    <button className="song-main" disabled={busy || unavailable} aria-current={currentIndex === index ? 'true' : undefined} onClick={() => play(index)} aria-label={t('mobile.play') + ' ' + song.name}>
      <div className="song-art" aria-hidden="true">{track ?? <Music2 size={18} />}</div><span><strong>{song.name}</strong><small>{unavailable
        ? getSongUnavailableLabel(song, t('status.songUnavailableTag')) : song.artists.map(a => a.name).join(' / ')}</small></span>
    </button>
    {!edit && <button className="icon-button" disabled={busy || unavailable} onClick={() => add(song)} aria-label={t('mobile.add') + ' ' + song.name}><Plus size={20} /></button>}
    <button className="icon-button" disabled={busy} onClick={() => open(index)} aria-label={t('mobile.songActions') + ' ' + song.name}><MoreHorizontal size={20} /></button>
  </div>;
}
export default function SongList(props: Props) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<number | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { setSelected(null); }, [props.songs]);
  useEffect(() => {
    if (selected !== null) dialog.current?.showModal(); else dialog.current?.close();
  }, [selected]);
  const song = selected === null ? undefined : props.songs[selected];
  const unavailable = props.respectAvailability && isSongUnavailable(song);
  const act = (action: () => void) => { setSelected(null); action(); };
  return <>
    <List className="song-list" style={{ minHeight: 180 }} rowComponent={Row} rowCount={props.songs.length}
      rowHeight={72} rowProps={{ ...props, open: setSelected }} overscanCount={5} />
    <dialog ref={dialog} className="song-actions sheet" aria-label={t('mobile.songActions')} onClose={() => setSelected(null)}>
      {song && selected !== null && <><header><h2>{song.name}</h2><button onClick={() => setSelected(null)}>{t('mobile.close')}</button></header>
        <div className="song-action-list">
          <button disabled={props.busy || unavailable} onClick={() => act(() => props.play(selected))}>{t('mobile.play')}</button>
          <button disabled={props.busy || unavailable || selected === props.currentIndex} onClick={() => act(() => props.edit
            ? props.edit({ type: 'next', index: selected }) : props.add(song, 'next'))}>{t('mobile.playNext')}</button>
          <button disabled={props.busy || unavailable || selected === props.currentIndex} onClick={() => act(() => props.edit
            ? props.edit({ type: 'end', index: selected }) : props.add(song, 'append'))}>{t('mobile.toEnd')}</button>
          {props.edit && <button disabled={props.busy} onClick={() => act(() => props.edit?.({ type: 'remove', index: selected }))}>{t('mobile.removeFromQueue')}</button>}
          {props.libraryActions?.(song, () => setSelected(null))}
          <SongInfoActions song={song} />
          {props.remove && <button onClick={() => act(() => props.remove?.(song))} aria-label={t('mobile.remove') + ' ' + song.name}>{t('mobile.remove')}</button>}
        </div>
      </>}
    </dialog>
  </>;
}
