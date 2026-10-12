import type { PlaybackListenReport, PlaybackListenSessionInput } from '../utils/playbackListenTracker';
import { PlaybackListenTracker } from '../utils/playbackListenTracker';
import { resolveNeteaseListeningIdentity } from '../utils/playbackListeningIdentity';
import type { SongResult } from '../types';
import { createPlaybackReportLimiter, REPORT_TIMEOUT_MS } from '../utils/playbackReportLimiter';

// nativeListeningRuntime.ts — original accounting in JavaScriptCore; no network or WebView dependency.
export const protocolVersion = 1;
export interface ListeningSample {
  candidate: PlaybackListenSessionInput | null;
  occurrence: string;
  position: number;
  playing: boolean;
  nowMs: number;
}

/** One audible occurrence, including repeat-one and manual replay of the same song. */
export function createListeningSession() {
  const tracker = new PlaybackListenTracker();
  let occurrence: string | null = null;
  let previousTime = -Infinity;
  const clear = () => { tracker.clear(); occurrence = null; };
  const settle = (nowMs: number): PlaybackListenReport | null => {
    const report = tracker.settle(nowMs); clear(); return report;
  };
  const open = (sample: ListeningSample) => {
    if (!sample.candidate || !sample.playing) return;
    tracker.start(sample.candidate, sample.nowMs); occurrence = sample.occurrence;
  };
  return {
    observe(sample: ListeningSample): PlaybackListenReport | null {
      // The native caller supplies monotonic time. A malformed/backward clock discards the session.
      if (!Number.isFinite(sample.nowMs) || sample.nowMs < previousTime) { clear(); return null; }
      previousTime = sample.nowMs;
      let report: PlaybackListenReport | null = null;
      if (occurrence !== sample.occurrence || tracker.getSongKey() !== sample.candidate?.songKey) {
        report = settle(sample.nowMs); open(sample);
      }
      if (!sample.playing || !Number.isFinite(sample.position) || sample.position < 0) {
        tracker.discontinuity(); return report;
      }
      if (tracker.handleProgress(sample.position, sample.nowMs).restarted) {
        report = settle(sample.nowMs); open(sample);
        tracker.handleProgress(sample.position, sample.nowMs);
      }
      return report;
    },
    seek(from: number, to: number, nowMs: number) {
      if (!Number.isFinite(nowMs) || nowMs < previousTime) { clear(); return null; }
      previousTime = nowMs;
      return tracker.handleSeek(from, to, nowMs).restarted ? settle(nowMs) : null;
    },
    discontinuity: () => tracker.discontinuity(),
    settle(nowMs: number) {
      if (!Number.isFinite(nowMs) || nowMs < previousTime) { clear(); return null; }
      previousTime = nowMs; return settle(nowMs);
    },
    // Disable/logout/termination drop the unfinished listen without reporting it.
    discard() { clear(); },
    listenedSeconds: () => tracker.getListenedSeconds(),
  };
}

// JSON methods keep the native boundary finite and independent of bridged JS object lifetimes.
export function create() {
  const session = createListeningSession();
  const limiter = createPlaybackReportLimiter();
  return {
    observe: (json: string) => {
      const sample: Omit<ListeningSample, 'candidate'> & { song: SongResult | null; duration: number } = JSON.parse(json);
      // Native songs must carry their explicit provider identity; legacy fallback is desktop-only.
      const identity = sample.song?.sourceRef ? resolveNeteaseListeningIdentity(sample.song) : null;
      return JSON.stringify(session.observe({ ...sample,
        candidate: identity ? { ...identity, totalSeconds: sample.duration } : null }));
    },
    settle: (nowMs: number) => JSON.stringify(session.settle(nowMs)),
    seek: (from: number, to: number, nowMs: number) => JSON.stringify(session.seek(from, to, nowMs)),
    discontinuity: session.discontinuity,
    discard: session.discard,
    listenedSeconds: session.listenedSeconds,
    reserve: (nowMs: number) => limiter.reserve(nowMs).ticket ?? 0,
    finish: limiter.finish,
    timeoutMs: () => REPORT_TIMEOUT_MS,
  };
}
