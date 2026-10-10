import { List, type RowComponentProps } from 'react-window';
import { Play, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { SongResult } from '../types';

// src/mobile/SongList.tsx — virtualized, touch-accessible rows; no hover-only actions.
interface Props { songs: SongResult[]; play: (index: number) => void; add: (song: SongResult) => void }
function Row({ index, style, songs, play, add }: RowComponentProps<Props>) {
  const { t } = useTranslation();
  const song = songs[index];
  return <div className="song-row" style={style}>
    <button className="song-main" onClick={() => play(index)} aria-label={t('mobile.play') + ' ' + song.name}>
      <Play size={18} /><span><strong>{song.name}</strong><small>{song.artists.map(a => a.name).join(' / ')}</small></span>
    </button>
    <button className="icon-button" onClick={() => add(song)} aria-label={t('mobile.add') + ' ' + song.name}><Plus size={20} /></button>
  </div>;
}
export default function SongList(props: Props) {
  return <List style={{ height: 'min(52dvh, 650px)', minHeight: 180 }} rowComponent={Row} rowCount={props.songs.length}
    rowHeight={72} rowProps={props} overscanCount={5} />;
}
