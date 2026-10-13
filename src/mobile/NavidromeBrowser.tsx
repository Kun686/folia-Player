import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { List, type RowComponentProps } from 'react-window';
import { ChevronLeft, ChevronRight, Music2, Search } from 'lucide-react';
import type { QueueAddBehavior, SongResult } from '../types';
import type { LibraryHomeCard } from '../library/core/contracts/homeModel';
import { NAVIDROME_HOME_SECTIONS, buildNavidromeAlbumCards, buildNavidromeArtistCards,
  buildNavidromeSectionCards, resolveNavidromeCollectionType } from '../library/core/model/navidromeHomeModel';
import { createMobileNavidromeLibrary } from './navidromeLibrary';
import type { NativeNavidromeSettings } from './nativeNavidrome';
import { navidromeRuntime } from './navidromeRuntime';
import { useNavidromeSettings } from './useNavidromeSettings';
import { navidromeErrorKey } from './localeNavidrome';
import NavidromeSettingsSheet from './NavidromeSettingsSheet';
import SongList from './SongList';
import { createNavidromeArtwork, navidromeCoverId, navidromeCoverKey } from './navidromeArtwork';
import { getNavidromeEditor } from './navidromeEditor';
import NavidromePlaylistSheet, { type NavidromePlaylistTarget } from './NavidromePlaylistSheet';
import NavidromeSongActions from './NavidromeSongActions';

// NavidromeBrowser.tsx — touch navigation over original library models, with virtual rows and scoped queue actions.
type Props = { play(songs: SongResult[], index: number, current: () => void, search: boolean): Promise<unknown>; add(song: SongResult, behavior: QueueAddBehavior | undefined, current: () => void): Promise<unknown>;
  busy: boolean; queueError: string; queueCount: number; showQueue(): void };
