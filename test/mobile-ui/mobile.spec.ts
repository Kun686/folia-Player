import { test, expect } from '@playwright/test';

// test/mobile-ui/mobile.spec.ts — native bridge fixture exercises real Omni adapters and UI.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const win = window as any;
    win.CapacitorCustomPlatform = { name: 'ios' };
    let subscriber: (state: unknown) => void;
    let cacheSubscriber: () => void;
    win.fixtureCache = { settings: { enabled: false, limitGB: 5 }, count: 0, bytes: 0, pending: 0, revision: 0, error: null, songs: [] };
    let cookie = false;
    const effects = { highpass: 20, lowpass: 20000, drive: 0, crush: 0, wow: 0, noise: 0, width: 1, space: 0, punch: 0 };
    win.fixtureTransition = { enabled: false, mode: 'automix', crossfadeMaxSec: 5 };
    win.fixtureAudio = { volume: 1, isMuted: false, replayGainMode: 'off', equalizer: { enabled: false, gains: Array(10).fill(0), preset: 'flat', effects,
      customSlots: [1, 2].map(() => ({ gains: Array(10).fill(0), effects })) } };
    const song = { id: 42, name: '测试歌曲', ar: [{ id: 1, name: '测试歌手' }], al: { id: 1, name: '专辑' }, dt: 180000 };
    const state = { queue: [] as any[], index: -1, position: 0, duration: 180, playing: false, repeat: 'off', revision: 0, queueRevision: 0, currentSong: null as any,
      audioEffects: { available: true, pending: false, error: '' } };
    const localSong = { id: '11111111-1111-4111-8111-111111111111', name: '本地测试音乐', artists: [{ id: '', name: '本地歌手' }], album: { id: '', name: '' }, durationMs: 180000,
      sourceRef: { kind: 'local', mediaId: '11111111-1111-4111-8111-111111111111' }, replayGain: { trackGain: -6, albumGain: -3 } };
    let localSongs: any[] = [];
    let lyric = '[00:00.00]测试本地歌词\n[00:10.00]第二句';
    win.fixturePlayback = state;
    const emit = () => { state.revision++; subscriber?.({ ...state }); };
    win.fixtureEmitPlayback = (patch: Record<string, unknown>) => { Object.assign(state, patch); emit(); };
    const methods = ['bootstrap', 'configure', 'health', 'saveSession', 'clearSession', 'request', 'cancelRequests', 'setQueue', 'editQueue', 'selectQueue', 'command', 'getState', 'shareQR',
      'localCatalog', 'importAudio', 'localDetails', 'importLyrics', 'removeLocal', 'audioLevels', 'getAudioSettings', 'setAudioSettings', 'getTransitionSettings', 'setTransitionSettings', 'getMediaCacheSettings', 'setMediaCacheSettings', 'mediaCacheState', 'clearMediaCache'];
    win.Capacitor = {
      PluginHeaders: [{ name: 'FoliaNative', methods: [...methods.map(name => ({ name, rtype: 'promise' })), { name: 'addListener' }, { name: 'removeListener' }] }],
      nativeCallback: (_plugin: string, method: string, options: any, cb: (state: unknown) => void) => {
        if (method === 'addListener') { if (options.eventName === 'mediaCache') cacheSubscriber = cb as () => void; else subscriber = cb; } return 'callback-1';
      },
      nativePromise: async (_plugin: string, method: string, options: any) => {
        if (method === 'getMediaCacheSettings') return structuredClone(win.fixtureCache.settings);
        if (method === 'mediaCacheState') return structuredClone(win.fixtureCache);
        if (method === 'setMediaCacheSettings') {
          if (win.fixtureCacheFailure) throw new Error('cache-settings-failed');
          win.fixtureCache.settings = structuredClone(options.settings); cacheSubscriber?.();
          return structuredClone(options.settings);
        }
        if (method === 'clearMediaCache') {
          win.fixtureCache.songs = []; win.fixtureCache.count = 0; win.fixtureCache.bytes = 0; cacheSubscriber?.(); return {};
        }
        if (method === 'getTransitionSettings') return structuredClone(win.fixtureTransition);
        if (method === 'setTransitionSettings') {
          if (win.fixtureTransitionFailure) throw new Error('transition-settings-failed');
          win.fixtureTransition = structuredClone(options.settings); return structuredClone(win.fixtureTransition);
        }
        if (method === 'getAudioSettings') return structuredClone(win.fixtureAudio);
        if (method === 'setAudioSettings') {
          if (win.fixtureAudioFailure) throw new Error('audio-settings-failed');
          win.fixtureAudio = structuredClone(options.settings);
          state.audioEffects = { available: !win.fixtureEffectError, pending: false, error: win.fixtureEffectError || '' };
          emit(); return structuredClone(win.fixtureAudio);
        }
        if (method === 'health') return { protocol: 1, providers: ['netease', 'qq'] };
        if (method === 'bootstrap') return { server: win.fixtureNoServer ? '' : 'https://fixture.invalid', sessions: {} };
        if (method === 'localCatalog') return { songs: localSongs };
        if (method === 'importAudio') {
          localSongs = win.fixtureMany ? [localSong, ...[2, 3].map(i => ({ ...localSong, name: '本地音乐' + i,
            id: '00000000-0000-4000-8000-00000000000' + i,
            sourceRef: { kind: 'local', mediaId: '00000000-0000-4000-8000-00000000000' + i } }))] : [localSong];
          return { songs: localSongs, failures: [] };
        }
        if (method === 'localDetails') return win.fixtureLocalLyric || { content: lyric };
        if (method === 'importLyrics') { win.fixtureLyricImports = (win.fixtureLyricImports ?? 0) + 1; lyric = '[00:00.00]新导入的歌词\n[00:08.00]下一句'; return { content: lyric }; }
        if (method === 'removeLocal') { localSongs = []; return {}; }
        if (method === 'audioLevels') return { available: true, spectrum: Array(1024).fill(140), sampleRate: 44100 };
        if (method === 'getState') return { ...state };
        if (method === 'clearSession') { cookie = false; return {}; }
        if (method === 'setQueue' || method === 'selectQueue') {
          if (method === 'selectQueue' && options.queueRevision !== state.queueRevision) throw new Error('queue-changed');
          if (method === 'setQueue') state.queue = options.songs;
          state.index = options.index; state.currentSong = state.queue[state.index]; state.playing = true;
          state.position = 0; state.queueRevision++; emit(); return {};
        }
        if (method === 'editQueue') {
          if (win.fixtureStaleEdit) { win.fixtureStaleEdit = false; state.queueRevision++; emit(); throw new Error('queue-changed'); }
          if (options.queueRevision !== state.queueRevision) throw new Error('queue-changed');
          state.queue = options.songs; state.index = options.currentIndex; state.queueRevision++; emit(); return { ...state };
        }
        if (method === 'command') {
          if (options.action === 'play' || options.action === 'pause') state.playing = options.action === 'play';
          if (options.action === 'seek') state.position = options.position;
          if (options.action === 'repeat') state.repeat = options.mode;
          emit(); return {};
        }
        if (method !== 'request') return {};
        const path = options.payload.path as string;
        let body: any = { code: 200 };
        const profile = cookie ? { userId: 9, nickname: '测试用户', avatarUrl: '' } : null;
        if (path.startsWith('/login/qr/key')) body = { code: 200, data: { unikey: 'key' } };
        else if (path.startsWith('/login/qr/create')) body = { code: 200, data: { qrimg: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=' } };
        else if (path.startsWith('/login/qr/check')) { cookie = true; body = { code: 803, cookie: 'fixture-cookie' }; }
        else if (path.startsWith('/login/status')) body = { code: 200, data: { code: 200, profile } };
        else if (path.startsWith('/user/account')) body = { code: 200, profile, account: cookie ? { id: 9 } : null };
        else if (path.startsWith('/user/playlist')) body = { code: 200, playlist: [{ id: 8, name: '测试歌单', trackCount: 1, creator: { userId: 9 } }], more: false };
        else if (path.startsWith('/cloudsearch')) body = path.includes('fail') ? { code: 500 } : { code: 200, result: { songs: [song], songCount: 1 } };
        else if (path.startsWith('/playlist/track/all')) body = { code: 200, songs: [song] };
        else if (path.startsWith('/playlist/detail')) body = { code: 200, playlist: { id: 8, name: '测试歌单', tracks: [song], trackIds: [{ id: 42 }], trackCount: 1 } };
        else if (path.startsWith('/lyric')) body = { code: 200, lrc: { lyric: '[00:00.00]测试歌词\n[00:10.00]第二句' } };
        return { status: 200, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } };
      },
    };
  });
});
test('native transition resumes original animations from elapsed audio time without replaying snapshots', async ({ page }, info) => {
  await page.addInitScript(() => {
    (window as any).fixtureNoServer = true;
    localStorage.setItem('folia_transition_animation', 'true');
    localStorage.setItem('folia_transition_animation_card', 'true');
  });
  await page.goto('/mobile.html');
  await page.getByRole('button', { name: '导入音乐', exact: true }).click();
  await page.getByRole('button', { name: '播放 本地测试音乐', exact: true }).click();
  const ring = page.locator('div.fixed.inset-0.z-\\[170\\]');
  const border = page.locator('.mobile-transition-card canvas');
  await page.evaluate(() => (window as any).fixtureEmitPlayback({ transitionCue: {
    id: 7, seconds: 20, crossover: 0.5, periodSec: 0.5, plain: false, elapsed: 5,
  } }));
  await expect(ring).toBeVisible();
  await expect(border).toBeVisible();
  // The original card slides in from the left; measure containment after it enters.
  await expect.poll(async () => {
    const stage = await page.locator('.lyric-stage').boundingBox();
    const card = await page.locator('[data-toast-card]').boundingBox();
    const frame = await page.locator('.mobile-transition-card > div').boundingBox();
    return !!stage && !!card && !!frame && Math.abs(frame.width - card.width) < 1
      && card.x >= stage.x && card.x + card.width <= stage.x + stage.width
      && card.y + card.height <= stage.y + stage.height;
  }).toBe(true);
  await page.screenshot({ path: `.mobile-test-results/transition-animations-${info.project.name}.png` });
  await page.touchscreen.tap(10, 100);
  await expect(ring).toHaveCount(0);
  await page.evaluate(() => {
    const win = window as any;
    for (let i = 0; i < 4; i++) win.fixtureEmitPlayback({ transitionCue: {
      id: 7, seconds: 20, crossover: 0.5, periodSec: 0.5, plain: false, elapsed: 7 + i / 4,
    } });
  });
  await expect(ring).toHaveCount(0);
  await expect(border).toBeVisible();
  await page.evaluate(() => (window as any).fixtureEmitPlayback({ transitionCue: null, playing: false }));
  await expect(border).toHaveCount(0);
});

