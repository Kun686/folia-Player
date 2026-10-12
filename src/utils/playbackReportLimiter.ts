// playbackReportLimiter.ts — shared desktop/native admission rules; reservations count failed attempts too.
/** No listener finishes two songs inside this. A second report that soon is a bug, not a listen. */
export const MIN_REPORT_GAP_MS = 5000;
/** An hour of back-to-back two-minute tracks is 30. Twice that is already generous. */
export const MAX_REPORTS_PER_HOUR = 60;
export const REPORT_TIMEOUT_MS = 15_000;
const HOUR_MS = 60 * 60 * 1000;

export function createPlaybackReportLimiter() {
  // In memory only: restarting the app clears the hourly window. Persisting it would buy little,
  // since every report still needs 30 seconds of real audio behind it, but the ceiling is a guard
  // against bursts within a session rather than a durable quota.
  let times: number[] = [];
  let serial = 0;
  let active: number | null = null;
  return {
    reserve(nowMs: number): { ticket: number; reason?: never } | { ticket: null; reason: 'busy' | 'gap' | 'hour' | 'clock' } {
      if (!Number.isFinite(nowMs)) return { ticket: null, reason: 'clock' };
      if (active !== null) return { ticket: null, reason: 'busy' };
      times = times.filter(time => nowMs - time < HOUR_MS);
      const last = times[times.length - 1];
      if (last !== undefined && nowMs - last < MIN_REPORT_GAP_MS) return { ticket: null, reason: 'gap' };
      if (times.length >= MAX_REPORTS_PER_HOUR) return { ticket: null, reason: 'hour' };
      // Counted before the request rather than after it, so a slow or failing endpoint cannot be
      // retried into a burst - a dropped record is always cheaper than a flagged account.
      times.push(nowMs); active = ++serial;
      return { ticket: active };
    },
    finish(ticket: number) { if (active === ticket) active = null; },
    reset() { times = []; active = null; },
  };
}
