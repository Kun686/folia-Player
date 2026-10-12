import { neteaseListeningMediaId } from './listeningIdentity.ts';
import { buildNeteaseReportParams } from './neteaseReport.ts';
import type { AudioQualityPreference } from '../../src/types/onlineMusic.ts';

// neteaseReportRequest.ts — validate the native envelope before using the original provider's parameter builder.
export function mobileNeteaseReportParams(input: unknown) {
  const body = input as { song?: { sourceRef?: unknown; name?: unknown; artists?: unknown }; report?: {
    playedSeconds?: unknown; totalSeconds?: unknown; quality?: unknown } } | null;
  const id = neteaseListeningMediaId(body?.song?.sourceRef), report = body?.report;
  const played = report?.playedSeconds, total = report?.totalSeconds, quality = report?.quality;
  const invalid = () => Object.assign(new Error('invalid-report'), { code: 'invalid-report', status: 400 });
  if (!id || typeof played !== 'number' || !Number.isInteger(played) || played < 30 || played > 86400 ||
      typeof total !== 'number' || !Number.isInteger(total) || total < 0 || total > 86400 || (total > 0 && played > total) ||
      typeof quality !== 'string' || !['standard', 'high', 'lossless', 'hires'].includes(quality)) throw invalid();
  const name = body?.song?.name, artists = body?.song?.artists ?? [];
  if ((name !== undefined && (typeof name !== 'string' || name.length > 512)) || !Array.isArray(artists) || artists.length > 30 ||
      artists.some(artist => !artist || typeof artist.name !== 'string' || artist.name.length > 256)) throw invalid();
  return buildNeteaseReportParams({ id: Number(id), name: name as string | undefined,
    artists: artists.map(artist => ({ name: artist.name as string })) },
  { playedSeconds: played, totalSeconds: total || undefined, quality: quality as AudioQualityPreference });
}