test('native transition stops visual work while hidden and resumes near its real end', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).fixtureNoServer = true;
    localStorage.setItem('folia_transition_animation', 'true');
    localStorage.setItem('folia_transition_animation_card', 'true');
  });
  await page.goto('/mobile.html');
  await page.getByRole('button', { name: '导入音乐', exact: true }).click();
  await page.getByRole('button', { name: '播放 本地测试音乐', exact: true }).click();
  const ring = page.locator('div.fixed.inset-0.z-\\[170\\]');
  const border = page.locator('.mobile-transition-card canvas');
  await page.evaluate(() => (window as any).fixtureEmitPlayback({ transitionCue: {
    id: 8, seconds: 10, crossover: 0.5, periodSec: null, plain: false, elapsed: 0,
  } }));
  await expect(ring).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
    (window as any).fixtureEmitPlayback({ transitionCue: {
      id: 8, seconds: 10, crossover: 0.5, periodSec: null, plain: false, elapsed: 7,
    } });
  });
  await expect(ring).toHaveCount(0); await expect(border).toHaveCount(0);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(ring).toBeVisible(); await expect(border).toBeVisible();
  // Only three seconds remain; starting the original ten-second animation again fails this bound.
  await expect(ring).toHaveCount(0, { timeout: 5000 });
  await expect(border).toHaveCount(0, { timeout: 1500 });
});

