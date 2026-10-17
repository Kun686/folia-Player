import { useRef } from 'react';
import { MoreHorizontal, Save, Shuffle, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { QueueAction } from './queueActions';

// QueueActionsMenu.tsx — one secondary-action menu for both library and player queue surfaces.
export default function QueueActionsMenu({ busy, count, edit, savePlaylist, saveDisabled }: {
  busy: boolean; count: number; edit(action: QueueAction): void;
  savePlaylist?: () => void; saveDisabled?: boolean;
}) {
  const { t } = useTranslation();
  const menu = useRef<HTMLDetailsElement>(null);
  const close = () => { if (menu.current) menu.current.open = false; };
  return <details ref={menu} className="queue-menu" onKeyDown={event => {
    if (event.key === 'Escape') { close(); menu.current?.querySelector('summary')?.focus(); event.stopPropagation(); }
  }}>
    <summary aria-label={t('mobile.queueActions')}><MoreHorizontal size={22} /></summary>
    <div className="queue-action-menu">
      <button disabled={busy || count < 2} onClick={() => { close(); edit({ type: 'shuffle' }); }}>
        <Shuffle size={18} />{t('mobile.shuffleQueue')}</button>
      {savePlaylist && <button disabled={busy || saveDisabled} onClick={() => { close(); savePlaylist(); }}>
        <Save size={18} />{t('localMusic.saveQueueAsPlaylist')}</button>}
      <button className="destructive" disabled={busy || !count} onClick={() => {
        close(); if (window.confirm(t('mobile.confirmClearQueue'))) edit({ type: 'clear' });
      }}><Trash2 size={18} />{t('mobile.clearQueue')}</button>
    </div>
  </details>;
}
