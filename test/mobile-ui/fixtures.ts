import { test as base, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

// fixtures.ts — one automatic native bridge fixture per test, shared across mobile UI suites.
const lyricSamples = JSON.parse(readFileSync(new URL('../../ios/App/NativeTests/OnlineLyricReference.json', import.meta.url), 'utf8'));
const qqLyricReply = lyricSamples.find((row: any) => row.name === 'qq-qrc').steps.at(-1).input.responses[0].body;

export const test = base.extend<{ nativeBridge: void }>({
  nativeBridge: [async ({ page }, use) => {
  await page.addInitScript(({ qqLyricReply }) => {
    const win = window as any;
    win.CapacitorCustomPlatform = { name: 'ios' };
    let subscriber: (state: unknown) => void;
    let sleepSubscriber: (state: unknown) => void;
    const sleepTimer = JSON.parse(sessionStorage.getItem('fixture-sleep') || 'null')
      ?? { hours: 0, minutes: 0, enabled: false, deadlineMs: null, revision: 0 };
    win.fixtureSleepEdits = [];
    win.fixtureEmitSleepTimer = (patch: Record<string, unknown>) => {
      Object.assign(sleepTimer, patch); sleepTimer.revision++;
      sessionStorage.setItem('fixture-sleep', JSON.stringify(sleepTimer)); sleepSubscriber?.({ ...sleepTimer });
    };
    let cacheSubscriber: () => void;
    const lyricSubscribers = new Map<string, (event: unknown) => void>();
    let lyricCallback = 0;
    win.fixtureEmitLyrics = (song: unknown) => lyricSubscribers.forEach(callback => callback({ song }));
    const modelSubscribers = new Map<string, () => void>();
    let modelCallback = 0;
    win.fixtureModels = { ready: true, revision: 1, analysisAvailable: true,
      capabilities: { beatGrid: false, stems: false, full: false, desktop: false },
      models: ['beat_this', 'htdemucs'].map((name, i) => ({ name, bytes: i ? 108644650 : 83077778,
        enables: i ? 'stems' : 'beatGrid', installed: false, phase: 'absent', received: 0, host: '', failures: [] })) };
    win.fixtureEmitModels = () => { win.fixtureModels.revision++; modelSubscribers.forEach(callback => callback()); };
    const catalogSubscribers = new Map<string, () => void>();
    let catalogCallback = 0;
    const catalogSubscriber = () => catalogSubscribers.forEach(callback => callback());
    win.fixtureCache = { settings: { enabled: false, limitGB: 5 }, count: 0, bytes: 0, pending: 0, revision: 0, error: null, songs: [] };
    win.fixtureCovers = { bytes: 1048576, count: 1 };
    // Start with provider lyrics; preserve a test's saved preference across navigation.
    if (localStorage.getItem('auto_use_best_lyric') === null) localStorage.setItem('auto_use_best_lyric', 'false');
    let lyricToken = 'initial';
    let lyricCache = JSON.parse(sessionStorage.getItem('fixture-lyric-cache') || '{}');
    let cookie = false;
    const effects = { highpass: 20, lowpass: 20000, drive: 0, crush: 0, wow: 0, noise: 0, width: 1, space: 0, punch: 0 };
    win.fixtureTransition = { enabled: false, mode: 'automix', crossfadeMaxSec: 5, performance: false };
    win.fixtureLyricSettings = JSON.parse(sessionStorage.getItem('fixture-lyric-settings') || 'null') ?? { localLyricsPriority: 'local' };
    win.fixtureAudio = { volume: 1, isMuted: false, replayGainMode: 'off', audioQuality: 'standard', equalizer: { enabled: false, gains: Array(10).fill(0), preset: 'flat', effects,
      customSlots: [1, 2].map(() => ({ gains: Array(10).fill(0), effects })) } };
    const song = { id: 42, name: '测试歌曲', ar: [{ id: 1, name: '测试歌手' }], al: { id: 1, name: '专辑' }, dt: 180000 };
    const state = { queue: [] as any[], index: -1, position: 0, duration: 180, playing: false, repeat: 'off', revision: 0, queueRevision: 0, currentSong: null as any,
      audioEffects: { available: true, pending: false, error: '' } };
    const localSong = { id: '11111111-1111-4111-8111-111111111111', name: '本地测试音乐', artists: [{ id: '', name: '本地歌手' }], album: { id: '', name: '' }, durationMs: 180000,
      sourceRef: { kind: 'local', mediaId: '11111111-1111-4111-8111-111111111111' }, replayGain: { trackGain: -6, albumGain: -3 } };
    let localSongs: any[] = [];
    let libraryRecord: unknown = null, libraryRevision = 0;
    win.fixtureSetLocalSongs = (songs: any[]) => { localSongs = structuredClone(songs); libraryRevision++; catalogSubscriber?.(); };
    let lyric = '[00:00.00]测试本地歌词\n[00:10.00]第二句';
    win.fixturePlayback = state;
    win.fixtureCommands = [];
    const emit = () => { state.revision++; subscriber?.({ ...state }); };
    win.fixtureEmitPlayback = (patch: Record<string, unknown>) => { Object.assign(state, patch); emit(); };
    const methods = ['getDisplaySleepSettings', 'setDisplaySleepSettings', 'chooseAudioRoute', 'getLyricSettings', 'setLyricSettings', 'startPersonalFM', 'leavePersonalFM', 'getModels', 'downloadModel', 'cancelModel', 'removeModels', 'importModel', 'bootstrap', 'configure', 'health', 'saveSession', 'clearSession', 'request', 'cancelRequests', 'setQueue', 'editQueue', 'selectQueue', 'command', 'getState', 'shareQR', 'copyText', 'shareLyricFile', 'sharePlaylistFile',
      'readLocalFolders', 'beginFolderImport', 'readFolderImport', 'prepareFolderImport', 'finishFolderImport', 'cancelFolderImport', 'removeLocalFolder',
      'readLocalLibrary', 'editLocalLibrary', 'localCatalog', 'importAudio', 'localDetails', 'readLocalLyrics', 'readLocalMatch', 'writeLocalMatch', 'selectLocalLyrics', 'importLyrics', 'pickLyricFile', 'saveLocalLyrics', 'removeLocal', 'audioLevels', 'getAudioSettings', 'setAudioSettings', 'getTransitionSettings', 'setTransitionSettings', 'getMediaCacheSettings', 'setMediaCacheSettings', 'mediaCacheState', 'clearMediaCache', 'songCover', 'coverCacheState', 'clearCoverCache',
      'readNavidromeLyrics', 'readLyricCache', 'writeLyricCache', 'lyricCacheState', 'clearLyricCache', 'listExportLyrics', 'readExportLyrics', 'shareLyricArchive', 'getSleepTimer', 'setSleepTimer', 'getAISettings', 'setAISettings', 'aiRequest', 'cancelAIRequest', 'getSyncSettings', 'setSyncSettings', 'syncRequest', 'cancelSyncRequest'];
    methods.push('getNavidromeSettings', 'setNavidromeSettings', 'navidromeRequest', 'cancelNavidromeRequest', 'navidromeArtwork', 'navidromeMutation');
    win.Capacitor = {
      PluginHeaders: [{ name: 'FoliaNative', methods: [...methods.map(name => ({ name, rtype: 'promise' })), { name: 'addListener' }, { name: 'removeListener' }] }],
      nativeCallback: (_plugin: string, method: string, options: any, cb: (state: unknown) => void) => {
        if (method === 'addListener' && options.eventName === 'lyrics') {
          const id = 'lyrics-' + ++lyricCallback; lyricSubscribers.set(id, cb); return id;
        }
        if (method === 'removeListener' && options.eventName === 'lyrics') lyricSubscribers.delete(options.callbackId);
        if (method === 'addListener' && options.eventName === 'models') {
          const id = 'models-' + ++modelCallback; modelSubscribers.set(id, cb as () => void); return id;
        }
        if (method === 'removeListener' && options.eventName === 'models') modelSubscribers.delete(options.callbackId);
        if (method === 'addListener' && options.eventName === 'localCatalog') {
          const id = 'catalog-' + ++catalogCallback; catalogSubscribers.set(id, cb as () => void); return id;
        }
        if (method === 'removeListener' && options.eventName === 'localCatalog') catalogSubscribers.delete(options.callbackId);
        if (method === 'addListener') { if (options.eventName === 'sleepTimer') sleepSubscriber = cb; else if (options.eventName === 'mediaCache') cacheSubscriber = cb as () => void; else if (options.eventName === 'playback') subscriber = cb; } return 'callback-1';
      },
      nativePromise: async (_plugin: string, method: string, options: any) => {
        if (['getNavidromeSettings', 'setNavidromeSettings', 'navidromeRequest', 'cancelNavidromeRequest', 'navidromeArtwork', 'navidromeMutation'].includes(method)) {
          if (win.fixtureNavidromeBridge) return win.fixtureNavidromeBridge(method, options);
          if (method === 'getNavidromeSettings') return { enabled: false, baseURL: '', username: '', hasPassword: false, scope: 'empty', revision: 0 };
          throw Error('navidrome-fixture-not-configured');
        }
        if (method === 'startPersonalFM' || method === 'leavePersonalFM') {
          if (win.fixtureFmBridge) return win.fixtureFmBridge(method, options);
          throw new Error('fm-fixture-not-configured');
        }
        if (['getModels', 'downloadModel', 'cancelModel', 'removeModels', 'importModel'].includes(method)) {
          if (win.fixtureModelBridge) return win.fixtureModelBridge(method, options);
          if (method === 'getModels') return structuredClone(win.fixtureModels);
          throw new Error('model-fixture-not-configured');
        }
        if (['getSyncSettings', 'setSyncSettings', 'syncRequest', 'cancelSyncRequest'].includes(method)) {
          if (win.fixtureSyncBridge) return win.fixtureSyncBridge(method, options);
          if (method === 'getSyncSettings') return { enabled: false, baseURL: '', hasToken: false, scope: 'fixture-disabled', revision: 0 };
          throw new Error('sync-fixture-not-configured');
        }
        if (['getAISettings', 'setAISettings', 'aiRequest', 'cancelAIRequest'].includes(method)) {
          if (win.fixtureAIBridge) return win.fixtureAIBridge(method, options);
          throw new Error('ai-fixture-not-configured');
        }
        if (method === 'readLocalFolders') return win.fixtureFolders ?? { revision: 'empty', roots: [] };
        if (['beginFolderImport', 'readFolderImport', 'prepareFolderImport', 'finishFolderImport', 'cancelFolderImport', 'removeLocalFolder'].includes(method)) {
          if (win.fixtureFolderBridge) return win.fixtureFolderBridge(method, options);
          throw new Error('folder-fixture-not-configured');
        }
        if (method === 'getSleepTimer') return { ...sleepTimer };
        if (method === 'setSleepTimer') {
          win.fixtureSleepEdits.push(options.edit);
          if (win.fixtureSleepFailure) throw Error('sleep-save-failed');
          const next = { ...sleepTimer, ...options.edit };
          const durationChanged = next.hours !== sleepTimer.hours || next.minutes !== sleepTimer.minutes;
          if (options.edit.enabled === true && next.hours + next.minutes === 0) throw Error('invalid-duration');
          if (next.hours + next.minutes === 0 || options.edit.enabled === false) { next.enabled = false; next.deadlineMs = null; }
          else if (options.edit.enabled === true || (sleepTimer.enabled && durationChanged)) {
            next.enabled = true; next.deadlineMs = Date.now() + (next.hours * 60 + next.minutes) * 60000;
          }
          win.fixtureEmitSleepTimer(next); return { ...sleepTimer };
        }
        if (method === 'listExportLyrics') {
          if (win.fixtureExportReadFailure) throw new Error('read-failed');
          return { token: lyricToken, entries: Object.keys(lyricCache).map(key => ({ key,
            ...(win.fixtureExportLegacy ? {} : { song: { id: '42', name: '缓存歌曲', artists: [{ id: 0, name: '作者' }], album: { id: 0, name: '' }, sourceRef: JSON.parse(key) } }) })) };
        }
        if (method === 'readExportLyrics') {
          if (win.fixtureExportDelay) await new Promise<void>(resolve => { (win.fixturePendingExport ||= []).push(resolve); });
          if (options.token !== lyricToken) throw new Error('lyric-cache-changed');
          return { payload: structuredClone(lyricCache[options.key]) };
        }
        if (method === 'shareLyricArchive') {
          if (options.token && options.token !== lyricToken) throw new Error('lyric-cache-changed');
          if (win.fixtureShareFailure) throw new Error('share-failed');
          win.fixtureSharedArchives = [...(win.fixtureSharedArchives || []), options];
          return { completed: !win.fixtureShareCancelled };
        }
        if (method === 'shareLyricFile') {
          if (win.fixtureShareFailure) throw new Error('share-failed');
          win.fixtureSharedLyrics = [...(win.fixtureSharedLyrics || []), options];
          return { completed: !win.fixtureShareCancelled };
        }
        if (method === 'sharePlaylistFile') {
          if (win.fixtureShareFailure) throw new Error('share-failed');
          win.fixtureSharedPlaylists = [...(win.fixtureSharedPlaylists || []), options];
          return { completed: !win.fixtureShareCancelled };
        }
        if (method === 'copyText') { if (win.fixtureClipboardFailure) throw new Error('clipboard-unavailable'); win.fixtureClipboard = options.text; return {}; }
        if (method === 'readLyricCache' || method === 'readNavidromeLyrics') return { token: lyricToken, payload: structuredClone(lyricCache[JSON.stringify(options.song.sourceRef)] || {}) };
        if (method === 'writeLyricCache') {
          if (win.fixtureLyricWriteFailure) throw new Error('disk-full');
          if (options.token !== lyricToken) throw new Error('lyric-cache-changed');
          const key = JSON.stringify(options.song.sourceRef);
          lyricCache[key] = { ...lyricCache[key], [options.field]: options.value };
          sessionStorage.setItem('fixture-lyric-cache', JSON.stringify(lyricCache)); return {};
        }
        if (method === 'lyricCacheState') return { count: Object.keys(lyricCache).length, bytes: Object.keys(lyricCache).length ? JSON.stringify(lyricCache).length : 0 };
        if (method === 'clearLyricCache') {
          lyricToken += 'x'; lyricCache = {}; sessionStorage.removeItem('fixture-lyric-cache'); return {};
        }
        if (method === 'songCover') return { url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=' };
        if (method === 'coverCacheState') return { ...win.fixtureCovers };
        if (method === 'clearCoverCache') {
          if (win.fixtureCoverFailure) throw new Error('cache-clear-failed');
          win.fixtureCovers = { bytes: 0, count: 0 }; return {};
        }
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
        if (method === 'getDisplaySleepSettings') {
          if (win.fixtureDisplaySleepLoadFailure) throw new Error('unavailable');
          return JSON.parse(sessionStorage.getItem('fixture-display-sleep') || '{"enabled":false}');
        }
        if (method === 'setDisplaySleepSettings') {
          if (win.fixtureDisplaySleepSaveFailure) throw new Error('unavailable');
          sessionStorage.setItem('fixture-display-sleep', JSON.stringify(options));
          return structuredClone(options);
        }
        if (method === 'getTransitionSettings') return structuredClone(win.fixtureTransition);
        if (method === 'getLyricSettings') {
          if (win.fixtureLyricSettingsLoadFailure) throw new Error('unavailable');
          return structuredClone(win.fixtureLyricSettings);
        }
        if (method === 'setLyricSettings') {
          if (win.fixtureLyricSettingsFailure) throw new Error('unavailable');
          win.fixtureLyricSettings = structuredClone(options.settings);
          sessionStorage.setItem('fixture-lyric-settings', JSON.stringify(win.fixtureLyricSettings));
          return structuredClone(win.fixtureLyricSettings);
        }
        if (method === 'setTransitionSettings') {
          if (win.fixtureTransitionFailure) throw new Error('transition-settings-failed');
          win.fixtureTransition = structuredClone(options.settings); return structuredClone(win.fixtureTransition);
        }
        if (method === 'chooseAudioRoute') {
          (win.fixtureRouteRequests ??= []).push(structuredClone(options));
          if (win.fixtureRouteFailure) throw new Error('audio-route-busy');
          return new Promise(resolve => { win.fixtureFinishAudioRoute = () => resolve({}); });
        }
        if (method === 'getAudioSettings') return structuredClone(win.fixtureAudio);
        if (method === 'setAudioSettings') {
          if (win.fixtureAudioFailure) throw new Error('audio-settings-failed');
          win.fixtureAudio = structuredClone(options.settings);
          state.audioEffects = { available: !win.fixtureEffectError, pending: false, error: win.fixtureEffectError || '' };
          emit(); return structuredClone(win.fixtureAudio);
        }
        if (method === 'health') return win.fixtureHealth ?? { protocol: 1, providers: ['netease', 'qq'] };
        if (method === 'bootstrap') return { scope: 'fixture-scope', server: win.fixtureNoServer ? '' : 'https://fixture.invalid', sessions: win.fixtureSessions ?? {} };
        if (method === 'readLocalLibrary' || method === 'editLocalLibrary') {
          const path = '/src/mobile/nativeLibraryRuntime.ts';
          // Init scripts execute in the browser; prevent the test runner's CommonJS transform from rewriting import().
          const runtime = await new Function('path', 'return import(path)')(new URL(path, location.href).href);
          const inputs = localSongs.map(song => ({ songId: song.id, artistNames: song.artists.map((artist: any) => artist.name),
            albumName: song.album.name, origin: 'import', metadataRevision: '' }));
          if (method === 'editLocalLibrary') {
            if (win.fixtureEntityPending) await new Promise<void>(resolve => { win.fixtureFinishEntity = resolve; });
            if (win.fixtureEntityFailure) throw new Error('disk-full');
            if (options.revision !== String(libraryRevision) || win.fixtureEntityConflict) throw new Error('local-library-changed');
            libraryRecord = JSON.parse(runtime.mutateJSON(JSON.stringify({ version: 1, record: libraryRecord, inputs,
              operation: options.operation, idSeed: crypto.randomUUID(), now: Date.now() })));
            libraryRevision++;
          }
          const record = JSON.parse(runtime.snapshotJSON(JSON.stringify({ version: 1, record: libraryRecord, inputs })));
          const projected = JSON.parse(runtime.projectJSON(JSON.stringify({ record, songs: localSongs, bases: localSongs, documents: {} })));
          if (method === 'editLocalLibrary') {
            const byId = new Map(projected.songs.map((song: any) => [song.id, song]));
            state.queue = state.queue.map(song => byId.get(song.id) ?? song);
            if (state.currentSong) state.currentSong = byId.get(state.currentSong.id) ?? state.currentSong;
            state.queueRevision++; emit(); catalogSubscriber?.();
          }
          return { ...projected, entities: record.entities, assignments: record.assignments, revision: String(libraryRevision) };
        }
        if (method === 'localCatalog') return { songs: localSongs };
        if (method === 'importAudio') {
          localSongs = win.fixtureMany ? [localSong, ...[2, 3].map(i => ({ ...localSong, name: '本地音乐' + i,
            id: '00000000-0000-4000-8000-00000000000' + i,
            sourceRef: { kind: 'local', mediaId: '00000000-0000-4000-8000-00000000000' + i } }))] : [localSong];
          return { songs: localSongs, failures: [] };
        }
        if (method === 'readLocalMatch') return {
          libraryRevision: String(libraryRevision), assignment: win.fixtureLocalAssignment,
          base: structuredClone(localSong), fileName: 'original.m4a',
          lyrics: { token: 'local-token', ...(win.fixtureLocalLyric || { content: lyric }) },
          document: win.fixtureMatchDocument,
          embeddedCover: win.fixtureEmbeddedCover,
        };
        if (method === 'writeLocalMatch') {
          if (win.fixtureLocalSaveFailure) throw new Error('disk-full');
          win.fixtureMatchWrites = (win.fixtureMatchWrites || 0) + 1;
          win.fixtureMatchDocument = structuredClone(options.document);
          win.fixtureLocalLyric = { ...(win.fixtureLocalLyric || { content: lyric }), matched: options.document,
            lyricsSource: options.source ?? undefined };
          const doc = options.document;
          const saved = { ...localSong, name: doc.title, artists: doc.artistNames.map((name: string) => ({ id: '', name })),
            album: { id: '', name: doc.albumName || '', ...(doc.useOnlineCover ? { coverUrl: doc.onlineMetadata?.coverUrl } : {}) } };
          localSongs = localSongs.map(x => x.id === options.id ? saved : x);
          state.queue = state.queue.map(x => x.id === options.id ? saved : x);
          if (state.currentSong?.id === options.id) state.currentSong = saved;
          state.queueRevision++; emit(); catalogSubscriber?.();
          return { coverCached: true };
        }
        if (method === 'localDetails' || method === 'readLocalLyrics') {
          if (win.fixtureLocalLyricDelay) await new Promise<void>(resolve => { (win.fixturePendingLocalLyrics ??= []).push(resolve); });
          return { token: 'local-token', ...(win.fixtureLocalLyric || { content: lyric }) };
        }
        if (method === 'selectLocalLyrics') {
          if (win.fixtureLocalSaveFailure) throw new Error('disk-full');
          win.fixtureLocalLyric = { ...win.fixtureLocalLyric, lyricsSource: options.source };
          return { token: 'local-token', ...win.fixtureLocalLyric };
        }
        if (method === 'importLyrics') { win.fixtureLyricImports = (win.fixtureLyricImports ?? 0) + 1; lyric = '[00:00.00]新导入的歌词\n[00:08.00]下一句'; return { content: lyric }; }
        if (method === 'pickLyricFile') {
          if (win.fixturePendingPick) await new Promise<void>(resolve => { win.fixtureFinishPick = resolve; });
          return win.fixturePickedLyric || { fileName: '新歌词.lrc', token: 'local-token',
            data: btoa(String.fromCharCode(...new TextEncoder().encode('[00:00.00]新导入的歌词\n[00:08.00]下一句'))) };
        }
        if (method === 'saveLocalLyrics') {
          if (win.fixtureLocalSaveFailure) throw new Error('disk-full');
          win.fixtureLyricImports = (win.fixtureLyricImports ?? 0) + 1;
          win.fixtureLocalLyric = { ...win.fixtureLocalLyric, content: options.content, fileName: options.fileName, lyricsSource: 'local' };
          return {};
        }
        if (method === 'removeLocal') { localSongs = localSongs.filter(song => song.sourceRef?.mediaId !== options.id); return {}; }
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
          win.fixtureCommands.push(structuredClone(options));
          if (options.action === 'play' || options.action === 'pause') state.playing = options.action === 'play';
          if (options.action === 'seek') state.position = options.position;
          if (options.action === 'repeat') state.repeat = options.mode;
          emit(); return {};
        }
        if (method !== 'request') return {};
        if (win.fixtureOnlineRequest) {
          const response = await win.fixtureOnlineRequest(options.payload);
          if (response !== undefined) return response;
        }
        const path = options.payload.path as string;
        let body: any = { code: 200 };
        if (path === 'https://u.y.qq.com/cgi-bin/musicu.fcg' && win.fixtureLyricTools) {
          const request = JSON.parse(options.payload.body).request;
          if (request.method === 'DoSearchForQQMusicLite') {
            if (win.fixtureSearchFailure) throw new Error('configure-server');
            return { status: 200, body: JSON.stringify({ code: 0, request: { code: 0, data: { body: { item_song: [
              { id: 43, mid: 'qq-test', title: 'QQ 匹配候选', singer: [{ id: 1, name: '测试歌手' }], album: { id: 1, name: '样本专辑' }, interval: 180 },
            ] } } } }), headers: {} };
          }
          if (win.fixtureLyricDelay) await new Promise<void>(resolve => { win.fixtureReleaseLyrics = resolve; });
          return { status: 200, body: qqLyricReply, headers: {} };
        }
        const profile = cookie ? { userId: 9, nickname: '测试用户', avatarUrl: '' } : null;
        if (path.startsWith('/login/qr/key')) body = { code: 200, data: { unikey: 'key' } };
        else if (path.startsWith('/login/qr/create')) body = { code: 200, data: { qrimg: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=' } };
        else if (path.startsWith('/login/qr/check')) { cookie = true; body = { code: 803, cookie: 'fixture-cookie' }; }
        else if (path.startsWith('/login/status')) body = { code: 200, data: { code: 200, profile } };
        else if (path.startsWith('/user/account')) body = { code: 200, profile, account: cookie ? { id: 9 } : null };
        else if (path.startsWith('/user/playlist')) {
          const params = new URL(path, 'https://fixture.invalid').searchParams;
          const offset = Number(params.get('offset') || 0), limit = Number(params.get('limit') || 100);
          (win.fixturePlaylistOffsets ??= []).push(offset);
          if (win.fixturePlaylistDelay) await new Promise<void>(resolve => { win.fixtureReleasePlaylists = resolve; });
          body = win.fixturePlaylistFailure ? { code: 502 } : win.fixturePlaylistCount
            ? { code: 200, playlist: Array.from({ length: win.fixturePlaylistCount }, (_, id) => ({ id, name: '歌单' + id,
                trackCount: 1, creator: { userId: 9 } })).slice(offset, offset + limit), more: offset + limit < win.fixturePlaylistCount }
            : { code: 200, playlist: [{ id: 8, name: '测试歌单', trackCount: 1, creator: { userId: 9 } }], more: false };
        }
        else if (path.startsWith('/cloudsearch')) body = path.includes('fail') ? { code: 500 } : { code: 200, result: { songs: [{ ...song, al: { ...song.al, ...(win.fixtureMatchCover ? { picUrl: win.fixtureMatchCover } : {}) } }], songCount: 1 } };
        else if (path.startsWith('/playlist/track/all')) body = { code: 200, songs: [song] };
        else if (path.startsWith('/playlist/detail')) body = { code: 200, playlist: { id: 8, name: '测试歌单', tracks: [song], trackIds: [{ id: 42 }], trackCount: 1 } };
        else if (path.startsWith('/lyric')) {
          win.fixtureLyricRequests = (win.fixtureLyricRequests || 0) + 1;
          if (win.fixtureOfflineLyrics) throw new Error('offline');
          if (win.fixtureLyricDelay) await new Promise<void>(resolve => { (win.fixturePendingLyrics ??= []).push(resolve); });
          body = { code: 200, lrc: { lyric: '[00:00.00]测试歌词\n[00:10.00]第二句' } };
        }
        return { status: 200, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } };
      },
    };
  }, { qqLyricReply });
  await use();
  }, { auto: true }],
});

export { expect };

// Follow the real touch route to the secondary controls; never click through hidden chrome.
export async function revealPlayerControls(page: Page) {
  const wake = page.getByRole('button', { name: '显示播放控制', exact: true });
  if (await wake.isVisible()) await wake.tap();
}
export async function openPlayerTools(page: Page) {
  const tools = page.getByRole('dialog', { name: '更多播放选项', exact: true });
  if (await tools.isVisible()) return;
  await revealPlayerControls(page);
  await page.getByRole('button', { name: '更多播放选项', exact: true }).tap();
  await expect(tools).toBeVisible();
}
export async function clickPlayerTool(page: Page, name: string) {
  const action = page.getByRole('button', { name, exact: true });
  if (!await action.isVisible()) await openPlayerTools(page);
  await action.tap();
}
