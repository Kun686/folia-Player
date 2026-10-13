import type { Page } from '@playwright/test';

// local-metadata-fixture.ts — controlled catalog/session receipts and provider replies, no real account or audio.
export async function metadataFixture(page: Page) {
  await page.addInitScript(() => {
    const w = window as any, original = w.Capacitor.nativePromise;
    const songs = [1, 2, 3].map(n => ({ id: '00000000-0000-4000-8000-' + String(n).padStart(12, '0'),
      name: '测试歌曲', artists: [{ id: '', name: '测试歌手' }], album: { id: '', name: '' }, durationMs: 180000,
      importedFileName: 'song-' + n + '.m4a',
      sourceRef: { kind: 'local', mediaId: '00000000-0000-4000-8000-' + String(n).padStart(12, '0') } }));
    const docs: Record<string, any> = {}, revisions: Record<string, number> = {};
    w.fixtureFolders = { revision: 'folders', roots: [{ id: 'root', name: '文件夹样本', ignoredPaths: [],
      directories: [{ path: 'Album', ignored: false }], tracks: songs.map((song, i) => ({ id: song.id, path: (i ? 'Album/' : '') + i + '.m4a' })) }] };
    w.fixtureSetLocalSongs(songs); w.metadataWrites = []; w.metadataRequests = []; w.metadataPending = [];
    w.Capacitor.nativePromise = async (plugin: string, method: string, options: any) => {
      if (method === 'readLocalLibrary') {
        const snapshot = await original(plugin, method, options);
        snapshot.editorSongs = snapshot.editorSongs.map((song: any) => ({ ...song, ...docs[song.id] }));
        return snapshot;
      }
      if (method === 'readLocalMatch') return { base: songs.find(song => song.id === options.id), fileName: 'original.m4a',
        document: docs[options.id], lyrics: { token: 'lyrics', content: '[00:00.00]保留歌词', lyricsSource: 'local' },
        libraryRevision: 'fixture', contextToken: options.id + ':' + (revisions[options.id] || 0), sessionToken: options.online ? 'session' : undefined };
      if (method === 'writeLocalMatch') {
        if (w.metadataSavePending) await new Promise(resolve => { w.metadataFinishSave = resolve; });
        if (w.metadataSaveFailure) throw new Error('disk-full');
        if (options.contextToken !== options.id + ':' + (revisions[options.id] || 0)) throw new Error('local-library-changed');
        w.metadataWrites.push(structuredClone(options));
        docs[options.id] = options.document; revisions[options.id] = (revisions[options.id] || 0) + 1;
        return { coverCached: true };
      }
      if (method === 'request') {
        w.metadataRequests.push(options.payload);
        if (w.metadataSearchDelay && (options.payload.path.startsWith('/cloudsearch') || options.payload.path.startsWith('/getSearchByKey')))
          await new Promise(resolve => w.metadataPending.push(resolve));
      }
      return original(plugin, method, options);
    };
  });
}
