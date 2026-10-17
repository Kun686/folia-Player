import type { Page } from '@playwright/test';

// playerQueueFixture.ts — verified public QQ metadata with controlled transport, not audio acceptance.
export const queue = [
  { id: '001fsNdn1zuZnA', name: '我不难过', artists: [{ id: '001pWERg3vFgg8', name: '孙燕姿' }], album: { id: '004VSvF52mQoQp', name: '未完成' }, durationMs: 320000,
    sourceRef: { kind: 'online', providerId: 'qq', mediaId: '001fsNdn1zuZnA' } },
  { id: '000BO3xy4fd8BJ', name: '我怀念的', artists: [{ id: '001pWERg3vFgg8', name: '孙燕姿' }], album: { id: '000P3l050Olt27', name: '逆光' }, durationMs: 289000,
    sourceRef: { kind: 'online', providerId: 'qq', mediaId: '000BO3xy4fd8BJ' } },
  { id: '001WsiXr4FYlao', name: '我想我不会爱你', artists: [{ id: '001ByAsv3XCdgm', name: '田馥甄' }], album: { id: '0021s3aX36BCI1', name: 'To Hebe' }, durationMs: 281000,
    sourceRef: { kind: 'online', providerId: 'qq', mediaId: '001WsiXr4FYlao' } },
];
export async function seed(page: Page) {
  await page.evaluate(async songs => {
    const w = window as any;
    for (const song of songs) await w.Capacitor.nativePromise('FoliaNative', 'writeLyricCache', { song, token: 'initial', field: 'state', value: {
      lyricsSource: 'online', hasOnlineOverride: true, onlineOverrideLyrics: { lines: [] },
    } });
    w.fixtureEmitPlayback({ queue: songs, index: 0, currentSong: songs[0], position: 45, duration: 320, playing: false });
    w.fixtureQueueOperations = [];
    const native = w.Capacitor.nativePromise;
    w.Capacitor.nativePromise = async (plugin: string, method: string, options: any) => {
      if (['setQueue', 'selectQueue', 'editQueue'].includes(method)) {
        w.fixtureQueueOperations.push(method);
        if (w.fixtureRejectSelection && method === 'selectQueue') throw new Error('queue-changed');
      }
      return native(plugin, method, options);
    };
  }, queue);
}
