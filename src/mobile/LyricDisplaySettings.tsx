import { useCallback, useState } from 'react';
import LyricFilterSettingsModal, { type LyricFilterDraft } from '../components/modal/LyricFilterSettingsModal';
import { useLyricSettingsStore } from '../stores/useLyricSettingsStore';
import type { LyricData } from '../types';

// LyricDisplaySettings.tsx — reuse the original editor/store; native lyric caches retain their unfiltered source.
export default function LyricDisplaySettings({ lyrics, title, light, close }: {
    lyrics: LyricData | null; title: string; light: boolean; close(): void;
}) {
    // Freeze this editor's source and initial settings so a late refresh cannot erase an in-progress draft.
    const [initial] = useState(() => useLyricSettingsStore.getState());
    const [source] = useState(lyrics);
    const loadPreviewLyrics = useCallback(async () => source, [source]);
    const save = (draft: LyricFilterDraft) => {
        const s = useLyricSettingsStore.getState();
        s.handleSetLyricFilterPattern(draft.pattern);
        s.handleSetLyricFilterEnabled(draft.filterEnabled);
        s.handleSetLyricStaffPolicy(draft.staffPolicy);
        s.handleSetLyricStaffMinDwellSeconds(draft.staffMinDwellSeconds);
        s.handleSetLyricStaffAbsorbMode(draft.staffAbsorbMode);
        s.handleSetLyricStaffPattern(draft.staffPattern);
    };
    return <div className="mobile-lyric-filter">
        <LyricFilterSettingsModal isOpen isDaylight={light} currentSongTitle={title}
            initialPattern={initial.lyricFilterPattern} initialFilterEnabled={initial.lyricFilterEnabled}
            initialStaffPolicy={initial.lyricStaffPolicy} initialStaffMinDwellSeconds={initial.lyricStaffMinDwellSeconds}
            initialStaffAbsorbMode={initial.lyricStaffAbsorbMode} initialStaffPattern={initial.lyricStaffPattern}
            loadPreviewLyrics={loadPreviewLyrics} onSave={save} onClose={close} />
    </div>;
}
