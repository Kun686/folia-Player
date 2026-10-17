import { test, expect, clickPlayerTool, openPlayerTools } from './fixtures';
import { queue, seed } from './playerQueueFixture';

// live-settings-layout.spec.ts — real QQ metadata with a controlled bridge; layout/lifetime checks, not audio acceptance.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).fixtureNoServer = true;
    if (sessionStorage.getItem('live-settings-seeded')) return;
    localStorage.setItem('playback_entry_view', 'player');
    localStorage.setItem('playback_entry_view_chosen', 'true');
    localStorage.setItem('visualizer_mode', 'classic');
    sessionStorage.setItem('live-settings-seeded', 'true');
  });
  await page.goto('/mobile.html'); await seed(page);
});

test('unified player menu retains tools and compact settings across rotation', async ({ page }, info) => {
  await page.locator('.mini-title').tap();
  await expect(page.locator('.player-heading-actions button')).toHaveCount(1);
  await openPlayerTools(page);
  const tools = page.getByRole('dialog', { name: '更多播放选项', exact: true });
  for (const name of ['歌词与动效', '队列拼贴', '歌词']) {
    await expect(tools.getByRole('button', { name, exact: true })).toBeVisible();
  }
  await expect(tools.locator('.audio-controls')).toBeVisible();
  await expect(tools.locator('.player-options button')).toHaveCount(4);
  await page.screenshot({ path: info.outputPath('unified-menu.png') });
  await clickPlayerTool(page, '歌词与动效');
  const panel = page.getByRole('dialog', { name: '歌词与动效', exact: true });
  await expect(panel).toHaveCSS('opacity', '1');
  await panel.getByRole('combobox', { name: '歌词动画', exact: true }).selectOption('monet');
  const size = page.viewportSize()!;
  const samples = [];
  for (const viewport of [size, { width: size.height, height: size.width }, size]) {
    await page.setViewportSize(viewport);
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(viewport.width);
    for (const button of await panel.locator('.playback-view-options button').all()) {
      await expect.poll(async () => (await button.boundingBox())!.height).toBeLessThanOrEqual(60);
      expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    samples.push(await panel.evaluate(element => ({
      viewport: [innerWidth, innerHeight],
      boxes: [...element.querySelectorAll('.visual-quick-settings, .playback-view-preference, .playback-view-options, .playback-view-options button')].map(el => {
        const style = getComputedStyle(el);
        return { className: el.className, tag: el.tagName, height: el.getBoundingClientRect().height,
          minHeight: style.minHeight, display: style.display, gridTemplateRows: style.gridTemplateRows, alignContent: style.alignContent };
      }),
    })));
    await page.screenshot({ path: info.outputPath(`top-${viewport.width}.png`) });
  }
  await info.attach('rotation-dimensions', { body: JSON.stringify(samples, null, 2), contentType: 'application/json' });
});

for (const theme of ['dark', 'light']) test(`mobile switches separate track from touch area on ${theme} chrome`, async ({ page }, info) => {
  await page.locator('.brand').getByRole('button', { name: '设置', exact: true }).tap();
  const settings = page.getByRole('dialog', { name: '设置', exact: true });
  await settings.getByRole('combobox', { name: /^主题/ }).selectOption(theme);
  const preference = settings.locator('input.preference-switch').first();
  await expect(preference).toHaveCSS('height', '44px');
  expect(await preference.evaluate(el => getComputedStyle(el, '::before').height)).toBe('31px');
  await settings.getByRole('button', { name: '关闭', exact: true }).tap();
  await page.locator('.mini-title').tap();
  await clickPlayerTool(page, '歌词与动效');
  const panel = page.getByRole('dialog', { name: '歌词与动效', exact: true });
  const motion = panel.locator('.mobile-motion-settings');
  await motion.locator('summary').tap();
  const toggle = motion.getByRole('button', { name: '跟随系统设置', exact: true });
  await toggle.scrollIntoViewIfNeeded();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  const shape = await toggle.evaluate(el => {
    const box = el.getBoundingClientRect(), track = getComputedStyle(el, '::before');
    const thumb = el.firstElementChild!.getBoundingClientRect();
    return { width: box.width, height: box.height, trackWidth: track.width, trackHeight: track.height,
      thumbWidth: thumb.width, thumbHeight: thumb.height, inset: thumb.x - box.x,
      centered: Math.abs((thumb.y + thumb.height / 2) - (box.y + box.height / 2)), color: track.backgroundColor };
  });
  expect(shape).toMatchObject({ width: 51, height: 44, trackWidth: '51px', trackHeight: '31px', thumbWidth: 27, thumbHeight: 27, inset: 2 });
  expect(shape.centered).toBeLessThan(1);
  await toggle.tap();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => toggle.evaluate(el => el.firstElementChild!.getBoundingClientRect().x - el.getBoundingClientRect().x)).toBe(22);
  expect(await toggle.evaluate(el => getComputedStyle(el, '::before').backgroundColor)).not.toBe(shape.color);
  expect(await page.evaluate(() => localStorage.getItem('reduce_motion_follow_system'))).toBe('true');
  await page.screenshot({ path: info.outputPath(`switches-${theme}.png`) });
  const size = page.viewportSize()!;
  await page.setViewportSize({ width: size.height, height: size.width });
  await toggle.scrollIntoViewIfNeeded();
  await expect(toggle).toHaveCSS('width', '51px');
  await expect(toggle).toHaveCSS('height', '44px');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await toggle.locator('div').evaluate(el => getComputedStyle(el).transitionDuration)).toBe('0s');
  await toggle.tap();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => localStorage.getItem('reduce_motion_follow_system'))).toBe('false');
  expect(await page.evaluate(() => (window as any).fixtureCommands)).toEqual([]);
});

