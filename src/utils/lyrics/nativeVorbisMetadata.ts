import { Buffer } from 'buffer';
import { MetadataCollector } from '../../../node_modules/music-metadata/lib/common/MetadataCollector.js';
import { VorbisPictureToken } from '../../../node_modules/music-metadata/lib/ogg/vorbis/Vorbis.js';
import { selectEmbeddedLyrics } from './embeddedMetadataSelection';

// nativeVorbisMetadata.ts — libvorbisfile supplies raw comments; the installed desktop mapper keeps tag/lyric semantics.
export function vorbisMetadataJSON(text: string, done: (result: string) => void): void {
  void (async () => {
    const invalid = () => { throw new Error('invalid-local-metadata'); };
    if (text.length > 48_100_000) invalid();
    const request = JSON.parse(text);
    if (request?.version !== 1 || !Array.isArray(request.comments) || request.comments.length > 4096) invalid();
    const metadata = new MetadataCollector({});
    let bytes = 0;
    for (const comment of request.comments) {
      if (typeof comment !== 'string') invalid();
      bytes += Buffer.byteLength(comment, 'utf8');
      if (bytes > 8_000_000) invalid();
      const separator = comment.indexOf('=');
      if (separator < 1) continue;
      const key = comment.slice(0, separator).toUpperCase(), value = comment.slice(separator + 1);
      if (/(lyric|uslt|sylt)/i.test(key) && Buffer.byteLength(value, 'utf8') > 2_000_000) invalid();
      // Same library picture decoder as VorbisStream, using Buffer because bare JavaScriptCore has no atob.
      if (key === 'METADATA_BLOCK_PICTURE') {
        const data = Buffer.from(value, 'base64');
        // Buffer's permissive reads differ from DataView on truncated input; require the fixed picture header.
        if (data.length < 32) invalid();
        const picture = VorbisPictureToken.fromBuffer(data);
        if (!picture.data.length || !picture.format) invalid();
        await metadata.addTag('vorbis', key, picture);
      } else await metadata.addTag('vorbis', key, value);
    }
    const common = metadata.common, lyrics = selectEmbeddedLyrics(common.lyrics ?? [], metadata.native);
    if ([lyrics.lyrics, lyrics.translationLyrics].some(value => value && Buffer.byteLength(value, 'utf8') > 2_000_000)) invalid();
    const picture = common.picture?.[0];
    return JSON.stringify({ title: common.title, artists: common.artists ?? (common.artist ? [common.artist] : []),
      album: common.album, trackNumber: common.track.no ?? undefined, discNumber: common.disk.no ?? undefined,
      ...lyrics, replayGain: { trackGain: common.replaygain_track_gain?.dB, trackPeak: common.replaygain_track_peak?.ratio,
        albumGain: common.replaygain_album_gain?.dB, albumPeak: common.replaygain_album_peak?.ratio },
      cover: picture ? Buffer.from(picture.data).toString('base64') : undefined });
  })().then(done, () => done(JSON.stringify({ error: 'invalid-local-metadata' })));
}
