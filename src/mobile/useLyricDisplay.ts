import { useMemo, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { LyricData, SongResult } from '../types';
import { createLyricsProcessor } from '../components/app/playback/createLyricsSetter';
import { useLyricSettingsStore } from '../stores/useLyricSettingsStore';
import { getPlaybackSongKey } from '../utils/appPlaybackGuards';
import type { LyricSegmentationRecord } from '../types/lyricSegmentation';

// useLyricDisplay.ts — original display rules run once per source/settings change, never on the audio clock.
export function useLyricDisplay(raw: LyricData | null, song?: SongResult, record: LyricSegmentationRecord | null = null) {
    const currentSong = useRef<SongResult | null>(song ?? null);
    currentSong.current = song ?? null;
    const key = song ? getPlaybackSongKey(song) : null;
    const settings = useLyricSettingsStore(useShallow(s => ({
        pattern: s.lyricFilterEnabled ? s.lyricFilterPattern : '',
        policy: s.lyricStaffPolicy, minDwellSeconds: s.lyricStaffMinDwellSeconds,
        absorbMode: s.lyricStaffAbsorbMode, staffPattern: s.lyricStaffPattern,
    })));
    const process = useMemo(() => createLyricsProcessor(settings.pattern, currentSong, {
        policy: settings.policy, minDwellSeconds: settings.minDwellSeconds,
        absorbMode: settings.absorbMode, pattern: settings.staffPattern,
    }, record), [settings, record]);
    return useMemo(() => process(raw), [process, raw, key]);
}