test('orientation changes release only the live panel native picker focus', async ({ page }) => {
  await page.locator('.mini-title').tap();
  await clickPlayerTool(page, '歌词与动效');
  const panel = page.getByRole('dialog', { name: '歌词与动效', exact: true });
  const picker = panel.getByRole('combobox', { name: '歌词动画', exact: true });
  await picker.focus();
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await expect(picker).toBeFocused();
  const rotate = () => page.evaluate(() => {
    const orientation = window.screen.orientation;
    (orientation ?? window).dispatchEvent(new Event(orientation ? 'change' : 'orientationchange'));
  });
  await rotate();
  await expect(picker).not.toBeFocused();
  await expect(picker).toHaveValue('classic');
  const close = panel.locator('header').getByRole('button', { name: '关闭', exact: true });
  await close.focus(); await rotate(); await expect(close).toBeFocused();
  await picker.selectOption('monet');
  await expect(page.locator('.lyric-stage').getByText(queue[0].name, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).fixtureCommands)).toEqual([]);
  expect(await page.evaluate(() => (window as any).fixtureQueueOperations)).toEqual([]);
});

test('backgrounding releases the live picker without changing settings or other focus', async ({ page }, info) => {
  await page.locator('.mini-title').tap();
  await clickPlayerTool(page, '歌词与动效');
  const panel = page.getByRole('dialog', { name: '歌词与动效', exact: true });
  const picker = panel.getByRole('combobox', { name: '歌词动画', exact: true });
  const visibility = (hidden: boolean) => page.evaluate(value => {
    Object.defineProperty(document, 'hidden', { configurable: true, value });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
  const baseline = await page.evaluate(() => JSON.stringify((window as any).fixturePlayback));
  await picker.focus();
  await visibility(false);
  await expect(picker).toBeFocused();
  await visibility(true);
  await expect(picker).not.toBeFocused();
  await visibility(false);
  await expect(picker).not.toBeFocused();
  await expect(picker).toHaveValue('classic');
  await expect(panel).toBeVisible();

  // Backgrounding must not steal focus from ordinary controls or from the separate theme editor.
  const close = panel.locator('header').getByRole('button', { name: '关闭', exact: true });
  await close.focus(); await visibility(true); await expect(close).toBeFocused(); await visibility(false);
  await panel.getByRole('button', { name: 'Theme Park · 主题编辑', exact: true }).tap();
  const editor = page.getByRole('dialog', { name: 'Theme Park · 主题编辑', exact: true });
  const field = editor.getByLabel('HEX', { exact: true });
  await field.focus(); await visibility(true); await expect(field).toBeFocused(); await visibility(false);
  await editor.locator('header').getByRole('button', { name: '取消', exact: true }).tap();
  await expect(panel).toBeVisible();
  await picker.focus(); await visibility(true); await expect(picker).not.toBeFocused(); await visibility(false);
  await page.screenshot({ path: info.outputPath('picker-returned.png') });
  await close.tap();
  await visibility(true); await visibility(false);
  await expect(panel).toHaveCount(0);
  expect(await page.evaluate(() => JSON.stringify((window as any).fixturePlayback))).toBe(baseline);
  expect(await page.evaluate(() => (window as any).fixtureCommands)).toEqual([]);
  expect(await page.evaluate(() => (window as any).fixtureQueueOperations)).toEqual([]);
});

test('live settings retain the renderer, apply opacity immediately and survive rotation/reopening', async ({ page }, info) => {
  await page.locator('.mini-title').tap();
  const shell = page.locator('.lyric-stage > div').first();
  await expect(shell).toHaveCSS('opacity', '1');
  const original = await shell.elementHandle();
  await clickPlayerTool(page, '歌词与动效');
  const settings = page.getByRole('dialog', { name: '歌词与动效', exact: true });
  await expect(settings).toBeVisible();
  await expect(settings).toHaveCSS('opacity', '1');
  for (const control of await settings.locator('.visual-mode-fields select').all()) expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await original!.evaluate(el => el.isConnected)).toBe(true);
  await expect(page.locator('.lyric-stage .empty-lyrics')).toHaveCount(0);
  const size = page.viewportSize()!;
  const rect = (await settings.boundingBox())!;
  expect(rect.height).toBeLessThan(size.height * .57);
  if (size.width >= 768) { expect(rect.width).toBeLessThan(size.width / 2); expect(rect.x).toBeGreaterThan(size.width / 2); }
  await expect(page.locator('.live-settings-host')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await page.screenshot({ path: info.outputPath('live-panel.png') });
  const common = settings.locator('.typography-controls > details').first();
  await common.locator('summary').tap();
  const opacity = common.getByRole('slider', { name: /透明度/ });
  await opacity.fill('0.55');
  await expect(shell).toHaveCSS('opacity', '0.55');
  expect(await original!.evaluate(el => el.isConnected)).toBe(true);
  await page.setViewportSize({ width: size.height, height: size.width });
  const rotated = (await settings.boundingBox())!;
  expect(rotated.x).toBeGreaterThanOrEqual(0);
  expect(rotated.y).toBeGreaterThanOrEqual(0);
  expect(rotated.y + rotated.height).toBeLessThanOrEqual(size.width + 1);
  await expect(settings).toHaveJSProperty('scrollWidth', await settings.evaluate(el => el.clientWidth));
  await page.screenshot({ path: info.outputPath('live-panel-rotated.png') });
  await settings.locator('header').getByRole('button', { name: '关闭', exact: true }).tap();
  await expect(settings).toHaveCount(0);
  expect(await original!.evaluate(el => el.isConnected)).toBe(true);
  expect(await page.evaluate(() => (window as any).fixtureCommands)).toEqual([]);
  expect(await page.evaluate(() => (window as any).fixtureQueueOperations)).toEqual([]);
  await page.reload(); await seed(page); await page.locator('.mini-title').tap();
  await expect(page.locator('.lyric-stage > div').first()).toHaveCSS('opacity', '0.55');
});

test('collage settings switch the actual stage and preserve theme editor cancel semantics', async ({ page }, info) => {
  await page.locator('.brand').getByRole('button', { name: '队列拼贴', exact: true }).tap();
  await page.locator('.mobile-lattice-tools').getByRole('button', { name: '歌词与动效', exact: true }).tap();
  const settings = page.getByRole('dialog', { name: '歌词与动效', exact: true });
  await expect(page.locator('.mobile-lattice')).toBeVisible();
  await settings.getByRole('combobox', { name: '歌词动画', exact: true }).selectOption('monet');
  await expect(page.locator('.mobile-lattice')).toHaveCount(0);
  await expect(page.locator('.lyric-stage').getByText(queue[0].name, { exact: true })).toBeVisible();
  await expect(settings).toBeVisible();
  await page.screenshot({ path: info.outputPath('mode-updates-behind-settings.png') });
  const saved = await page.evaluate(() => localStorage.getItem('custom_dual_theme'));
  await settings.getByRole('button', { name: 'Theme Park · 主题编辑', exact: true }).tap();
  const editor = page.getByRole('dialog', { name: 'Theme Park · 主题编辑', exact: true });
  await expect(editor).toBeVisible();
  await editor.getByLabel('HEX', { exact: true }).fill('#123456');
  await editor.getByLabel('HEX', { exact: true }).blur();
  await editor.locator('header').getByRole('button', { name: '取消', exact: true }).tap();
  await expect(settings).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('custom_dual_theme'))).toBe(saved);
  await settings.locator('header').getByRole('button', { name: '关闭', exact: true }).tap();
  expect(await page.evaluate(() => (window as any).fixturePlayback.queue.map((song: any) => song.id))).toEqual(queue.map(song => song.id));
});

