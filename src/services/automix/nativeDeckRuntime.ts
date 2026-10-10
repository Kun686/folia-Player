import { createDeckMeasurements } from './deckMeasurements';

// nativeDeckRuntime.ts — the original live analysis state, hosted outside WKWebView.
export const protocolVersion = 1;
export const fftSize = 1024;

export function create(sampleRate: number) {
    if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000) {
        throw new Error('invalid-deck-rate');
    }
    const state = createDeckMeasurements(sampleRate, fftSize);
    const samples = new Float32Array(fftSize), spectrum = new Float32Array(fftSize / 2);
    let lastTime = -Infinity;
    return {
        samples, spectrum,
        tick(time: number) {
            if (!Number.isFinite(time) || time < lastTime
                || !samples.every(Number.isFinite)
                || !spectrum.every(value => Number.isFinite(value) || value === -Infinity)) {
                throw new Error('invalid-deck-frame');
            }
            state.tick(time, samples, spectrum);
            lastTime = time;
        },
        snapshot(time: number, includeHistory = false) {
            if (!Number.isFinite(time)) throw new Error('invalid-deck-time');
            return JSON.stringify({ time: Number.isFinite(lastTime) ? lastTime : null,
                loudnessDb: state.loudnessDb(), tempo: state.tempo(), nextBeatIn: state.nextBeatIn(time),
                history: includeHistory ? state.levelHistory() : null });
        },
        reset() { state.reset(); lastTime = -Infinity; },
    };
}
