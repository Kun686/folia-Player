import { NavidromeScrobbleSessionTracker, type NavidromeScrobbleReport } from '../utils/navidromeScrobble';

// nativeNavidromeScrobbleRuntime.ts — original position-based rules in the existing native listening bundle.
export function createNavidrome() {
  let reports: NavidromeScrobbleReport[] = [];
  const tracker = new NavidromeScrobbleSessionTracker(report => reports.push(report));
  const take = () => { const result = JSON.stringify(reports); reports = []; return result; };
  return {
    observe(songId: string, durationMs: number, position: number, playing: boolean) {
      if (!songId || !Number.isFinite(position) || position < 0 || !Number.isFinite(durationMs)) {
        tracker.clearSession(); return take();
      }
      if (tracker.getCurrentSongId() !== songId) {
        tracker.clearSession();
        if (!playing) return take();
        tracker.startSession(songId, durationMs);
      }
      // Repeated playback starts are deduplicated by the original tracker, including pause/resume.
      if (playing) tracker.handlePlaybackStart(position);
      return take();
    },
    finish(position: number | null = null) {
      if (position !== null && Number.isFinite(position) && position >= 0) tracker.handleProgress(position);
      tracker.clearSession(); return take();
    },
    clear() { reports = []; tracker.clearSession(); },
  };
}
