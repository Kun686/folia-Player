import { barGrid } from './musicalTime';
import { BEATS_PER_BAR } from './signalAnalysis';

// stemObservation.ts — original session's bar phase and two-evidence incoming-voice decision.
export function stemDownbeats(bpm: number | null, downbeat: number | null, beats: number | null,
    startMedia: number, wall: number): number[] {
    const bars: number[] = [];
    const lines = barGrid(bpm, downbeat, beats ?? BEATS_PER_BAR);
    if (lines) {
        const first = Math.ceil((startMedia - lines.offset) / lines.period);
        for (let k = first; ; k += 1) {
            const at = lines.offset + k * lines.period - startMedia;
            if (at > wall) break;
            if (at >= 0) bars.push(at);
        }
    }
    return bars;
}

export function incomingStemSings(stemFindsVoice: boolean, sectionStart: number | null,
    inAt: number, wall: number): boolean {
    const introAt = sectionStart === null ? null : sectionStart - inAt;
    return !(!stemFindsVoice && introAt !== null && introAt > wall);
}