test('queue prioritizes songs and hides destructive actions until requested', async ({ page }, info) => {
  await page.locator('.mini-title').tap();
  await page.locator('.player-controls').getByRole('button', { name: '播放队列', exact: true }).tap();
  const panel = page.locator('.player-queue-host');
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('button', { name: '清空队列', exact: true })).not.toBeVisible();
  await expect(panel.getByRole('combobox')).toHaveCount(0);
  await expect(panel.getByRole('button', { name: '播放 我想我不会爱你', exact: true })).toBeInViewport();
  await page.screenshot({ path: info.outputPath('compact-queue.png') });
  await panel.getByRole('button', { name: '搜索范围', exact: true }).tap();
  await expect(panel.getByRole('combobox')).toBeVisible();
  await panel.getByRole('textbox').fill('我怀念的');
  await panel.getByRole('button', { name: '播放 我怀念的', exact: true }).tap();
  expect(await page.evaluate(() => (window as any).fixtureQueueOperations)).toEqual(['selectQueue']);
  expect(await page.evaluate(() => (window as any).fixturePlayback.queue.map((song: any) => song.id))).toEqual(queue.map(song => song.id));
  await panel.locator('.queue-menu summary').tap();
  await expect(panel.getByRole('button', { name: '清空队列', exact: true })).toBeVisible();
  page.once('dialog', dialog => dialog.dismiss());
  await panel.getByRole('button', { name: '清空队列', exact: true }).tap();
  expect(await page.evaluate(() => (window as any).fixtureQueueOperations)).toEqual(['selectQueue']);
});
