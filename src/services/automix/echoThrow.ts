import type { TransitionStyle } from './transitionChooser';

// echoThrow.ts — original throw timing, shared by Web Audio scheduling and native execution.
/**
 * How long the thrown echo takes to repeat, when there is no tempo to derive it from.
 *
 * An eighth note at 120, which is the tempo nothing in a library is far from. With a tempo it is
 * derived instead, because an echo that repeats off the grid is heard as a fault rather than as an
 * effect.
 */
export const DEFAULT_THROW_DELAY_SEC = 0.25;
/** How much of each repeat survives into the next. Four or five audible repeats, then gone. */
export const THROW_FEEDBACK = 0.45;
/** How much of the outgoing track is fed in at the moment of the throw. */
const THROW_SEND = 0.6;
/** How long the send takes to open. Long enough not to click, short enough to be one gesture. */
const THROW_OPEN_SEC = 0.15;

export const echoThrowAt = (startAt: number, style: TransitionStyle, seconds: number, crossover: number): number =>
    startAt + (style === 'beatCut' ? 0 : seconds * crossover);

export const planEchoThrow = (at: number, periodSec: number | null, now: number) => {
    const delay = periodSec && periodSec > 0
        ? Math.min(1, Math.max(0.08, periodSec / 2)) : DEFAULT_THROW_DELAY_SEC;
    const opensAt = Math.max(now, at - THROW_OPEN_SEC);
    const peaksAt = Math.max(opensAt + 0.001, at);
    return { delay, opensAt, peaksAt, closesAt: peaksAt + 0.03,
        send: THROW_SEND, feedback: THROW_FEEDBACK, defaultDelay: DEFAULT_THROW_DELAY_SEC };
};
