import { envelopeOf, lastVocalMoment, singsInWindow } from './stemGesture';
import { incomingStemSings, stemDownbeats } from './stemObservation';
import { fail, numeric, numbers, read } from './nativeTransitionInput';

// nativeStemAnalysis.ts — original measurements from native Float32 PCM, never a guessed lyric/voice proxy.
const envelope = (value: unknown): value is number[] => numbers(value) && value.length <= 600
    && value.every(x => x >= 0 && Number.isFinite(Math.fround(x)));

export function stemEnvelopeJSON(left: Float32Array, right: Float32Array): string {
    if (![left, right].every(x => x instanceof Float32Array && x.length > 0 && x.length <= 1_323_000
        && x.every(Number.isFinite)) || left.length !== right.length) fail();
    return JSON.stringify(Array.from(envelopeOf([left, right], 44100)));
}

export function stemVocalEndJSON(text: string): string {
    const { vocals, mix } = read(text);
    if (!envelope(vocals) || !envelope(mix) || vocals.length !== mix.length) fail();
    return JSON.stringify(lastVocalMoment(new Float32Array(vocals as number[]), new Float32Array(mix as number[])));
}

export function stemObservationJSON(text: string): string {
    const request = read(text), { windowSec, outAt, inAt, vocals, mix, incomingVocals, incomingReference } = request;
    if (!numeric(windowSec) || windowSec < 0.8 || windowSec > 30
        || !numeric(outAt) || outAt < 0 || outAt > 1e9 || !numeric(inAt) || inAt < 0 || inAt > 1e9
        || !envelope(vocals) || !envelope(mix) || !envelope(incomingVocals) || !envelope(incomingReference)
        || vocals.length !== mix.length || vocals.length !== incomingVocals.length
        || Math.abs(vocals.length - windowSec / 0.05) > 1.001 || incomingReference.length < incomingVocals.length
        || typeof request.keysClash !== 'boolean') fail();
    const optional = (key: string, min: number, max: number): number | null => {
        const value = request[key] ?? null;
        return value === null ? null : numeric(value) && value >= min && value <= max ? value : fail();
    };
    // These bounds keep the original grid loop finite even for malformed external profile metadata.
    const bpm = optional('outgoingBpm', 0, 1000), downbeat = optional('outgoingDownbeat', -1e9, 1e9);
    const beats = optional('outgoingBeatsPerBar', 1, 32), intro = optional('incomingSectionStart', 0, 1e9);
    if (bpm && !Number.isFinite((60 / bpm) * (beats ?? 4))) fail();
    const outgoingBarSec = optional('outgoingBarSec', Number.MIN_VALUE, 30);
    const incomingBarSec = optional('incomingBarSec', Number.MIN_VALUE, 30);
    const expansion = optional('expansion', 0.25, 1);
    return JSON.stringify({ version: 1, windowSec, outgoingBarSec, incomingBarSec, outgoingBeatsPerBar: beats,
        vocals, mix, downbeats: stemDownbeats(bpm, downbeat, beats, outAt as number, windowSec as number), expansion,
        incoming: { keysClash: request.keysClash,
            sings: incomingStemSings(singsInWindow(new Float32Array(incomingVocals as number[]),
                new Float32Array(incomingReference as number[])), intro, inAt as number, windowSec as number) } });
}
