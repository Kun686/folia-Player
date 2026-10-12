import { test, expect } from './fixtures';

// amll-live.spec.ts — opt-in public API transport/parser proof, not an account or physical-device test.
test('official AMLL search and TTML parsing work in WebKit without a gateway or credentials', async ({ page }, info) => {
  test.skip(process.env.FOLIA_AMLL_LIVE !== '1', 'Public network check must be explicitly selected.');
  const requests: string[] = [];
  page.on('request', request => {
    if (!request.url().startsWith('https://api.amll.dev/')) return;
    expect(request.headers()).not.toHaveProperty('cookie');
    expect(request.headers()).not.toHaveProperty('authorization');
    requests.push(request.url());
  });
  await page.goto('/mobile.html');
  const result = await page.evaluate(async () => {
    const path = '/src/utils/lyrics/providers/amllDbProvider.ts';
    const api = await import(/* @vite-ignore */ path);
    const items = await api.searchAmllDbSongs({ musicName: 'Idol', artistName: 'YOASOBI' }, 1);
    const id = items?.[0]?.ncmMusicIds?.[0];
    if (!id) throw new Error('No public catalog result');
    const lyrics = await api.fetchAmllDbLyrics('ncm', id);
    return { id, count: items.length, lines: lyrics?.lines.length, wordByWord: lyrics?.isWordByWord };
  });
  expect(result.lines).toBeGreaterThan(0);
  expect(result.wordByWord).toBe(true);
  expect(requests).toHaveLength(2);
  await info.attach('public-api-summary', { body: JSON.stringify({ result, requests }), contentType: 'application/json' });
});
