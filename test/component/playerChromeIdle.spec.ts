import { expect, test } from './fixtures';

// playerChromeIdle.spec.ts — preserve desktop mode/persistence semantics while mobile shares the idle timer.
test('desktop cycles modes, persists them and suppresses only auto-hide pointer reveal', async ({ page, mount }) => {
    await page.clock.install();
    const root = await mount('playerChromeIdle');
    const state = root.locator('[data-hidden]');
    await page.clock.fastForward(3100);
    await expect(state).toHaveAttribute('data-hidden', 'true');
    await root.getByText('cycle', { exact: true }).click();
    await expect(root.locator('[data-mode]')).toHaveAttribute('data-mode', 'always-hidden');
    await page.mouse.move(700, 700);
    await page.clock.fastForward(100);
    await expect(state).toHaveAttribute('data-hidden', 'true');
    await root.getByText('cycle', { exact: true }).click();
    await root.getByText('suppress', { exact: true }).click();
    await page.clock.fastForward(4000);
    await expect(state).toHaveAttribute('data-hidden', 'false');
    await root.getByText('cycle', { exact: true }).click();
    await expect(state).toHaveAttribute('data-hidden', 'true');
    await expect(root.locator('[data-preference]')).toHaveAttribute('data-preference', 'true');
    expect(await page.evaluate(() => localStorage.getItem('player_chrome_visibility_mode'))).toBe('auto-hide');
    await root.getByText('suppress', { exact: true }).click();
    await expect(state).toHaveAttribute('data-hidden', 'false');
    await root.getByText('preference', { exact: true }).click();
    await page.clock.fastForward(4000);
    await expect(root.locator('[data-mode]')).toHaveAttribute('data-mode', 'always-visible');
    await expect(state).toHaveAttribute('data-hidden', 'false');
});

test('desktop drag holds, outside releases and unmount cancel the idle work', async ({ page, mount }) => {
    await page.clock.install();
    const root = await mount('playerChromeIdle');
    const state = root.locator('[data-hidden]');
    await page.mouse.move(700, 700);
    await page.mouse.down();
    await page.clock.fastForward(4000);
    await expect(state).toHaveAttribute('data-hidden', 'false');
    await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointercancel')));
    await page.clock.fastForward(3100);
    await expect(state).toHaveAttribute('data-hidden', 'true');
    await page.mouse.up();
    await page.evaluate(() => {
        window.dispatchEvent(new PointerEvent('pointerdown'));
        window.dispatchEvent(new MouseEvent('mousemove', { buttons: 0 }));
    });
    await page.clock.fastForward(100);
    await page.clock.fastForward(3100);
    await expect(state).toHaveAttribute('data-hidden', 'true');
    await root.getByText('mount toggle', { exact: true }).click();
    await expect(state).toHaveAttribute('data-hidden', 'false');
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await page.clock.fastForward(4000);
    await expect(state).toHaveAttribute('data-hidden', 'false');
});

test('saved desktop hidden mode restores with its persisted legacy preference', async ({ page, mount }) => {
    // Reproduced against unmodified 958c89c: StrictMode replays preference synchronization.
    // Keep this known desktop defect visible without expanding the mobile layout patch.
    test.fail(true, 'Existing desktop StrictMode preference restoration bug, also reproduced before extraction');
    await page.addInitScript(() => {
        localStorage.setItem('player_chrome_visibility_mode', 'always-hidden');
        localStorage.setItem('auto_hide_player_chrome', 'false');
    });
    await page.clock.install();
    const root = await mount('playerChromeIdle');
    await expect(root.locator('[data-mode]')).toHaveAttribute('data-mode', 'always-hidden', { timeout: 2000 });
    await expect(root.locator('[data-preference]')).toHaveAttribute('data-preference', 'false');
    await page.mouse.move(700, 700);
    await page.clock.fastForward(4000);
    await expect(root.locator('[data-hidden]')).toHaveAttribute('data-hidden', 'true');
});
