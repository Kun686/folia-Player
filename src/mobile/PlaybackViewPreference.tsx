import { PanelsTopLeft, AudioLines, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { usePlaybackEntryViewStore } from '../stores/usePlaybackEntryViewStore';

// PlaybackViewPreference.tsx — original persistent playback destination, shared by both mobile settings surfaces.
export default function PlaybackViewPreference({ live = false }: { live?: boolean }) {
  const { t } = useTranslation();
  const view = usePlaybackEntryViewStore(state => state.playbackEntryView);
  const choose = usePlaybackEntryViewStore(state => state.setPlaybackEntryView);
  return <div className="playback-view-preference">
    <span>{t(live ? 'mobile.playbackView' : 'options.playbackEntryView')}</span>
    <div className="playback-view-options" role="group" aria-label={t(live ? 'mobile.playbackView' : 'options.playbackEntryView')}>
      <button type="button" aria-pressed={view === 'player'} onClick={() => choose('player')}>
        {view === 'player' ? <Check className="playback-view-check" aria-hidden="true" /> : <AudioLines aria-hidden="true" />}
        <span>{t('mobile.lyricPlayer')}</span>
      </button>
      <button type="button" aria-pressed={view === 'lattice'} onClick={() => choose('lattice')}>
        {view === 'lattice' ? <Check className="playback-view-check" aria-hidden="true" /> : <PanelsTopLeft aria-hidden="true" />}
        <span>{t('home.latticeLabel')}</span>
      </button>
    </div>
  </div>;
}
