import { Buffer } from 'buffer';
import { CommonTagMapper } from '../../../node_modules/music-metadata/lib/common/GenericTagMapper.js';

// nativeTrackOrder.ts — system tag payloads use the installed desktop parser's track-number normalization.
export function trackOrderJSON(text: string): string {
  if (text.length > 80_000) throw new Error('invalid-track-metadata');
  const input = JSON.parse(text);
  if (input?.version !== 1 || !Array.isArray(input.tags) || input.tags.length > 64) throw new Error('invalid-track-metadata');
  const result: { trackNumber?: number; discNumber?: number } = {};
  for (const tag of input.tags) {
    if (!tag || !['trackNumber', 'discNumber'].includes(tag.field) || typeof tag.value !== 'string'
      || tag.value.length > 1024 || !['text', 'itunes'].includes(tag.format)) throw new Error('invalid-track-metadata');
    let value = tag.value;
    if (tag.format === 'itunes') {
      const bytes = Buffer.from(value, 'base64');
      if (bytes.length < 6 || bytes.length > 8) throw new Error('invalid-track-metadata');
      // Match music-metadata 11.16.1 MP4Parser's trkn/disk conversion exactly (including its byte-width behavior).
      value = `${bytes[3]}/${bytes[5]}`;
    }
    const number = CommonTagMapper.normalizeTrack(value).no;
    if (number !== null && !Number.isSafeInteger(number)) throw new Error('invalid-track-metadata');
    const key = tag.field as keyof typeof result;
    if (number === null) delete result[key]; else result[key] = number;
  }
  return JSON.stringify(result);
}
