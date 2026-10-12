import { expect, test, clickPlayerTool } from './fixtures';

// transition-preference.spec.ts — controlled capabilities exercise settings, not model/device acceptance.
test('performance preference reaches native settings, rolls back on failure and survives capability changes', async ({ page }) => {
  await page.addInitScript(() => {
    const win = window as any;
    win.fixtureNoServer = true;
    Object.assign(win.fixtureTransition, { enabled: true, performance: true });
    Object.assign(win.fixtureModels.capabilities, { beatGrid: true, stems: true, full: true });
  });
  await page.goto('/mobile.html');
  await page.getByRole('button', { name: '导入音乐', exact: true }).tap();
  await page.getByRole('button', { name: '播放 本地测试音乐', exact: true }).tap();
  await clickPlayerTool(page, 'Folia 智能过渡');
  const dialog = page.getByRole('dialog', { name: 'Folia 智能过渡' });
  const toggle = dialog.getByRole('button', { name: '表现模式', exact: true });
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await toggle.tap();
  await expect.poll(() => page.evaluate(() => (window as any).fixtureTransition.performance)).toBe(false);
  await page.evaluate(() => { (window as any).fixtureTransitionFailure = true; });
  await toggle.tap();
  await expect(dialog.getByRole('alert')).toContainText('过渡设置未能应用');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await page.evaluate(() => { (window as any).fixtureTransitionFailure = false; });
  await toggle.tap();
  await expect.poll(() => page.evaluate(() => (window as any).fixtureTransition.performance)).toBe(true);
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await page.evaluate(() => {
    const win = window as any;
    Object.assign(win.fixtureModels.capabilities, { stems: false, full: false }); win.fixtureEmitModels();
  });
  await expect(toggle).toBeDisabled();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => (window as any).fixtureTransition.performance)).toBe(true);
  await page.evaluate(() => {
    const win = window as any;
    Object.assign(win.fixtureModels.capabilities, { stems: true, full: true }); win.fixtureEmitModels();
  });
  await expect(toggle).toBeEnabled();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
});

test('installed model files do not open the unaccepted performance control', async ({ page }) => {
  await page.addInitScript(() => {
    const win = window as any;
    win.fixtureNoServer = true;
    win.fixtureTransition = { enabled: true, mode: 'automix', crossfadeMaxSec: 17 };
    localStorage.setItem('folia_transition_performance', 'true');
    for (const model of win.fixtureModels.models) Object.assign(model, { installed: true, phase: 'installed', received: model.bytes });
    win.fixtureModels.capabilities.beatGrid = true;
  });
  await page.goto('/mobile.html');
  await page.getByRole('button', { name: '导入音乐', exact: true }).tap();
  await page.getByRole('button', { name: '播放 本地测试音乐', exact: true }).tap();
  await clickPlayerTool(page, 'Folia 智能过渡');
  const dialog = page.getByRole('dialog', { name: 'Folia 智能过渡' });
  const toggle = dialog.getByRole('button', { name: '表现模式', exact: true });
  await expect(toggle).toBeDisabled();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(dialog.getByText('分轨功能仍在验证中，暂未开放。', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('folia_transition_performance'))).toBe('false');
});
