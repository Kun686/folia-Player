import type { PersonalFmRequestOptions } from '../../src/types/onlineMusic.ts';
import { normalizePersonalFmSelection, toPersonalFmRequestOptions } from '../../src/services/onlineMusic/fmModes.ts';
import { canonicalNeteaseSong, normalizeSongResult } from './neteaseSong.ts';

// neteaseFm.ts — shared request/fallback policy; native code never duplicates platform song rules.
export type FmRequest = (path: string, query: Record<string, string>) => Promise<any>;
const fault = (code: string, status = 502) => Object.assign(new Error(code), { code, status });
export function validateFmSelection(value: unknown) {
  const raw = value as { mode?: unknown; scene?: unknown } | null;
  const normalized = normalizePersonalFmSelection(raw);
  if (!raw || raw.mode !== normalized.mode || (raw.scene ?? null) !== normalized.scene) throw fault('invalid-fm-mode', 400);
  return normalized;
}
function validateResponse(response: any) {
  const code = Number(response?.code);
  if ([301, 401, 403].includes(code)) throw fault('auth-required', 401);
  if (code === 429) throw fault('rate-limited', 429);
  if (code !== 200 || !Array.isArray(response?.data)) throw fault('invalid-fm-response');
  return response;
}
// Preserve the original one-time default-mode fallback. Authentication, cancellation and rate limits are terminal.
export async function requestNeteaseFm(options: PersonalFmRequestOptions | undefined, request: FmRequest) {
  const mode = options?.mode;
  if (!mode || mode === 'DEFAULT') return { response: validateResponse(await request('/personal_fm', {})), fallback: false };
  const query: Record<string, string> = { mode };
  if (mode === 'SCENE_RCMD' && options?.submode) query.submode = options.submode;
  try {
    const response = validateResponse(await request('/personal/fm/mode', query));
    if (response.data.length) return { response, fallback: false };
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (['auth-required', 'gateway-auth-required', 'rate-limited', 'cancelled'].includes(code ?? '') || (error as Error)?.name === 'AbortError') throw error;
  }
  return { response: validateResponse(await request('/personal_fm', {})), fallback: true };
}
export async function readNeteaseFm(selection: unknown, request: FmRequest) {
  const normalized = validateFmSelection(selection);
  const { response, fallback } = await requestNeteaseFm(toPersonalFmRequestOptions(normalized), request);
  if (response.data.length > 100 || response.data.some((song: any) =>
    !Number.isSafeInteger(Number(song?.id)) || Number(song.id) <= 0)) throw fault('invalid-fm-response');
  return { selection: normalized, fallback, songs: response.data.map((song: unknown) => canonicalNeteaseSong(normalizeSongResult(song))) };
}
