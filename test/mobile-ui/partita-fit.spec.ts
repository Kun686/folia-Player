import { test, expect, clickPlayerTool } from './fixtures';
import type { Page } from '@playwright/test';
import { BASE_DUAL_THEME } from '../../src/services/baseThemes';

// partita-fit.spec.ts — measure the actual animated body against its mobile stage, including narrow iPad panels.
const phrase = '合成加密歌词导入验收';
async function openPartita(page: Page, words = [phrase], intensity = 'normal', fontScale = 1) {
  await page.addInitScript(({ words, intensity, fontScale, theme }) => {
    const w = window as any;
    w.fixtureNoServer = true;
    localStorage.setItem('custom_dual_theme', JSON.stringify({ light: { ...theme.light, animationIntensity: intensity },
      dark: { ...theme.dark, animationIntensity: intensity } }));
    localStorage.setItem('last_applied_theme_pointer', 'custom');
    localStorage.setItem('lyrics_font_scale', String(fontScale));
    localStorage.setItem('lyrics_font_weight', '700');
    w.fixtureLocalLyric = { fileName: 'acceptance.krc',
      content: '[0,8000]' + words.map((word, i) => `<${Math.floor(i * 8000 / words.length)},${Math.floor(8000 / words.length)},0>${word}`).join('')
        + '\n[9000,8000]<0,8000,0>下一句', lyricsSource: 'local' };
  }, { words, intensity, fontScale, theme: BASE_DUAL_THEME });
  await page.goto('/mobile.html');
  await page.getByRole('button', { name: '导入音乐', exact: true }).tap();
  await page.getByRole('button', { name: '播放 本地测试音乐', exact: true }).tap();
  await expect(page.locator('.player-heading').getByRole('heading', { name: '本地测试音乐', exact: true })).toBeVisible();
  await clickPlayerTool(page, '歌词与动效');
  await page.getByLabel('歌词动画', { exact: true }).selectOption('partita');
  await page.locator('.visual-settings > header').getByRole('button', { name: '关闭', exact: true }).tap();
  await page.evaluate(() => (window as any).fixtureEmitPlayback({ playing: false, position: 2 }));
}
async function sampleBounds(page: Page) {
  return page.locator('.lyric-stage').evaluate(async stage => {
    let overflow = 0, visible = 0;
    for (let frame = 0; frame < 40; frame++) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      const bounds = stage.getBoundingClientRect();
      for (const node of stage.querySelectorAll<HTMLElement>('[data-partita-fit-word] > span.relative.z-10')) {
        if (Number(getComputedStyle(node.parentElement!).opacity) < 0.95
          || Number(getComputedStyle(node.closest('[data-partita-fit-chunk]')!).opacity) < 0.95) continue;
        const text = node.getBoundingClientRect(); visible++;
        overflow = Math.max(overflow, bounds.left - text.left, text.right - bounds.right,
          bounds.top - text.top, text.bottom - bounds.bottom);
      }
    }
    return { overflow, visible };
  });
}
const bodies = (page: Page) => page.locator('.lyric-stage [data-partita-fit-word] > span.relative.z-10');
async function expectContained(page: Page) {
  const measured = await sampleBounds(page);
  expect(measured.visible).toBeGreaterThan(0);
  expect(measured.overflow).toBeLessThanOrEqual(1);
  return measured;
}
test('a single long KRC word stays inside the actual lyric stage', async ({ page }, info) => {
  await openPartita(page);
  await expect(bodies(page)).toHaveText(phrase);
  const bounds = await expectContained(page);
  await page.screenshot({ path: `.mobile-test-results/partita-fit-${info.project.name}.png` });
  await info.attach('body-bounds', { body: JSON.stringify(bounds), contentType: 'application/json' });
});

test('English and graphemes remain intact while the host rotates and resizes', async ({ page }, info) => {
  const text = 'Uncharacteristically—café👨‍👩‍👧‍👦';
  const original = page.viewportSize()!;
  await openPartita(page, [text], 'chaotic', 1.8);
  await expect(bodies(page)).toHaveText(text);
  await expectContained(page);
  await page.setViewportSize({ width: 844, height: 390 });
  await expectContained(page);
  await page.setViewportSize(original);
  await expectContained(page);
  await expect(bodies(page)).toHaveText(text);
  await page.screenshot({ path: `.mobile-test-results/partita-fit-unicode-${info.project.name}.png` });
});

test('multiple words, forward/backward seeking and short lines retain the original motion', async ({ page }) => {
  const words = ['春风', '又绿', '江南岸', 'the ', 'unbelievable ', 'moonlight'];
  await openPartita(page, words, 'chaotic');
  await expect(bodies(page)).toHaveText(words);
  for (const position of [1, 4, 7]) {
    await page.evaluate(position => (window as any).fixtureEmitPlayback({ playing: false, position }), position);
    await expectContained(page);
  }
  await page.evaluate(() => (window as any).fixtureEmitPlayback({ playing: false, position: 10 }));
  await expect(bodies(page)).toHaveText(['下一句']);
  await expectContained(page);
  await page.evaluate(() => (window as any).fixtureEmitPlayback({ playing: false, position: 2 }));
  await expect(bodies(page)).toHaveText(words);
  await expectContained(page);
  expect(await page.evaluate(() => (window as any).fixtureCommands)).toEqual([]);
});

test('fitting leaves a short calm phrase at its original size when space permits', async ({ page }) => {
  await openPartita(page, ['歌'], 'calm');
  await expect(bodies(page)).toHaveText('歌');
  await expectContained(page);
  await expect(page.locator('[data-partita-fit]')).toHaveCSS('transform', 'none');
});
