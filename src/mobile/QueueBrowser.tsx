import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Search } from 'lucide-react';
import type { QueueAddBehavior, SongResult } from '../types';
import type { PlaybackSnapshot } from './bridge';
import type { QueueAction } from './queueActions';
import { buildQueueSearchIndex, evaluateQueueSearch } from '../components/command-palette/queueSearch';
import { formatQueueQuery, type QueueBatchAction, type QueueFacetKind } from '../components/command-palette/queueQuery';
import SongList from './SongList';

// QueueBrowser.tsx — original indexed queue search and batch semantics through touch controls.
export default function QueueBrowser({ state, busy, play, add, edit, libraryActions }: {
  state: PlaybackSnapshot; busy: boolean; play(index: number): void;
  add(song: SongResult, behavior?: QueueAddBehavior): void; edit(action: QueueAction): void;
  libraryActions(song: SongResult, close: () => void): ReactNode;
}) {
  const { t } = useTranslation(), [text, setText] = useState(''), [scope, setScope] = useState<QueueFacetKind | 'all'>('all');
  const index = useMemo(() => buildQueueSearchIndex(state.queue), [state.queue]);
  const current = state.queue[state.index] ?? null;
  const query = scope === 'all' ? text : formatQueueQuery({ facetKind: scope, facetValue: text.trim() });
  const result = useMemo(() => evaluateQueueSearch(index, current, query), [index, current, query]);
  const songs = useMemo(() => result.matches.map(match => match.entry.song), [result]);
  const rowIndex = result.matches.findIndex(match => match.entry.queueIndex === state.index);
  const count = result.eligibleTargetIndices.length;
  const batch = (operation: QueueBatchAction) => {
    if (busy || !result.hasMeaningfulFilter || !count) return;
    if (operation === 'remove' && !window.confirm(t('mobile.queueSearch.confirmRemove', { count }))) return;
    edit({ type: 'batch', operation, indices: result.eligibleTargetIndices });
  };
  return <>
    <div className="queue-search-controls">
      <label>{t('mobile.queueSearch.scope')}<span className="queue-search-scope"><select value={scope} onChange={event => setScope(event.target.value as QueueFacetKind | 'all')}>
        <option value="all">{t('mobile.queueSearch.all')}</option>
        <option value="artist">{t('localMusic.artistLabel')}</option><option value="album">{t('localMusic.albumLabel')}</option>
      </select><ChevronDown size={16} aria-hidden="true" /></span></label>
      <form className="search" onSubmit={event => event.preventDefault()}>
        <Search size={20} /><input aria-label={t('mobile.queueSearch.input')} placeholder={t('mobile.queueSearch.input')}
          value={text} onChange={event => setText(event.target.value)} />
        <button type="button" disabled={!text} onClick={() => setText('')}>{t('mobile.queueSearch.clear')}</button>
      </form>
    </div>
    {result.hasMeaningfulFilter && <div className="queue-batch" role="group" aria-label={t('mobile.queueSearch.batch')}>
      <p role="status">{t('mobile.queueSearch.count', { count: result.matches.length })}
        {result.skippedCurrentCount > 0 && ' · ' + t('mobile.queueSearch.skipCurrent')}</p>
      <div className="queue-toolbar">{(['next', 'end', 'remove'] as const).map(operation =>
        <button key={operation} disabled={busy || !count} onClick={() => batch(operation)}>{t('mobile.queueSearch.' + operation)}</button>)}</div>
    </div>}
    {songs.length ? <SongList songs={songs} busy={busy} currentIndex={rowIndex} libraryActions={libraryActions}
      play={row => play(result.matches[row].entry.queueIndex)} add={add}
      edit={action => {
        if ('index' in action) edit({ ...action, index: result.matches[action.index].entry.queueIndex });
      }} /> : <p className="empty">{t(state.queue.length ? 'mobile.empty' : 'mobile.queueEmpty')}</p>}
  </>;
}
