import { createDeckMeasurements, type DeckMeasurements } from './deckMeasurements';
export type { DeckLevelHistory } from './deckMeasurements';

// src/services/automix/deckAnalyser.ts
// One measurement tap per deck. Taken ahead of the crossfade envelope on purpose: a deck has to
// report its own level, not wherever the running blend currently has it, or the balance correction
// would be chasing its own output.

const FFT_SIZE = 1024;
/** Web Audio owns the tap; the measurement state is shared with native playback. */
export interface DeckAnalyser extends Omit<DeckMeasurements, 'tick'> {
    tick: (contextTime: number) => void;
}

export const createDeckAnalyser = (
    context: AudioContext,
    input: AudioNode,
    sink: AudioNode,
): DeckAnalyser => {
    const node = context.createAnalyser();
    node.fftSize = FFT_SIZE;
    // Flux is the change between consecutive frames; the engine's own smoothing would average
    // exactly the change we are trying to measure.
    node.smoothingTimeConstant = 0;

    // K-weighting in front of the tap, so a level read here and one off a decoded file are the same
    // number. Two tracks at equal RMS are not equally loud if one is bass-heavy, and every comparison
    // this tap feeds - the balance correction, the energy step - is a loudness question.
    //
    // The offline path derives the same two sections from the analog prototype (see `kWeight`); these
    // are the engine's own RBJ shapes at the same corners, agreeing to a fraction of a decibel. Close
    // enough for a comparison, versus hand-rolling biquads in an AudioWorklet to save that fraction.
    const shelf = context.createBiquadFilter();
    shelf.type = 'highshelf';
    shelf.frequency.value = 1681.974;
    shelf.gain.value = 4;
    const rumble = context.createBiquadFilter();
    rumble.type = 'highpass';
    rumble.frequency.value = 38.135;
    rumble.Q.value = 0.5003;

    // Out through a silent gain rather than left dangling. An engine only renders what something
    // downstream pulls on, and a tap that is never pulled reports digital silence forever - the
    // kind of failure that looks exactly like a track that happens to be quiet.
    const silent = context.createGain();
    silent.gain.value = 0;
    input.connect(shelf).connect(rumble).connect(node).connect(silent).connect(sink);

    const spectrum = new Float32Array(node.frequencyBinCount);
    const samples = new Float32Array(node.fftSize);
    const measurements = createDeckMeasurements(context.sampleRate, node.fftSize);
    return {
        ...measurements,
        tick: (contextTime: number) => {
            node.getFloatTimeDomainData(samples);
            node.getFloatFrequencyData(spectrum);
            measurements.tick(contextTime, samples, spectrum);
        },
    };
};
