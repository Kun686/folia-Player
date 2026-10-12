import { rampGain } from './automix/crossfadeGraph';
import { useAudioSettingsStore } from '../stores/useAudioSettingsStore';

import { createPlaybackFadeController as createController, type PlaybackFadeDeps as ControllerDeps } from './playbackFadeController';

// src/services/playbackFade.ts — Web graph and store adapter for the shared transport controller.
export { PLAYBACK_FADE_SECONDS, PAUSE_DRAIN_MS } from './playbackFadeController';
export type { PlaybackFadeController, PlaybackFadeSettleReason } from './playbackFadeController';
export type PlaybackFadeGraph = { context: AudioContext; gain: GainNode };
export type PlaybackFadeDeps = Omit<ControllerDeps, 'getGraph'> & { getGraph: () => PlaybackFadeGraph | null };

// Keep the public Web API unchanged; both hosts execute the same scheduler.
export const createPlaybackFadeController = ({ getGraph, ...deps }: PlaybackFadeDeps) => createController({
    ...deps,
    getGraph: () => {
        const graph = getGraph();
        return graph ? { running: graph.context.state === 'running',
            ramp: (value: number, seconds: number) => rampGain(graph.context, graph.gain, value, seconds) } : null;
    },
});

// Elements whose next 'pause' event comes from a flushed fade rather than from the listener. The
// event is async, so by the time it arrives the new song's play intent may already be set, and
// handling it as a listener pause would cancel that intent.
// A mark carries a deadline: the browser drops queued media events when the source is reloaded, so a
// mark whose event never arrived must not swallow the listener's next real pause.
const PROGRAMMATIC_PAUSE_TTL_MS = 1000;
const programmaticPauses = new WeakMap<HTMLMediaElement, number>();

/** Call just before pausing a playing element on a flush, so its pause event can be recognised. */
export const markProgrammaticPause = (element: HTMLMediaElement) => {
    programmaticPauses.set(element, Date.now() + PROGRAMMATIC_PAUSE_TTL_MS);
};

/** True once for an element marked above and still within its deadline; the pause handler uses it to ignore that event. */
export const consumeProgrammaticPause = (element: HTMLMediaElement): boolean => {
    const deadline = programmaticPauses.get(element);
    if (deadline === undefined) return false;
    programmaticPauses.delete(element);
    return Date.now() <= deadline;
};

let registeredGraph: PlaybackFadeGraph | null = null;

/** Called once the playback graph is built, so the transport can reach the fade node. */
export const registerPlaybackFadeGraph = (graph: PlaybackFadeGraph | null) => {
    registeredGraph = graph;
};

/** The app-wide controller. There is one audio context, so one controller. */
export const playbackFade = createPlaybackFadeController({
    getGraph: () => registeredGraph,
    isEnabled: () => useAudioSettingsStore.getState().playbackFadeEnabled,
});
