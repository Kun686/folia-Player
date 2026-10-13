import type { Page } from '@playwright/test';
import { expect } from './fixtures';
import { searchPlaybackFixture } from './search-playback-fixture';

// player-feedback-fixture.ts — shared real UI startup with controlled command rejection/delay.
export async function startFeedbackPlayback(page: Page, provider: 'qq' | 'netease', language = 'zh-CN') {
  await searchPlaybackFixture(page);
  await page.addInitScript(language => {
    const w = window as any, bridge = w.Capacitor.nativePromise;
    localStorage.setItem('folia_app_language', language);
    localStorage.setItem('folia_transition_animation', 'false');
    localStorage.setItem('folia_transition_animation_card', 'false');
    w.Capacitor.nativePromise = async (plugin: string, method: string, options: any) => {
      if (method === 'command') {
        if (w.feedbackDelay === options.action) {
          w.feedbackDelay = null;
          await new Promise<void>((_resolve, reject) => { w.feedbackReject = () => reject(new Error('old-command-failed')); });
        }
        if (w.feedbackFailure === options.action) throw new Error('command-failed');
      }
      return bridge(plugin, method, options);
    };
  }, language);
  await page.goto('/mobile.html');
  await page.getByRole('button', { name: provider === 'qq' ? 'QQ 音乐' : '网易云', exact: true }).tap();
  const search = language === 'en' ? 'Search songs' : language === 'in' ? 'Cari lagu' : '搜索歌曲';
  const play = language === 'en' ? 'Play' : language === 'in' ? 'Putar' : '播放';
  await page.getByRole('textbox', { name: search }).fill('歌曲');
  await page.getByRole('button', { name: search, exact: true }).tap();
  await page.getByRole('button', { name: `${play} ${provider === 'qq' ? 'QQ' : ''}搜索歌曲100`, exact: true }).tap();
  await expect(page.locator('.player-panel')).toHaveClass(/expanded/);
  await expect(page.locator('.player-panel').getByRole('alert')).toHaveCount(0);
  expect(new URL(page.url()).pathname).toBe('/mobile.html');
  await expect(page).toHaveTitle(/Folia/i);
}

