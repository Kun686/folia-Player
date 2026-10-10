import { analyseTrack, PROFILE_SAMPLE_RATE, TRACK_PROFILE_VERSION } from './trackProfile';

// nativeProfileRuntime.ts — original analysis over native-owned PCM, without a WebView or model substitute.
export const protocolVersion = 1;
export const sampleRate = PROFILE_SAMPLE_RATE;
export const profileVersion = TRACK_PROFILE_VERSION;
// Bound decoded working memory; an oversized track keeps playing without an offline profile.
export const maxFrames = PROFILE_SAMPLE_RATE * 20 * 60;
type Completion = (json: string, error: string) => void;

export function analysePCM(mid: Float32Array, side: Float32Array | null, partial: boolean, done: Completion,
  transform?: (real: Float64Array, imag: Float64Array) => void): void {
  const valid = (pcm: unknown): pcm is Float32Array => pcm instanceof Float32Array
    && pcm.length <= maxFrames && pcm.every(value => Number.isFinite(value) && Math.abs(value) <= 16);
  if (!valid(mid) || (side !== null && (!valid(side) || side.length !== mid.length)) || typeof partial !== 'boolean') {
    done('', 'invalid-profile-input'); return;
  }
  // This is the existing no-model branch: gridless means the model did not run, not that it found no beat.
  void analyseTrack(mid, sampleRate, { side, partial, gridless: true, transform }).then(
    profile => done(JSON.stringify(profile), ''),
    () => done('', 'profile-analysis-failed'),
  );
}
