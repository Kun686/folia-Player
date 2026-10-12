// stemBus.ts — shared original splice and soft-limiter parameters; no audio graph or platform imports.
/**
 * How long the deck takes to change over between its media element and its stems.
 *
 * Eight milliseconds, from a measurement not a feel. Chromium aligns an AudioBufferSourceNode to a
 * MediaElementAudioSourceNode EXACTLY when the file is uncompressed: a phase-inverted buffer scheduled
 * from `element.currentTime` nulled the element to the meter floor, -222 dB, with no drift over nine
 * seconds. On a lossy file the same test came back at +3.8 dB - no cancellation at all - because
 * `currentTime` on a compressed stream is quantised to the codec's frames and lands the buffer up to a
 * frame out.
 *
 * So the changeover cannot assume alignment. Eight milliseconds is short enough that a misaligned splice
 * is a few milliseconds of comb filtering rather than an audible phase artefact, and long enough that a
 * perfectly aligned one - a FLAC or WAV library - has no step in it. A hard cut would be exact in the
 * first case and a click in the second.
 */
export const SPLICE_SEC = 0.008;

/**
 * Where the soft limiter stops being a straight line, and how far past full scale it can see.
 *
 * 0.95 is -0.45 dBFS: a master that fits inside full scale passes through all but untouched, and the
 * shaping is spent on what does not fit. 4 is +12 dB of visible range, well past anything two records
 * have been measured to reach together; beyond it a WaveShaper clamps to the end of its curve, the hard
 * clip this exists to avoid.
 */
const LIMIT_KNEE = 0.95;
const LIMIT_RANGE = 4;

/**
 * The transfer curve the two stem chains are summed through. Straight line, then a soft knee.
 *
 * The gesture REPLACES the master crossfade, and the allowance that keeps a blend under full scale
 * lived inside the crossfade it replaced. Two 0 dBFS masters handed over stem by stem were measured
 * summing to +3.4 dBFS with 1445 samples hard-clipped at the destination; where either had headroom the
 * same gesture peaked at -0.75, which is why nothing constant is right either.
 *
 * This replaces a measured, time-varying attenuation over the whole pair, for arithmetic reasons not
 * taste. That correction was driven by the loudest SAMPLE in each 50ms cell and spread over 400ms
 * either side, so on the pair above it pulled every sample down by about four decibels to keep 1445 of
 * them legal - a tenth of a percent of the window, protected by moving all of it. Four decibels through
 * the middle of a transition is audible, and was reported as the transition ducking. A memoryless curve
 * touches only the samples actually over, leaves the level alone, and needs nothing measured, no
 * threshold, no pair refused.
 *
 * `tanh` above the knee because it is smooth where it joins the line (no corner for a transient to find)
 * and asymptotic to 1 (no input, however far over, can reach full scale). Below the knee it is the
 * identity, exactly - a WaveShaper interpolates linearly between curve points, so a straight segment
 * comes back out straight, and the majority of every window passes through unchanged.
 */
export const softLimit = (x: number): number => {
    const level = x < 0 ? -x : x;
    if (level <= LIMIT_KNEE) return x;
    const room = 1 - LIMIT_KNEE;
    const held = LIMIT_KNEE + room * Math.tanh((level - LIMIT_KNEE) / room);
    return x < 0 ? -held : held;
};

export const STEM_SWEEP_Q = 0.7;

/** Float32 lookup table used by the original memoryless WaveShaper on both platforms. */
export function stemBusParameters() {
    const points = 8192, curve = new Float32Array(points);
    for (let i = 0; i < points; i += 1) {
        curve[i] = softLimit(((i / (points - 1)) * 2 - 1) * LIMIT_RANGE);
    }
    return { curve, inputGain: 1 / LIMIT_RANGE, spliceSec: SPLICE_SEC, sweepQ: STEM_SWEEP_Q };
}
