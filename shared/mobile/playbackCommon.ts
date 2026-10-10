// shared/mobile/playbackCommon.ts — pure transport contracts and scalar validation.
export type ProviderRequest = (operation: string, params: Record<string, string | number | boolean | undefined>) => Promise<any>;
export const isTerminalPlaybackError = (error: unknown) => ['auth-required', 'rate-limited', 'aborted'].includes(String((error as { code?: string })?.code)) || (error as { httpStatus?: number })?.httpStatus === 429;
export const valueOf = (raw: any, ...keys: string[]) => keys.map(key => raw?.[key]).find(value => value !== undefined && value !== null);
export const dataOf = (raw: any): any => raw?.data ?? raw?.body?.data ?? raw?.body ?? raw;
export const safePlaybackUrl = (value: string): string | null => {
    try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.toString().replace(/^http:/, 'https:') : null; }
    catch { return null; }
};
