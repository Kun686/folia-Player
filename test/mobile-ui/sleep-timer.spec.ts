import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

// sleep-timer.spec.ts — original controls and native event reconciliation over the fixture bridge.
const timer = (page: Page) => page.getByRole('dialog', { name: '睡眠定时', exact: true });
const toggle = (page: Page) => timer(page).getByRole('switch', { name: '睡眠定时', exact: true });
async function open(page: Page) {
    await page.getByRole('button', { name: '服务器与外观', exact: true }).tap();
    await page.getByRole('button', { name: '睡眠定时', exact: true }).tap();
    await expect(toggle(page)).toBeEnabled();
}
test('zero duration, start, close, native expiry and cancellation retain original semantics', async ({ page }, info) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => { (window as any).fixtureNoServer = true; });
    await page.goto('/mobile.html'); await open(page);
    await toggle(page).tap();
    await expect(timer(page).getByText('请先输入分钟数再开启定时器', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => (window as any).fixtureSleepEdits)).toEqual([]);
    await timer(page).getByRole('textbox', { name: '小时', exact: true }).fill('1');
    await timer(page).getByRole('textbox', { name: '分钟', exact: true }).fill('5');
    await toggle(page).tap(); await expect(toggle(page)).toBeChecked();
    await expect.poll(() => toggle(page).locator('span').evaluate(node => getComputedStyle(node).left)).toBe('24px');
    const deadline = await page.evaluate(() => JSON.parse(sessionStorage.getItem('fixture-sleep')!).deadlineMs);
    expect(deadline).toBeGreaterThan(Date.now());
    await timer(page).getByRole('button', { name: '关闭', exact: true }).tap();
    await page.getByRole('button', { name: '睡眠定时', exact: true }).tap();
    await expect(toggle(page)).toBeChecked();
    expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('fixture-sleep')!).deadlineMs)).toBe(deadline);
    await page.evaluate(() => (window as any).fixtureEmitSleepTimer({ enabled: false, deadlineMs: null }));
    await expect(toggle(page)).not.toBeChecked();
    await toggle(page).tap(); await expect(toggle(page)).toBeChecked();
    await toggle(page).tap(); await expect(toggle(page)).not.toBeChecked();
    await expect.poll(() => toggle(page).locator('span').evaluate(node => getComputedStyle(node).left)).toBe('3px');
    expect(await page.evaluate(() => (window as any).fixtureSleepEdits.at(-1))).toEqual({ enabled: false });
    await page.screenshot({ path: '.mobile-test-results/sleep-timer-' + info.project.name + '.png' });
    expect(await timer(page).evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    const size = await toggle(page).boundingBox(); expect(size!.height).toBeGreaterThanOrEqual(44);
    expect(errors).toEqual([]);
});
test('failed edits roll back and controls remain reachable after rotation', async ({ page }, info) => {
    await page.addInitScript(() => { (window as any).fixtureNoServer = true; });
    await page.goto('/mobile.html'); await open(page);
    await timer(page).getByRole('textbox', { name: '分钟', exact: true }).fill('5');
    await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem('fixture-sleep')!).minutes)).toBe(5);
    await page.evaluate(() => { (window as any).fixtureSleepFailure = true; });
    await timer(page).getByRole('textbox', { name: '分钟', exact: true }).fill('8');
    await expect(timer(page).getByRole('textbox', { name: '分钟', exact: true })).toHaveValue('5');
    await expect(timer(page).getByRole('button', { name: '重试', exact: true })).toBeVisible();
    await page.evaluate(() => { (window as any).fixtureSleepFailure = false; });
    await timer(page).getByRole('button', { name: '重试', exact: true }).tap();
    await expect(toggle(page)).toBeEnabled();
    const portrait = page.viewportSize()!;
    if (info.project.name === 'phone') {
        await page.setViewportSize({ width: 320, height: 568 });
        await toggle(page).tap(); await expect(toggle(page)).toBeChecked();
        expect(await timer(page).evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
        await toggle(page).tap(); await expect(toggle(page)).not.toBeChecked();
    }
    await page.setViewportSize(info.project.name === 'phone' ? { width: 844, height: 390 } : { width: 834, height: 1194 });
    await toggle(page).tap(); await expect(toggle(page)).toBeChecked();
    expect(await timer(page).evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await page.screenshot({ path: '.mobile-test-results/sleep-timer-rotated-' + info.project.name + '.png' });
    await page.setViewportSize(portrait); await toggle(page).tap(); await expect(toggle(page)).not.toBeChecked();
    await toggle(page).tap(); await expect(toggle(page)).toBeChecked();
    await timer(page).getByRole('textbox', { name: '分钟', exact: true }).fill('0');
    await expect(toggle(page)).not.toBeChecked();
    expect(await timer(page).evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
});
