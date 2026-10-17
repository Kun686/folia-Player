import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { searchPlaybackFixture } from './search-playback-fixture';

// catalog-player-lifetime.spec.ts — offline lifecycle races; never installed in the signed-in simulator.
async function delayedResources(page: Page, provider: 'qq' | 'netease', startup: boolean) {
  await searchPlaybackFixture(page);
  await page.addInitScript(({ provider, startup }) => {
    const w = window as any, bridge = w.Capacitor.nativePromise;
    const song = { id: 100, name: '生命周期离线样本', artists: [{ id: 1, name: '测试歌手' }],
      album: { id: 1, name: '专辑' }, durationMs: 180000,
      sourceRef: { kind: 'online', providerId: provider, mediaId: provider === 'qq' ? 'qq-100' : '100' } };
    const restored = { queue: [song], index: 0, currentSong: song, position: 15, playing: false };
    localStorage.setItem('folia_transition_animation', 'false');
    localStorage.setItem('folia_transition_animation_card', 'false');
    w.lifetimePending = [];
    w.lifetimeCalls = [];
    w.lifetimeMutations = [];
    w.lifetimeSeed = () => w.fixtureEmitPlayback(restored);
    if (startup) Object.assign(w.fixturePlayback, restored);
    w.lifetimeRelease = () => {
      w.lifetimeReleased = true;
      w.lifetimePending.splice(0).forEach((resolve: () => void) => resolve());
    };
    w.Capacitor.nativePromise = async (plugin: string, method: string, options: any) => {
      if (method === 'health' && startup) await new Promise<void>(resolve => { w.lifetimeHealth = resolve; });
      if (['readLyricCache', 'songCover'].includes(method)) {
        w.lifetimeCalls.push(method);
        if (!w.lifetimeReleased) await new Promise<void>(resolve => w.lifetimePending.push(resolve));
      }
      if (['configure', 'clearSession', 'setQueue', 'selectQueue', 'editQueue', 'command'].includes(method)) {
        w.lifetimeMutations.push(method);
      }
      return bridge(plugin, method, options);
    };
  }, { provider, startup });
}

for (const provider of ['netease', 'qq'] as const) {
  for (const startup of [true, false]) {
    test(`${provider}: ${startup ? 'capability discovery' : 'catalog navigation'} keeps pending player lyrics and cover`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await delayedResources(page, provider, startup);
      await page.goto('/mobile.html');
      if (!startup) {
        await page.getByRole('button', { name: provider === 'qq' ? 'QQ 音乐' : '网易云', exact: true }).tap();
        await expect(page.getByText(provider === 'qq' ? 'QQ fixture' : '测试用户', { exact: true })).toBeVisible();
        await page.evaluate(() => (window as any).lifetimeSeed());
      }
      await expect.poll(() => page.evaluate(() => (window as any).lifetimeCalls)).toContain('readLyricCache');
      await expect.poll(() => page.evaluate(() => (window as any).lifetimeCalls)).toContain('songCover');
      const before = await page.evaluate(() => structuredClone((window as any).fixturePlayback));
      if (startup) {
        await page.evaluate(() => (window as any).lifetimeHealth());
        await expect(page.getByText('测试用户', { exact: true })).toBeVisible();
      } else {
        await page.getByRole('button', { name: provider === 'qq' ? '网易云' : 'QQ 音乐', exact: true }).tap();
        await expect(page.getByText(provider === 'qq' ? '测试用户' : 'QQ fixture', { exact: true })).toBeVisible();
      }
      await page.evaluate(() => (window as any).lifetimeRelease());
      await page.locator('.mini-player').getByRole('button', { name: /生命周期离线样本/ }).tap();
      const panel = page.locator('.player-panel');
      // The active NetEase line has separate base/highlight spans for each character.
      await expect(panel.locator('.lyric-stage')).toContainText(provider === 'qq' ? '合成测试' : /第+二+句+/);
      await expect(panel.getByRole('alert')).toHaveCount(0);
      await expect(panel.locator('.track-art img')).toBeVisible();
      expect(await panel.locator('.track-art img').evaluate(node => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
      expect(await page.evaluate(() => (window as any).fixturePlayback)).toEqual(before);
      expect(await page.evaluate(() => (window as any).lifetimeMutations)).toEqual([]);
      expect(errors).toEqual([]);
    });
  }
}
