// listeningIdentity.ts — the same catalogue-only identity boundary for native accounting and gateway writes.
export function neteaseListeningMediaId(value: unknown): string | null {
  const source = value as { kind?: unknown; providerId?: unknown; mediaId?: unknown; variant?: unknown } | null;
  if (source?.kind !== 'online' || source.providerId !== 'netease' || source.variant === 'cloud') return null;
  const id = source.mediaId;
  return typeof id === 'string' && /^\d+$/.test(id) && Number.isSafeInteger(Number(id)) && Number(id) > 0 ? id : null;
}
