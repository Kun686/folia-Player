import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { extname, join } from 'node:path';

// stem-codec-reference.spec.ts — the actual original cutWindow on the same encoded bytes used by XCTest.
test('capture original compressed media windows', async ({ page }) => {
  test.skip(process.env.FOLIA_STEM_CODEC_REFERENCE !== '1', 'Explicit reference generation only');
  test.setTimeout(60_000);
  const directory = process.env.FOLIA_STEM_CODEC_INPUTS;
  if (!directory) throw new Error('Set FOLIA_STEM_CODEC_INPUTS to the generated input directory');
  const manifest: Array<{ name: string; file: string; rate: number; sha256: string }> = JSON.parse(await readFile(join(directory, 'inputs.json'), 'utf8'));
  await page.goto('/mobile.html');
  const cases = [];
  for (const row of manifest) {
    const bytes = await readFile(row.file), base64 = bytes.toString('base64');
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(row.sha256);
    const windows = await page.evaluate(async encoded => {
      const path = '/src/services/automix/stems.ts';
      const { cutWindow } = await import(path);
      const windows = [];
      for (const role of ['head', 'tail']) {
        const input = Uint8Array.from(atob(encoded), value => value.charCodeAt(0)).buffer;
        const result = await cutWindow(input, role);
        if (!result) throw new Error(`Original decoder rejected ${role}`);
        const frames = result.left.length;
        // Cover the priming/padding edges densely, and every 1024-frame region through the whole window.
        const indices = [...new Set([
          ...Array.from({ length: Math.min(2048, frames) }, (_, i) => i),
          ...Array.from({ length: Math.min(2048, frames) }, (_, i) => frames - 1 - i),
          ...Array.from({ length: Math.ceil(frames / 1024) }, (_, i) => i * 1024),
        ])].sort((a, b) => a - b);
        const channels = [result.left, result.right] as Float32Array[];
        const hashes = await Promise.all(channels.map(async channel => {
          const digest = await crypto.subtle.digest('SHA-256', channel.slice().buffer);
          return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
        }));
        windows.push({ role, frames, start: result.start, indices, hashes,
          channels: channels.map(channel => indices.map(i => channel[i])) });
      }
      return windows;
    }, base64);
    cases.push({ name: row.name, rate: row.rate, ext: extname(row.file).slice(1), base64, digest: row.sha256,
      totalFrames: windows[1].start + windows[1].frames, windows });
  }
  expect(cases.map(row => row.name)).toEqual(['aac48', 'aac-mono', 'alac44', 'flac48']);
  await writeFile('ios/App/NativeTests/StemCodecReference.json', JSON.stringify({
    generator: 'WebKit original cutWindow; generated tones through macOS afconvert, no platform music', cases,
  }) + '\n');
});
