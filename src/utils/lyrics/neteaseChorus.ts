import type { NeteaseChorusRange } from './chorusEffects';

// neteaseChorus.ts — original provider chorus normalization without the worker transport.
export const parseNeteaseChorusRanges = (chorusRes: any): NeteaseChorusRange[] => {
    if (!chorusRes || chorusRes.code !== 200) {
        return [];
    }

    const ranges = chorusRes.chorus || chorusRes.data || [];
    if (!Array.isArray(ranges) || ranges.length === 0) {
        return [];
    }

    return ranges
        .map((range: any) => ({
            startTime: (range.startTime ?? 0) / 1000,
            endTime: (range.endTime ?? 0) / 1000
        }))
        .filter(range => Number.isFinite(range.startTime) && Number.isFinite(range.endTime) && range.endTime > range.startTime);
};
