import { trimForBalance } from './signalAnalysis';

// balanceCorrection.ts — original transition-only balance policy, shared with native playback.
/** How often the balance correction re-reads the two decks during a blend. */
export const BALANCE_INTERVAL_MS = 100;
/** Slow enough that the correction is never heard arriving. */
export const BALANCE_RAMP_SEC = 0.4;
/** Nothing smaller than this is worth moving a gain for. */
const BALANCE_STEP_DB = 0.75;

export const nextBalanceTrim = (outgoingDb: number | null, incomingDb: number | null, appliedDb: number): number | null => {
    if (outgoingDb === null || incomingDb === null) return null;
    const target = trimForBalance(outgoingDb, incomingDb);
    return target < appliedDb + BALANCE_STEP_DB ? null : target;
};
