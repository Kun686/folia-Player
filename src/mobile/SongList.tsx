import { List, type RowComponentProps } from 'react-window';
import { Play, Plus, Trash2, MoreHorizontal } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SongResult } from '../types';
import type { QueueAction } from './queueActions';

// src/mobile/SongList.tsx — virtualized, touch-accessible rows; no hover-only actions.
interface Props {
  songs: SongResult[]; play: (index: number) => void; add: (song: SongResult, next?: boolean) => void;
  remove?: (song: SongResult) => void; edit?: (action: QueueAction) => void; currentIndex?: number; busy?: boolean;
}
function Row({ index, style, songs, play, add, remove, edit, currentIndex, busy, open }: RowComponentProps<Props & { open: (index: number) => void }>) {
  const { t } = useTranslation();
  const song = songs[index];
  return <div className="song-row" style={style}>
    <button className="song-main" disabled={busy} aria-current={currentIndex === index ? 'true' : undefined} onClick={() => play(index)} aria-label={t('mobile.play') + ' ' + song.name}>
      <Play size={18} /><span><strong>{song.name}</strong><small>{song.artists.map(a => a.name).join(' / ')}</small></span>
    </button>
    {!edit && <button className="icon-button" disabled={busy} onClick={() => add(song)} aria-label={t('mobile.add') + ' ' + song.name}><Plus size={20} /></button>}
    <button className="icon-button" disabled={busy} onClick={() => open(index)} aria-label={t('mobile.songActions') + ' ' + song.name}><MoreHorizontal size={20} /></button>
    {remove && <button className="icon-button" onClick={() => remove(song)} aria-label={t('mobile.remove') + ' ' + song.name}><Trash2 size={18} /></button>}
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
  const act = (action: () => void) => { setSelected(null); action(); };
  return <>
    <List style={{ height: 'min(52dvh, 650px)', minHeight: 180 }} rowComponent={Row} rowCount={props.songs.length}
      rowHeight={72} rowProps={{ ...props, open: setSelected }} overscanCount={5} />
    <dialog ref={dialog} className="song-actions sheet" aria-label={t('mobile.songActions')} onClose={() => setSelected(null)}>
      {song && selected !== null && <><header><h2>{song.name}</h2><button onClick={() => setSelected(null)}>{t('mobile.close')}</button></header>
        <div className="song-action-list">
          <button disabled={props.busy} onClick={() => act(() => props.play(selected))}>{t('mobile.play')}</button>
          <button disabled={props.busy || selected === props.currentIndex} onClick={() => act(() => props.edit
            ? props.edit({ type: 'next', index: selected }) : props.add(song, true))}>{t('mobile.playNext')}</button>
          <button disabled={props.busy || selected === props.currentIndex} onClick={() => act(() => props.edit
            ? props.edit({ type: 'end', index: selected }) : props.add(song))}>{t('mobile.toEnd')}</button>
          {props.edit && <button disabled={props.busy} onClick={() => act(() => props.edit?.({ type: 'remove', index: selected }))}>{t('mobile.removeFromQueue')}</button>}
        </div>
      </>}
    </dialog>
  </>;
}
