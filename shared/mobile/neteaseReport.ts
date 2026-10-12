import type { AudioQualityPreference, ProviderPlaybackReport } from '../../src/types/onlineMusic.ts';

// neteaseReport.ts — original provider vocabulary and response rules, shared with native reporting.
export interface NeteaseReportTrack { id: number; name?: string; artists: { name: string }[] }

/**
 * The `level`/`bitrate` pair the listening report carries, which is NetEase's own client vocabulary
 * and therefore stays inside this adapter. Defaults match the documented ones for `/scrobble/v1`.
 */
const mapScrobbleQuality = (quality?: AudioQualityPreference): { level: string; bitrate: number } => {
  if (quality === 'standard') return { level: 'standard', bitrate: 128 };
  if (quality === 'lossless') return { level: 'lossless', bitrate: 999 };
  if (quality === 'hires') return { level: 'hires', bitrate: 1999 };
  return { level: 'exhigh', bitrate: 320 };
};
export function buildNeteaseReportParams(track: NeteaseReportTrack, report: ProviderPlaybackReport) {
  const { level, bitrate } = mapScrobbleQuality(report.quality);
  return {
    id: track.id, time: Math.round(report.playedSeconds), name: track.name || undefined,
    artist: track.artists.map(artist => artist.name).filter(Boolean).join(', ') || undefined,
    level, bitrate, ...(report.totalSeconds ? { total: Math.round(report.totalSeconds) } : {}),
  };
}
export function requireNeteaseReportSuccess(response: unknown,
  makeError: (code: 'auth-required' | 'unavailable', message: string) => Error =
    (code, message) => Object.assign(new Error(message), { code, providerId: 'netease' })): void {
  // Absence of a status code is a failure, not a success. `fetchWithCreds` does not check
  // `res.ok`, so a gateway error page or an API build without this route comes back as
  // perfectly valid JSON with no `code` at all - and defaulting that to 200 would print
  // "reported a play" for a play that no server ever accepted.
  const code = Number((response as { code?: unknown } | null)?.code);
  if (!Number.isFinite(code)) {
    throw makeError('unavailable', 'NetEase returned no status code for the listening report');
  }
  if ([301, 401, 403].includes(code)) {
    throw makeError('auth-required', 'NetEase rejected the listening report: not signed in');
  }
  if (code !== 200) {
    throw makeError('unavailable', `NetEase rejected the listening report: code ${code}`);
  }
}
