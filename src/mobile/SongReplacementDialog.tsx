import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import UnavailableReplacementDialog from '../components/modal/UnavailableReplacementDialog';
import type { PreparedSongReplacement } from './mobileSongReplacement';

// SongReplacementDialog.tsx — original confirmation UI in the native dialog top layer, above catalog sheets.
export default function SongReplacementDialog({ request, light, close, confirm }: {
  request: PreparedSongReplacement; light: boolean; close: () => void; confirm: () => Promise<void>;
}) {
  const { t } = useTranslation(), dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const node = dialog.current; node?.showModal(); return () => node?.close(); }, []);
  return <dialog ref={dialog} className="song-replacement-host mobile-audio-dialog" data-daylight={light}
    aria-label={t('status.playAlternativeVersion')} onCancel={event => { event.preventDefault(); close(); }}>
    <UnavailableReplacementDialog isOpen originalSong={request.originalSong} replacementSong={request.replacementSong}
      typeDesc={request.label} isDaylight={light} onClose={close} onConfirm={confirm} />
  </dialog>;
}