type Card = LibraryHomeCard & { collectionType: 'album' | 'artist' | 'playlist' | 'random' | 'favorites' };
function CardRow({ index, style, cards, select, artwork }: RowComponentProps<{ cards: Card[]; select(card: Card): void; artwork: ReturnType<typeof createNavidromeArtwork> }>) {
  const { t } = useTranslation(), card = cards[index];
  const id = navidromeCoverId(card.coverUrl), [cover, setCover] = useState<{ id: string; url?: string }>();
  useEffect(() => {
    const controller = new AbortController(); setCover(undefined);
    if (id) void artwork(id, controller.signal).then(url => { if (!controller.signal.aborted) setCover({ id, url }); }).catch(() => undefined);
    return () => controller.abort();
  }, [id, artwork]);
  return <div className="song-row" style={style}><button className="song-main local-collection"
    aria-label={t('mobile.openCollection', { name: card.name })} onClick={() => select(card)}>
    <div className="song-art" aria-hidden="true">{cover?.id === id && cover?.url ? <img src={cover.url} alt="" /> : <Music2 size={20} />}</div>
    <span><strong>{card.name}</strong><small>{card.description}</small></span><ChevronRight size={18} />
  </button></div>;
}
function Connected({ settings, ...props }: Props & { settings: NativeNavidromeSettings }) {
  const { t } = useTranslation(), [query, setQuery] = useState('');
  const [target, setTarget] = useState<NavidromePlaylistTarget | null>(null);
  const editor = useMemo(() => getNavidromeEditor(settings, navidromeRuntime.capture()), [settings]);
  const edits = useSyncExternalStore(editor.subscribe, editor.getSnapshot);
  const library = useMemo(() => createMobileNavidromeLibrary(settings, navidromeRuntime.capture(), undefined, editor.wait), [settings, editor]);
  const artwork = useMemo(() => createNavidromeArtwork(settings.scope, navidromeRuntime.capture()), [settings]);
  const state = useSyncExternalStore(library.subscribe, library.getSnapshot);
  const observed = useRef(edits.revision);
  useEffect(() => {
    if (observed.current === edits.revision) return;
    observed.current = edits.revision; library.invalidateHome();
    // Player actions share this editor; keep a visible collection current without restarting an existing refresh.
    if (!library.getSnapshot().busy) void library.load();
  }, [edits.revision, library]);
  const changed = async (deleted = false) => {
    library.invalidateHome();
    if (deleted) await library.home('playlists'); else await library.load();
  };
  const refresh = async () => {
    if (edits.error) { library.invalidateHome(); await library.home('playlists'); } else await library.load();
    if (!library.getSnapshot().error) { try { editor.acknowledgeRefresh(); } catch {} }
  };
  const editable = state.playlist?.owner === settings.username;
  useEffect(() => { void library.start().catch(() => undefined); return () => library.dispose(); }, [library]);
  const cards = useMemo<Card[]>(() => {
    const deps = { t, coverArtUrl: navidromeCoverKey };
    if (state.view.kind === 'home' && state.home) return buildNavidromeSectionCards(state.section, state.home, deps)
      .map(card => ({ ...card, collectionType: resolveNavidromeCollectionType(state.section, card.id) }));
    if (state.search) return [
      ...buildNavidromeAlbumCards(state.search.album ?? [], deps.coverArtUrl).map(card => ({ ...card, collectionType: 'album' as const })),
      ...buildNavidromeArtistCards(state.search.artist ?? [], deps).map(card => ({ ...card, collectionType: 'artist' as const })),
    ];
    return [];
  }, [state.home, state.search, state.section, state.view, t]);
  const open = (card: Card) => { void library.open({ source: 'navidrome', id: String(card.id), name: card.name, type: card.collectionType }); };
  return <>
    <nav className="local-sections" aria-label="Navidrome">
      {NAVIDROME_HOME_SECTIONS.map(section => <button key={section.key} aria-pressed={state.view.kind === 'home' && state.section === section.key}
        onClick={() => { setQuery(''); library.home(section.key); }}>{t(section.labelKey)}</button>)}
    </nav>
    <form className="search" onSubmit={event => { event.preventDefault(); void library.search(query); }}>
      <Search size={20} /><input aria-label={t('mobile.navidrome.searchHint')} placeholder={t('mobile.navidrome.searchHint')}
        value={query} onChange={e => setQuery(e.target.value)} />
      <button disabled={!query.trim()}>{t('mobile.search')}</button>
    </form>
    <div className="local-collection-heading">
      {state.view.kind !== 'home' && <button aria-label={t('mobile.backToCollections')} onClick={() => { setQuery(''); library.home(); }}><ChevronLeft /></button>}
      <h3>{state.view.kind === 'collection' ? state.view.collection.name : state.view.kind === 'search' ? t('mobile.navidrome.searchResults') : t(NAVIDROME_HOME_SECTIONS.find(s => s.key === state.section)!.labelKey)}</h3>
      <button disabled={state.busy || edits.busy} onClick={() => void refresh()}>{t('options.audioOutputRefresh')}</button>
    </div>
    {((state.view.kind === 'home' && state.section === 'playlists') || editable) && <div className="collection-actions">
      {state.view.kind === 'home' && state.section === 'playlists' && <button disabled={edits.busy || !!edits.error} onClick={() => setTarget({ kind: 'create' })}>{t('mobile.navidrome.createPlaylist')}</button>}
      {editable && state.playlist && <button disabled={edits.busy || !!edits.error} onClick={() => setTarget({ kind: 'edit', playlist: state.playlist! })}>{t('mobile.navidrome.playlistTools')}</button>}
    </div>}
    {edits.busy && <p role="status">{t('mobile.loading')}</p>}
    {edits.error && <p role="alert">{t(navidromeErrorKey(edits.error))} <button disabled={edits.busy || state.busy} onClick={() => void refresh()}>{t('mobile.navidrome.reviewChanges')}</button></p>}
    {state.busy && <p role="status">{t('mobile.loading')}</p>}
    {state.error && <p role="alert">{t(navidromeErrorKey(state.error))} <button onClick={() => void library.load()}>{t('mobile.retry')}</button></p>}
    {!!cards.length && <List className="song-list local-collections" style={{ minHeight: 180,
      flexGrow: state.songs.length ? 0 : 1, flexShrink: state.songs.length ? 0 : 1, flexBasis: state.songs.length ? 220 : 'auto' }}
      rowComponent={CardRow} rowCount={cards.length} rowHeight={76} rowProps={{ cards, select: open, artwork }} overscanCount={3} />}
    {!!state.songs.length && <SongList songs={state.songs} busy={props.busy}
      libraryActions={(song, close) => <NavidromeSongActions song={song} editor={editor} close={close} changed={changed}
        add={() => setTarget({ kind: 'add', song })} remove={editable && state.playlist ? () => {
          const playlist = state.playlist!, index = state.songs.indexOf(song);
          if (window.confirm(t('mobile.onlinePlaylistConfirm', { song: song.name, playlist: playlist.name }))) {
            void editor.remove(playlist, index).then(result => { if (result.ok) void changed(); });
          }
        } : undefined} />}
      play={index => { void props.play(state.songs, index, library.assertCurrent, state.view.kind === 'search'); }}
      add={(song, behavior) => { void props.add(song, behavior, library.assertCurrent); }} />}
    {!state.busy && !state.error && !cards.length && !state.songs.length && <p className="empty">{t('mobile.empty')}</p>}
    {target && <NavidromePlaylistSheet target={target} editor={editor} changed={changed} close={() => setTarget(null)} />}
  </>;
}
export default function NavidromeBrowser(props: Props) {
  const { t } = useTranslation(), state = useNavidromeSettings(), [configure, setConfigure] = useState(false);
  return <>
    <div className="account-row"><span>{state.settings?.username || 'Navidrome'}</span><button onClick={() => setConfigure(true)}>{t('mobile.navidrome.configure')}</button>
      <button onClick={props.showQueue}>{t('mobile.queue')} · {props.queueCount}</button></div>
    {props.queueError && <p role="alert">{t('mobile.' + props.queueError)}</p>}
    {state.busy ? <p role="status">{t('mobile.loading')}</p> : state.error ? <p role="alert">{t(navidromeErrorKey(state.error))}
      <button onClick={() => void navidromeRuntime.load().catch(() => undefined)}>{t('mobile.retry')}</button></p>
      : state.settings?.enabled ? <Connected key={state.epoch} {...props} settings={state.settings} />
        : <p>{t('mobile.navidrome.unconfigured')}</p>}
    {configure && <NavidromeSettingsSheet close={() => setConfigure(false)} />}
  </>;
}