test('original transition settings reach native state and recover from failed edits', async ({ page }, info) => {
  await page.addInitScript(() => { (window as any).fixtureNoServer = true; });
  await page.goto('/mobile.html');
  await page.getByRole('button', { name: '导入音乐', exact: true }).click();
  await page.getByRole('button', { name: '播放 本地测试音乐', exact: true }).click();
  await page.getByRole('button', { name: 'Folia 智能过渡', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Folia 智能过渡' });
  const toggle = dialog.getByRole('button', { name: '过渡', exact: true });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect.poll(() => page.evaluate(() => (window as any).fixtureTransition.enabled)).toBe(true);
  await expect(dialog.getByText('此版本暂不支持 Automix，换歌使用交叉淡化。')).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Folia Automix/ })).toBeDisabled();
  await dialog.getByRole('button', { name: /Folia Crossfade/ }).click();
  const duration = dialog.getByRole('slider', { name: '过渡最长时长' });
  await duration.fill('12');
  await expect.poll(() => page.evaluate(() => (window as any).fixtureTransition)).toEqual({ enabled: true, mode: 'crossfade', crossfadeMaxSec: 12 });
  await page.screenshot({ path: `.mobile-test-results/transition-settings-${info.project.name}.png` });
  await page.evaluate(() => { (window as any).fixtureTransitionFailure = true; });
  await toggle.click();
  await expect(dialog.getByRole('alert')).toContainText('过渡设置未能应用');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(dialog).toHaveCount(0);
});
test('login, catalog, queue, controls and responsive layout', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/mobile.html');
  await expect(page).toHaveTitle('Folia');
  await expect(page.getByRole('heading', { name: '音乐库' })).toBeVisible();
  await page.getByRole('button', { name: '扫码登录', exact: true }).click();
  await page.getByRole('button', { name: '重新生成二维码' }).click();
  await expect(page.getByRole('img', { name: '扫码登录' })).toBeVisible();
  await expect(page.getByText('已登录', { exact: true })).toBeVisible({ timeout: 10000 });
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(page.getByText('测试用户', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '测试歌单', exact: true }).click();
  await expect(page.getByRole('button', { name: '播放 测试歌曲', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: '搜索歌曲' }).fill('测试');
  await page.getByRole('button', { name: '搜索歌曲', exact: true }).click();
  await expect(page.locator('.library-panel').getByRole('status')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '播放 测试歌曲', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '加入队列 测试歌曲' }).click();
  await page.getByRole('button', { name: '播放 测试歌曲', exact: true }).click();
  await expect(page.locator('.player-panel')).toBeVisible();
  // Lyrics loading removes the temporary message below the controls; wait for the settled playback layout.
  await expect(page.locator('.player-controls').getByText('暂无歌词', { exact: true })).toHaveCount(0);
  await page.locator('.player-panel').getByRole('button', { name: '暂停', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).fixturePlayback.playing)).toBe(false);
  await expect(page.locator('.player-panel').getByRole('button', { name: '播放', exact: true })).toBeVisible();
  if (info.project.name !== 'ipad') await page.getByRole('button', { name: '返回音乐库' }).click();
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({ path: '/tmp/folia-' + info.project.name + '.png', fullPage: false });
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(page.getByText('测试用户', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '扫码登录', exact: true })).toBeVisible();
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('fixture-cookie');
});
test('touch queue editing preserves current song and rejects stale actions', async ({ page }, info) => {
  await page.addInitScript(() => { (window as any).fixtureNoServer = true; (window as any).fixtureMany = true; });
  await page.goto('/mobile.html');
  await page.getByRole('button', { name: '导入音乐', exact: true }).click();
  await page.getByRole('button', { name: '播放 本地测试音乐', exact: true }).click();
  await expect(page.locator('.player-controls').getByText('暂无歌词', { exact: true })).toHaveCount(0);
  await page.locator('.player-panel').getByRole('button', { name: '暂停', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).fixturePlayback.playing)).toBe(false);
  if (info.project.name !== 'ipad') await page.getByRole('button', { name: '返回音乐库' }).click();
  await page.getByRole('button', { name: '播放队列 · 3' }).click();
  await page.getByRole('button', { name: '歌曲操作 本地音乐3', exact: true }).click();
  await page.getByRole('dialog', { name: '歌曲操作' }).getByRole('button', { name: '下一首播放', exact: true }).click();
  await expect(page.locator('.song-main')).toHaveText(['本地测试音乐本地歌手', '本地音乐3本地歌手', '本地音乐2本地歌手']);
  expect(await page.evaluate(() => (window as any).fixturePlayback.playing)).toBe(false);
  await page.getByRole('button', { name: '歌曲操作 本地测试音乐', exact: true }).click();
  await page.getByRole('button', { name: '从队列移除', exact: true }).click();
  await expect(page.getByRole('button', { name: '播放队列 · 2' })).toBeVisible();
  expect(await page.evaluate(() => (window as any).fixturePlayback.currentSong.name)).toBe('本地测试音乐');
  expect(await page.evaluate(() => (window as any).fixturePlayback.index)).toBe(-1);
  await page.evaluate(() => { (window as any).fixtureStaleEdit = true; });
  await page.getByRole('button', { name: '歌曲操作 本地音乐3', exact: true }).click();
  await page.getByRole('button', { name: '从队列移除', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('播放队列已变化，请重新选择歌曲。');
  await expect(page.getByRole('button', { name: '播放队列 · 2' })).toBeVisible();
  await page.getByRole('button', { name: '打乱队列', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '清空队列', exact: true }).click();
  await expect(page.getByText('播放队列为空', { exact: true })).toBeVisible();
  const current = info.project.name === 'ipad' ? page.locator('.player-controls h2') : page.locator('.mini-title strong');
  await expect(current).toHaveText('本地测试音乐');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('original ReplayGain control restores, applies touch selections and rolls back failures', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).fixtureNoServer = true;
    (window as any).fixtureAudio.replayGainMode = 'track';
  });
  await page.goto('/mobile.html');
  await page.getByRole('button', { name: '导入音乐', exact: true }).click();
  await page.getByRole('button', { name: '播放 本地测试音乐', exact: true }).click();
  const controls = page.locator('.replay-gain-controls');
  await expect(controls.getByText('T -6.0 dB / A -3.0 dB')).toBeVisible();
  await expect(controls.getByRole('button', { name: '单曲', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const album = controls.getByRole('button', { name: '专辑', exact: true });
  await album.tap();
  await expect.poll(() => page.evaluate(() => (window as any).fixtureAudio.replayGainMode)).toBe('album');
  await expect(album).toHaveAttribute('aria-pressed', 'true');
  await expect(album).toHaveCSS('background-color', 'rgba(59, 130, 246, 0.2)');
  expect((await album.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.evaluate(() => { (window as any).fixtureAudioFailure = true; });
  await controls.getByRole('button', { name: '单曲', exact: true }).tap();
  await expect(page.locator('.audio-controls [role="alert"]')).toHaveText('声音设置未能应用，已保留上次确认的设置。');
  await expect(album).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('replaygain.png') });
});

test('volume, mute and original sound controls apply and recover from native failure', async ({ page }) => {
  await page.addInitScript(() => { (window as any).fixtureNoServer = true; });
  await page.goto('/mobile.html');
  await page.getByRole('button', { name: '导入音乐', exact: true }).click();
  await page.getByRole('button', { name: '播放 本地测试音乐', exact: true }).click();
  await expect(page.locator('.player-controls').getByText('暂无歌词', { exact: true })).toHaveCount(0);
  const volume = page.getByRole('slider', { name: '音量', exact: true });
  await expect(volume).toBeEnabled();
  await page.getByRole('button', { name: '静音', exact: true }).click();
  const box = (await volume.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.35, box.y + box.height / 2);
  await expect.poll(() => page.evaluate(() => (window as any).fixtureAudio.volume)).toBeLessThan(0.6);
  expect(await page.evaluate(() => (window as any).fixtureAudio.isMuted)).toBe(true);
  await page.getByRole('button', { name: '音频效果器', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '音频效果器' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Lo-Fi', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).fixtureAudio.equalizer.preset)).toBe('lofi');
  expect(await page.evaluate(() => (window as any).fixtureAudio.equalizer.effects.wow)).toBe(0.32);
  await page.screenshot({ path: test.info().outputPath('sound-presets.png') });
  const band = dialog.getByRole('slider', { name: '31 Hz', exact: true }), bandBox = (await band.boundingBox())!;
  await page.mouse.click(bandBox.x + bandBox.width / 2, bandBox.y + bandBox.height * 0.15);
  await expect.poll(() => page.evaluate(() => (window as any).fixtureAudio.equalizer.gains[0])).toBeGreaterThan(0);
  expect(await page.evaluate(() => (window as any).fixtureAudio.equalizer.enabled)).toBe(true);
  // iOS can deliver the final input after pointerup. The latest touch value must still reach native storage.
  await dialog.getByRole('slider', { name: '1k Hz', exact: true }).evaluate(element => {
    const input = element as HTMLInputElement;
    input.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch' }));
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '7');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect.poll(() => page.evaluate(() => (window as any).fixtureAudio.equalizer.gains[5])).toBe(7);
  const space = dialog.getByRole('slider', { name: '空间混响', exact: true });
  await space.scrollIntoViewIfNeeded();
  const spaceBox = (await space.boundingBox())!;
  expect(spaceBox.width).toBeGreaterThan(100);
  expect(spaceBox.height).toBeGreaterThanOrEqual(44);
  await page.mouse.click(spaceBox.x + spaceBox.width * 0.65, spaceBox.y + spaceBox.height / 2);
  await expect.poll(() => page.evaluate(() => (window as any).fixtureAudio.equalizer.effects.space)).toBeGreaterThan(0.5);
  expect(await page.evaluate(() => (window as any).fixtureAudio.equalizer.customSlots[0].effects.space)).toBeGreaterThan(0.5);
  await page.screenshot({ path: test.info().outputPath('sound-effects.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => { (window as any).fixtureAudioFailure = true; });
  await dialog.getByRole('button', { name: '音频处理已开启', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('声音设置未能应用，已保留上次确认的设置。');
  await expect(dialog.getByRole('button', { name: '音频处理已开启', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(dialog).toHaveCount(0);
});

test('unsupported audio effects are explained without losing the selected original preset', async ({ page }) => {
  await page.addInitScript(() => { (window as any).fixtureNoServer = true; (window as any).fixtureEffectError = 'unsupported-effect-format'; });
  await page.goto('/mobile.html');
  await page.getByRole('button', { name: '导入音乐', exact: true }).click();
  await page.getByRole('button', { name: '播放 本地测试音乐', exact: true }).click();
  // Lyrics remove a status row below these controls; wait for the settled touch target as in the queue test.
  await expect(page.locator('.player-controls').getByText('暂无歌词', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '音频效果器', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '音频效果器' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Lo-Fi', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('当前音频格式不支持附加音效，将继续使用均衡器。');
  expect(await page.evaluate(() => (window as any).fixtureAudio.equalizer.effects.wow)).toBe(0.32);
  await page.evaluate(() => { (window as any).fixtureEffectError = ''; });
  await dialog.getByRole('button', { name: '音频处理已开启', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await dialog.getByRole('button', { name: '音频处理已关闭', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).fixtureAudio.equalizer.preset)).toBe('lofi');
});

test('settings and unavailable server error are visible', async ({ page }) => {
  await page.goto('/mobile.html');
  await page.locator('.brand').getByRole('button', { name: '服务器与外观' }).click();
  await page.getByLabel('HTTPS 服务器地址').fill('https://music.example.com');
  await page.getByLabel('访问凭据').fill('x'.repeat(40));
  await page.getByRole('button', { name: '保存连接' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.evaluate(() => {
    const win = window as any;
    const original = win.Capacitor.nativePromise;
    win.Capacitor.nativePromise = (plugin: string, method: string, options: unknown) => method === 'request' ? Promise.reject(new Error('network')) : original(plugin, method, options);
  });
  await page.getByRole('textbox', { name: '搜索歌曲' }).fill('fail');
  await page.getByRole('button', { name: '搜索歌曲', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
});

test('imported word lyrics keep their format and can be replaced by LRC', async ({ page }) => {
  await page.addInitScript(() => { (window as any).fixtureNoServer = true; });
  await page.goto('/mobile.html');
  await page.getByRole('button', { name: '导入音乐', exact: true }).click();
  await page.getByRole('button', { name: '播放 本地测试音乐', exact: true }).click();
  await expect(page.locator('.player-controls').getByText('暂无歌词', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '歌词与动效', exact: true }).click();
  await page.getByLabel('歌词动画', { exact: true }).selectOption('still');
  await page.locator('.visual-settings > header').getByRole('button', { name: '关闭', exact: true }).click();
  for (const source of [
    { fileName: '歌曲.YRC', content: '[0,8000](0,8000,0)逐字歌词已恢复', text: '逐字歌词已恢复' },
    { fileName: '替换.lrc', content: '[00:00.00]普通歌词已替换', text: '普通歌词已替换' },
  ]) {
    await page.evaluate(source => { (window as any).fixtureLocalLyric = source; }, source);
    await page.getByRole('button', { name: '导入歌词', exact: true }).click();
    await expect(page.locator('.lyric-stage').getByText(source.text, { exact: true })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
  }
});

test('local playback without server and original visualizer registry', async ({ page }, info) => {
  const errors: string[] = [];
  const warnings: unknown[] = [];
  page.on('console', async message => {
    if (message.type() === 'warning') for (const argument of message.args()) {
      try { const value = await argument.evaluate(v => v instanceof Error ? { name: v.name, message: v.message, stack: v.stack } : String(v)); warnings.push(value); } catch {}
    }
  });
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { (window as any).fixtureNoServer = true; });
  await page.goto('/mobile.html');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('从「文件」导入音乐即可离线播放，无需配置服务器。')).toBeVisible();
  await page.getByRole('button', { name: '导入音乐', exact: true }).click();
  await page.getByRole('button', { name: '播放 本地测试音乐', exact: true }).click();
  await expect(page.locator('.player-panel')).toBeVisible();
  // The initial lyric load changes control height; wait for it before choosing another file.
  await expect(page.locator('.player-controls').getByText('暂无歌词', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '导入歌词', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).fixtureLyricImports)).toBe(1);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: '歌词与动效', exact: true }).click();
  await expect(page.getByLabel('歌词动画', { exact: true })).toBeVisible();
  const modes = await page.getByLabel('歌词动画', { exact: true }).locator('option').evaluateAll(options => options.map(o => (o as HTMLOptionElement).value));
  expect(modes).toHaveLength(14);
  for (const mode of modes) {
    await page.getByLabel('歌词动画', { exact: true }).selectOption(mode);
    await page.locator('.visual-settings > header').getByRole('button', { name: '关闭', exact: true }).click();
    await expect(page.locator('.lyric-stage')).toBeVisible();
    if (mode === 'still') await expect(page.locator('.lyric-stage').getByText('新导入的歌词', { exact: true })).toBeVisible();
    else await expect(page.locator('.lyric-stage').locator('canvas, svg, span').first()).toBeAttached();
    await page.waitForTimeout(250);
    await page.getByRole('button', { name: '歌词与动效', exact: true }).click();
  }
  await page.getByLabel('歌词动画', { exact: true }).selectOption('monet');
  await page.getByLabel('背景效果', { exact: true }).selectOption('monet');
  await page.getByText('导入／导出外观', { exact: true }).click();
  await page.getByRole('button', { name: '生成外观短码', exact: true }).click();
  await expect(page.getByLabel('Folia 外观短码或 JSON')).toHaveValue(/^folia-theme:\/\//);
  await page.getByRole('button', { name: '应用外观配置', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.locator('.visual-settings > header').getByRole('button', { name: '关闭', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.mobile-test-results/local-visuals-' + info.project.name + '.png' });
  if (info.project.name !== 'ipad') await page.getByRole('button', { name: '返回音乐库' }).click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '移除 本地测试音乐', exact: true }).click();
  await expect(page.getByRole('button', { name: '播放 本地测试音乐', exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
  await info.attach('renderer-warnings', { body: JSON.stringify(warnings, null, 2), contentType: 'application/json' });
  console.log('Renderer diagnostics:', JSON.stringify(warnings));
});

test('paused Partita lyrics are visible after switching modes and seeking', async ({ page }) => {
  await page.addInitScript(() => { (window as any).fixtureNoServer = true; });
  await page.goto('/mobile.html');
  await page.getByRole('button', { name: '导入音乐', exact: true }).click();
  await page.getByRole('button', { name: '播放 本地测试音乐', exact: true }).click();
  await page.locator('.player-panel').getByRole('button', { name: '暂停', exact: true }).click();
  await page.getByRole('button', { name: '歌词与动效', exact: true }).click();
  await page.getByLabel('歌词动画', { exact: true }).selectOption('partita');
  await page.locator('.visual-settings > header').getByRole('button', { name: '关闭', exact: true }).click();
  // Text can be attached while every lyric chunk is transparent; inspect rendered opacity.
  const visibleChunk = () => page.locator('.lyric-stage .inline-flex.origin-center').evaluateAll(nodes =>
    nodes.some(node => Number(getComputedStyle(node).opacity) > 0.9));
  await expect.poll(visibleChunk).toBe(true);
  await page.getByRole('slider', { name: '播放进度' }).fill('12');
  await expect(page.locator('.lyric-stage .inline-flex.origin-center').first()).toContainText('第');
  await expect.poll(visibleChunk).toBe(true);
  await expect(page.locator('.player-panel').getByRole('button', { name: '播放', exact: true })).toBeVisible();
});


test('original cache controls retain offline songs and recover from rejected edits', async ({ page }, info) => {
  await page.addInitScript(() => {
    const win = window as any;
    win.fixtureNoServer = true;
    win.fixtureCache.count = 1; win.fixtureCache.bytes = 1048576;
    win.fixtureCache.songs = [{ id: 'cached', name: '离线缓存歌曲', artists: [], album: { id: '', name: '' },
      durationMs: 180000, sourceRef: { kind: 'online', providerId: 'qq', mediaId: 'cached' } }];
  });
  await page.goto('/mobile.html');
  await page.getByRole('button', { name: '媒体缓存', exact: true }).click();
  await page.getByRole('button', { name: '播放 离线缓存歌曲', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).fixturePlayback.playing)).toBe(true);
  const back = page.getByRole('button', { name: '返回音乐库', exact: true });
  if (await back.isVisible()) await back.click();
  await page.getByRole('button', { name: '服务器与外观', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '服务器与外观' });
  const toggle = dialog.getByRole('switch');
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await expect.poll(() => page.evaluate(() => (window as any).fixtureCache.settings.enabled)).toBe(true);
  await dialog.getByRole('button', { name: '缓存上限', exact: true }).click();
  await page.getByRole('option', { name: '不限制', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).fixtureCache.settings.limitGB)).toBe(0);
  await expect(page.getByRole('listbox', { name: '缓存上限', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: '清除音频缓存', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: '.mobile-test-results/cache-settings-' + info.project.name + '.png' });
  await page.evaluate(() => { (window as any).fixtureCacheFailure = true; });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(dialog.getByRole('alert')).toHaveText('缓存操作失败，请检查网络或可用空间。');
  page.once('dialog', popup => popup.accept());
  await dialog.getByRole('button', { name: '清除音频缓存', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).fixtureCache.count)).toBe(0);
  await expect.poll(() => page.evaluate(() => (window as any).fixturePlayback.playing)).toBe(true);
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(page.getByRole('button', { name: '播放 离线缓存歌曲', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
