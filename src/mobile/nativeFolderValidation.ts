import type { NativeFolderEntry, NativeFolderFile, NativeFolderRule, NativeFolderTrack } from '../types/nativeFolder';

// nativeFolderValidation.ts — fail closed before a scan can be interpreted as a replacement catalog.
export function invalid(): never { throw new Error('invalid-folder-scan'); }
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
export function list(value: unknown, maximum = 50_000): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) invalid();
  return value;
}
export function path(value: unknown, root = false): string {
  if (typeof value !== 'string' || value.length > 4096 || /[\\\x00-\x1f]/.test(value)) invalid();
  if (root && value === '') return value;
  if (value.split('/').some(part => !part || part === '.' || part === '..')) invalid();
  return value;
}
function unique(values: string[]) { if (new Set(values).size !== values.length) invalid(); }
export function entries(value: unknown): NativeFolderEntry[] {
  const items = list(value).map(value => {
    const item = object(value), name = path(item.name);
    if (name.includes('/') || typeof item.directory !== 'boolean') invalid();
    return { name, directory: item.directory };
  });
  unique(items.map(item => item.name)); return items;
}
export function rules(value: unknown): NativeFolderRule[] {
  return list(value, 65).map(value => {
    const item = object(value);
    if (typeof item.content !== 'string' || item.content.length > 262_144) invalid();
    return { path: path(item.path, true), content: item.content };
  });
}
export function files(value: unknown): NativeFolderFile[] {
  const items = list(value).map(value => {
    const item = object(value);
    if (!Number.isSafeInteger(item.size) || (item.size as number) < 0 || typeof item.modified !== 'number'
      || !Number.isFinite(item.modified) || item.modified < 0) invalid();
    return { path: path(item.path), size: item.size as number, modified: item.modified };
  });
  unique(items.map(item => item.path)); return items;
}
export function previous(value: unknown): NativeFolderTrack[] {
  const items = list(value ?? []).map(value => {
    const item = object(value); path(item.path);
    for (const key of ['audioSignature', 'sidecarSignature', 'coverSignature']) {
      if (typeof item[key] !== 'string' || (item[key] as string).length > 1_000_000) invalid();
    }
    for (const key of ['lyric', 'translation', 'cover']) if (item[key] !== undefined) path(item[key]);
    return item as unknown as NativeFolderTrack;
  });
  unique(items.map(item => item.path)); return items;
}
