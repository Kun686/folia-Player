import { analyseTrack, PROFILE_SAMPLE_RATE, TRACK_PROFILE_VERSION } from './trackProfile';
import { aggregateChunks, beatsFromLogits, melSpectrogram, splitForModel,
  type BeatGrid, type ChunkPrediction, type MelChunk } from './beatThis';

// nativeProfileRuntime.ts — original analysis over native-owned PCM, without a WebView or model substitute.
export const protocolVersion = 1;
export const sampleRate = PROFILE_SAMPLE_RATE;
export const profileVersion = TRACK_PROFILE_VERSION;
// Bound decoded working memory; an oversized track keeps playing without an offline profile.
export const maxFrames = PROFILE_SAMPLE_RATE * 20 * 60;
type Completion = (json: string, error: string) => void;
const validPCM = (pcm: unknown): pcm is Float32Array => pcm instanceof Float32Array
  && pcm.length <= maxFrames && pcm.every(value => Number.isFinite(value) && Math.abs(value) <= 16);

function readGrid(json: string): BeatGrid | null {
  if (typeof json !== 'string' || json.length > 262144) throw new Error('invalid-profile-grid');
  const grid: unknown = JSON.parse(json);
  if (grid === null) return null;
  const validTimes = (times: unknown): times is number[] => Array.isArray(times) && times.length <= 60001
    && times.every((n, i) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1200.02
      && (i === 0 || n > times[i - 1]));
  if (typeof grid !== 'object' || !('beats' in grid) || !('downbeats' in grid)
    || !validTimes(grid.beats) || !validTimes(grid.downbeats)) throw new Error('invalid-profile-grid');
  const beats = new Set(grid.beats);
  if (!grid.downbeats.every(time => beats.has(time))) throw new Error('invalid-profile-grid');
  return { beats: grid.beats, downbeats: grid.downbeats };
}

export function analysePCM(mid: Float32Array, side: Float32Array | null, partial: boolean, done: Completion,
  transform?: (real: Float64Array, imag: Float64Array) => void, gridJSON?: string): void {
  if (!validPCM(mid) || (side !== null && (!validPCM(side) || side.length !== mid.length)) || typeof partial !== 'boolean') {
    done('', 'invalid-profile-input'); return;
  }
  // This is the existing no-model branch: gridless means the model did not run, not that it found no beat.
  // Omitting the new argument retains it; explicit JSON null means a model attempt had no usable grid.
  let grid: BeatGrid | null = null;
  try { if (gridJSON !== undefined) grid = readGrid(gridJSON); }
  catch { done('', 'invalid-profile-grid'); return; }
  void analyseTrack(mid, sampleRate, { side, partial, gridless: gridJSON === undefined, grid, transform }).then(
    profile => done(JSON.stringify(profile), ''),
    () => done('', 'profile-analysis-failed'),
  );
}

// Only typed arrays cross this boundary; preprocessing, padding and chunk order remain the original functions.
export function prepareBeatPCM(mono: Float32Array, done: (chunks: MelChunk[], frames: number, error: string) => void,
  transform?: (real: Float64Array, imag: Float64Array) => void): void {
  if (!validPCM(mono)) { done([], 0, 'invalid-profile-input'); return; }
  if (!mono.length) { done([], 0, ''); return; }
  void melSpectrogram(mono, transform).then(mel => done(splitForModel(mel), mel.frames, ''),
    () => done([], 0, 'beat-preparation-failed'));
}

export function beatGridJSON(predictions: ChunkPrediction[], frames: number): string {
  if (!Number.isInteger(frames) || frames < 1 || frames > 60001 || !Array.isArray(predictions)
    || predictions.length < 1 || predictions.length > 41 || predictions.some(chunk =>
      !chunk || !Number.isInteger(chunk.start) || chunk.start < -6 || chunk.start >= frames
      || !Number.isInteger(chunk.frames) || chunk.frames < 1 || chunk.frames > 1500
      || [chunk.beat, chunk.downbeat].some(row => !(row instanceof Float32Array)
        || row.length !== chunk.frames || !row.every(Number.isFinite)))) throw new Error('invalid-beat-prediction');
  const track = aggregateChunks(predictions, frames);
  return JSON.stringify(beatsFromLogits(track.beat, track.downbeat));
}
