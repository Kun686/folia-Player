import {
    estimateTempo,
    rmsDb,
    spectralFlux,
    MIN_TEMPO_CONFIDENCE,
    SILENCE_DB,
    type TempoEstimate,
} from './signalAnalysis';

// deckMeasurements.ts — original per-deck state shared by Web Audio and native PCM taps.

/** Onsets live below ~5kHz; above it is mostly cymbal wash and hiss, which blur the beat. */
const FLUX_CEILING_HZ = 5000;
/** Eight seconds of onset history: three periods of the slowest tempo the estimator looks for. */
const ENVELOPE_SIZE = 320;
/**
 * Loudness is a decaying peak rather than an average, so a rest between phrases does not read as
 * a quiet track and pull the whole balance correction with it. 12dB/s empties it in well under a
 * second once the music really does stop.
 */
const PEAK_DECAY_DB_PER_SEC = 12;
/** Roughly 400ms of frames before a level reading is worth acting on. */
const MIN_FRAMES_FOR_LEVEL = 16;
/** Re-running the autocorrelation on every frame would be the only expensive thing here. */
const TEMPO_REFRESH_SEC = 0.5;
/**
 * A gap longer than this between two frames means the sampler stopped, not that time passed.
 *
 * The sampler only runs while there is sound, so a pause, a stall or a throttled window comes back as
 * one enormous frame. Harmless for the tempo grid, which only looks at the last few seconds, but it
 * silently stretches the measured hop - so the level history flags it rather than describing a track
 * that was never played end to end.
 */
const CONTINUITY_GAP_SEC = 0.5;

/** A deck's own level readings for the track it is playing, and the real period between them. */
export interface DeckLevelHistory {
    db: readonly number[];
    hopSec: number;
}

export interface DeckMeasurements {
    /** Feeds one frame in. Driven by the hook's sampler, not by this module. */
    tick: (contextTime: number, samples: Float32Array, spectrum: Float32Array) => void;
    /** Recent level in dBFS, or null before there is enough of it to mean anything. */
    loudnessDb: () => number | null;
    /**
     * Every level read since this deck started its current track, or null if that series has a
     * hole in it and so describes something other than one continuous play-through.
     */
    levelHistory: () => DeckLevelHistory | null;
    tempo: () => TempoEstimate | null;
    /** Seconds from contextTime to this deck's next beat, or null without a usable grid. */
    nextBeatIn: (contextTime: number) => number | null;
    /** Forgets everything. Called when the deck starts a different track. */
    reset: () => void;
}

export const createDeckMeasurements = (sampleRate: number, fftSize = 1024): DeckMeasurements => {
    const previous = new Float32Array(fftSize / 2);
    const fluxBins = Math.max(
        8,
        Math.round((fftSize / 2) * FLUX_CEILING_HZ / (sampleRate / 2)),
    );

    let envelope: number[] = [];
    let levels: number[] = [];
    let continuous = true;
    let frames = 0;
    let firstTickTime = 0;
    let lastTickTime = 0;
    let peakDb = SILENCE_DB;
    let cachedTempo: TempoEstimate | null = null;
    let cachedAt = -Infinity;

    // Measured rather than assumed: the sampler is a timer, so its real period drifts with load.
    const hopSec = () => (frames > 1 ? (lastTickTime - firstTickTime) / (frames - 1) : 0);

    const tick = (contextTime: number, samples: Float32Array, spectrum: Float32Array) => {

        const level = rmsDb(samples);
        const elapsed = frames ? Math.max(0, contextTime - lastTickTime) : 0;
        peakDb = Math.max(level, peakDb - PEAK_DECAY_DB_PER_SEC * elapsed);
        if (elapsed > CONTINUITY_GAP_SEC) continuous = false;
        levels.push(level);

        if (frames) {
            envelope.push(spectralFlux(spectrum, previous, fluxBins));
            if (envelope.length > ENVELOPE_SIZE) envelope.shift();
        } else {
            firstTickTime = contextTime;
        }
        previous.set(spectrum);

        lastTickTime = contextTime;
        frames += 1;
    };

    const tempo = () => {
        if (lastTickTime - cachedAt < TEMPO_REFRESH_SEC) return cachedTempo;
        cachedAt = lastTickTime;
        cachedTempo = estimateTempo(envelope, hopSec());
        return cachedTempo;
    };

    const nextBeatIn = (contextTime: number) => {
        const estimate = tempo();
        if (!estimate || estimate.confidence < MIN_TEMPO_CONFIDENCE) return null;

        const period = estimate.periodSec;
        const lastBeatAt = lastTickTime - estimate.beatOffsetHops * hopSec();
        const since = contextTime - lastBeatAt;
        return period - (((since % period) + period) % period);
    };

    return {
        tick,
        loudnessDb: () => (frames >= MIN_FRAMES_FOR_LEVEL ? peakDb : null),
        levelHistory: () => (
            continuous && frames > MIN_FRAMES_FOR_LEVEL ? { db: levels, hopSec: hopSec() } : null
        ),
        tempo,
        nextBeatIn,
        reset: () => {
            envelope = [];
            levels = [];
            continuous = true;
            frames = 0;
            peakDb = SILENCE_DB;
            cachedTempo = null;
            cachedAt = -Infinity;
        },
    };
};
