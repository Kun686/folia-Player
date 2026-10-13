import type { Page } from '@playwright/test';
import type { VisualizerMode } from '../../src/types';

// online-visualizer-fixture.ts — original renderers over native-cache-shaped online lyrics, with synthetic playback only.
export const rotationLyric = '晚风轻轻吹过窗前我们听着同一首歌等待星光慢慢落下';
export async function openOnlineVisualizer(page: Page, providerId: 'qq' | 'netease', mode: VisualizerMode) {
  await page.addInitScript(mode => { localStorage.setItem('visualizer_mode', mode); }, mode);
  await page.goto('/mobile.html');
  await page.evaluate(async ({ providerId, text }) => {
    const w = window as any;
    const song = { id: 42, name: '旋转检查歌曲', artists: [{ id: 1, name: '测试歌手' }], album: { id: 1, name: '样本专辑' },
      durationMs: 180000, sourceRef: { kind: 'online', providerId, mediaId: '42' } };
    await w.Capacitor.nativePromise('FoliaNative', 'writeLyricCache', { song, token: 'initial', field: 'state', value: {
      lyricsSource: 'online', hasOnlineOverride: true,
      onlineOverrideLyrics: { lines: [{ startTime: 0, endTime: 20, fullText: text,
        words: [{ text, startTime: 0, endTime: 20 }] }] },
    } });
    w.fixtureEmitPlayback({ queue: [song], index: 0, currentSong: song, playing: false, position: 12 });
  }, { providerId, text: rotationLyric });
  await page.locator('.mini-title').tap();
}
