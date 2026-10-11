import { lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';
import { useShallow } from 'zustand/react/shallow';
import { useAutomixSettingsStore } from '../stores/useAutomixSettingsStore';
import { useStageSettingsStore } from '../stores/useStageSettingsStore';
import NowPlayingToast from '../components/app/overlays/NowPlayingToast';
import { getPlaybackSongKey } from '../utils/appPlaybackGuards';
import type { SongResult, Theme } from '../types';

// TransitionOverlays.tsx — original ring and song card; only their mobile placement is adapted.
const AutomixTransitionAnimation = lazy(() => import('../components/app/overlays/AutomixTransitionAnimation'));
export default function TransitionOverlays({ visible, stageVisible, song, cover, light, theme }: {
  visible: boolean; stageVisible: boolean; song: SongResult | null; cover?: string; light: boolean; theme: Theme;
}) {
  const ring = useAutomixSettingsStore(s => s.transitionAnimation && s.transitionMode === 'automix');
  const card = useStageSettingsStore(useShallow(s => ({ mode: s.stageTrackPillMode, timeoutSec: s.stageTrackPillTimeoutSec })));
  if (!visible) return null;
  return <>
    {ring && createPortal(<Suspense fallback={null}>
      <AutomixTransitionAnimation theme={theme} isDaylight={light} />
    </Suspense>, document.body)}
    {stageVisible && song && <div className="mobile-transition-card">
      <NowPlayingToast song={{ title: song.name, artist: song.artists.map(a => a.name).join(' / '), coverUrl: cover ?? null }}
        trackKey={getPlaybackSongKey(song) ?? ''} mode={card.mode} timeoutSec={card.timeoutSec} theme={theme} isDaylight={light} />
    </div>}
  </>;
}
