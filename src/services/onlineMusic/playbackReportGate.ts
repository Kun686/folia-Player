import type { SongResult } from '../../types';
import type { OmniPlaybackReport } from '../../types/onlineMusic';
import { getPlaybackSourceRef } from '../../utils/appPlaybackGuards';
import { useOnlineProviderAccountStore } from '../../stores/useOnlineProviderAccountStore';
import { omni } from './omni';
import { createPlaybackReportLimiter, MAX_REPORTS_PER_HOUR, REPORT_TIMEOUT_MS } from '../../utils/playbackReportLimiter';
export { MIN_REPORT_GAP_MS, MAX_REPORTS_PER_HOUR } from '../../utils/playbackReportLimiter';

// src/services/onlineMusic/playbackReportGate.ts
// The last thing between a listening report and the user's account.
//
// A listening report is a write to a real music account, and a burst of implausible ones is what
// trips a provider's risk control. The tracker upstream already refuses to count audio that was not
// played; this refuses to SEND at a rate no listener could produce, whatever the tracker believed.

/**
 * How long a report may stay in flight before the gate stops waiting for it.
 *
 * The NetEase transport has no timeout of its own, so a dead proxy, a sleeping serverless backend
 * or a black-holing firewall leaves the request pending forever. Without a deadline `inFlight` would
 * never clear and every later report in the session would be dropped as "still in flight" - the
 * feature would switch itself off silently. Losing the race does not cancel the request; it only
 * gives up the slot, which is the part that must not leak.
 */
const limiter = createPlaybackReportLimiter();
export const resetPlaybackReportGate = (): void => limiter.reset();

/** The provider is registered, declares the capability, and is configured on this build. */
export const isNeteaseScrobbleSupported = (): boolean => {
    try {
        return Boolean(omni.getProviderCapabilities('netease').playbackReports)
            && omni.getProviderAvailability('netease').configured;
    } catch {
        return false;
    }
};

/**
 * Supported AND signed in. Anonymous reports mean nothing to an account feature, so the settings
 * panel and the command palette both gate on this - through this one function, so neither can
 * offer a state the other refuses.
 */
export const isNeteaseScrobbleReady = (): boolean => (
    isNeteaseScrobbleSupported()
    && useOnlineProviderAccountStore.getState().accounts.netease?.status === 'authenticated'
);

/**
 * Sends one report if the rate allows it. Returns whether it was sent.
 *
 * Dropping is deliberately silent to the listener and loud in the console: the feature is a
 * background courtesy, and failing it must never cost more than the record it dropped.
 */
export const sendPlaybackReport = async (
    song: SongResult,
    report: OmniPlaybackReport,
    nowMs = Date.now(),
): Promise<boolean> => {
    const reservation = limiter.reserve(nowMs);
    if (reservation.ticket === null) {
        const reasons = {
            busy: 'another one is still in flight',
            gap: 'reports are arriving faster than a listener could play',
            hour: `over ${MAX_REPORTS_PER_HOUR} reports in the last hour`,
            clock: 'invalid clock',
        };
        console.warn('[Scrobble] dropped a listening report: ' + reasons[reservation.reason]);
        return false;
    }
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
        await Promise.race([
            omni.reportPlayback(song, report),
            new Promise<never>((_resolve, reject) => {
                deadline = setTimeout(
                    () => reject(new Error(`listening report timed out after ${REPORT_TIMEOUT_MS}ms`)),
                    REPORT_TIMEOUT_MS,
                );
            }),
        ]);
        const source = getPlaybackSourceRef(song);
        console.log('[Scrobble] reported a play', {
            provider: source.kind === 'online' ? source.providerId : source.kind,
            id: source.kind === 'online' ? source.mediaId : null,
            seconds: report.playedSeconds,
        });
        return true;
    } catch (error) {
        console.warn('[Scrobble] listening report failed', error);
        return false;
    } finally {
        clearTimeout(deadline);
        limiter.finish(reservation.ticket);
    }
};
