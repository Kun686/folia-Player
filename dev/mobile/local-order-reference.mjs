import { readFile, writeFile } from 'node:fs/promises';
import { parseBuffer } from 'music-metadata';

// local-order-reference.mjs — real audio bytes and original desktop metadata expectations, shared by Vitest/XCTest.
const size = n => Buffer.from([21, 14, 7, 0].map(shift => (n >> shift) & 127));
const frames = Buffer.concat([['TRCK', '02/12'], ['TPOS', '3/4']].map(([name, text]) => {
  const value = Buffer.concat([Buffer.from([3]), Buffer.from(text)]);
  return Buffer.concat([Buffer.from(name), size(value.length), Buffer.from([0, 0]), value]);
}));
const mp3 = Buffer.concat([Buffer.from([73, 68, 51, 4, 0, 0]), size(frames.length), frames,
  ...Array.from({ length: 80 }, () => Buffer.concat([Buffer.from([255, 251, 144, 100]), Buffer.alloc(413)]))]);
const embedded = JSON.parse(await readFile('ios/App/NativeTests/EmbeddedFormatReference.json', 'utf8'));
const source = Buffer.from(embedded.cases.find(c => c.name === 'flac-common').audioBase64, 'base64');
const word = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const comments = Buffer.concat([word(0), word(2), ...['TRACKNUMBER=02/12', 'DISCNUMBER=3/4'].flatMap(s => [word(s.length), Buffer.from(s)])]);
const blocks = []; let position = 4, last = false;
while (!last) {
  const header = source.subarray(position, position + 4), length = header.readUIntBE(1, 3);
  last = !!(header[0] & 128);
  if ((header[0] & 127) !== 4) blocks.push(Buffer.concat([Buffer.from([header[0] & 127, ...header.subarray(1)]), source.subarray(position + 4, position + 4 + length)]));
  position += 4 + length;
}
const header = Buffer.alloc(4); header[0] = 132; header.writeUIntBE(comments.length, 1, 3);
const flac = Buffer.concat([Buffer.from('fLaC'), ...blocks, header, comments, source.subarray(position)]);
const m4a = await readFile(process.argv[2]);
const cases = [];
for (const [extension, audio] of Object.entries({ mp3, flac, m4a })) {
  const { common } = await parseBuffer(audio);
  cases.push({ extension, audioBase64: audio.toString('base64'), expected: { trackNumber: common.track.no, discNumber: common.disk.no } });
}
await writeFile('ios/App/NativeTests/LocalTrackOrderReference.json', JSON.stringify({ parser: 'music-metadata@11.16.1', cases }, null, 2) + '\n');
console.log(cases.map(({ extension, expected }) => ({ extension, ...expected })));
