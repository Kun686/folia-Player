// partitaFitGeometry.ts — bound the original word/chunk motion without changing text, timing or relative placement.
export const PARTITA_ACTIVE_WORD_SCALE = 1.4;
export type FitBox = { x: number; y: number; width: number; height: number };
export type FitMotion = readonly [x: number, y: number, rotate: number, scale: number, passedRotate: number];
export type FitWord = { box: FitBox; motion: FitMotion; chunk: FitBox; chunkMotion: FitMotion; entranceX: number };
type Pose = { x: number; y: number; rotate: number; scale: number };
const mix = (a: Pose, b: Pose, t: number): Pose => ({ x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t, rotate: a.rotate + (b.rotate - a.rotate) * t, scale: a.scale + (b.scale - a.scale) * t });
const transform = (x: number, y: number, pose: Pose) => {
  const angle = pose.rotate * Math.PI / 180;
  return { x: pose.x + pose.scale * (x * Math.cos(angle) - y * Math.sin(angle)),
    y: pose.y + pose.scale * (x * Math.sin(angle) + y * Math.cos(angle)) };
};

/** DOM boxes exclude transforms. Evaluate the existing poses and their transitions once per layout,
 * then allow spring overshoot, line exit scale and the outer float. No playback-time measurements. */
export function partitaStageScale(stage: { width: number; height: number }, content: { width: number; height: number }, words: FitWord[]): number {
  if (stage.width <= 0 || stage.height <= 0 || words.length === 0) return 1;
  let halfWidth = 0, halfHeight = 0;
  for (const { box, motion: [x, y, rotate, scale, passedRotate], chunk, chunkMotion, entranceX } of words) {
    const poses: Pose[] = [
      { x: x + Math.sin(y) * 100, y: y + Math.cos(x) * 50, rotate: rotate + 20, scale: 0.5 },
      { x, y, rotate, scale: scale * PARTITA_ACTIVE_WORD_SCALE },
      { x, y, rotate: rotate + passedRotate, scale },
    ];
    const chunkCenter = { x: chunk.x + chunk.width / 2, y: chunk.y + chunk.height / 2 };
    const center = { x: box.x + box.width / 2 - chunkCenter.x, y: box.y + box.height / 2 - chunkCenter.y };
    // A later word may still enter after its chunk is already active.
    const chunkPoses: Pose[] = [
      { x: chunkMotion[0], y: chunkMotion[1], rotate: chunkMotion[2], scale: 1 },
      { x: chunkMotion[0] + entranceX, y: chunkMotion[1], rotate: chunkMotion[2], scale: 0.85 },
    ];
    for (let transition = 0; transition < 2; transition++) for (let step = 0; step <= 8; step++) {
      const pose = mix(poses[transition], poses[transition + 1], step / 8);
      for (const chunkPose of chunkPoses) for (const dx of [-box.width / 2, box.width / 2]) for (const dy of [-box.height / 2, box.height / 2]) {
        const wordPoint = transform(dx, dy, pose);
        const point = transform(center.x + wordPoint.x, center.y + wordPoint.y, chunkPose);
        halfWidth = Math.max(halfWidth, Math.abs(chunkCenter.x + point.x - content.width / 2));
        halfHeight = Math.max(halfHeight, Math.abs(chunkCenter.y + point.y - content.height / 2));
      }
    }
  }
  // The float moves by at most 18px, scales to 1.01; line exit reaches 1.1.
  // Additional 8% covers the damped spring beyond its target and subpixel font metrics.
  const envelopeScale = 1.01 * 1.1 * 1.08;
  const width = Math.max(1, stage.width - 24), height = Math.max(1, stage.height - 60);
  return Math.min(1, width / Math.max(1, halfWidth * 2 * envelopeScale), height / Math.max(1, halfHeight * 2 * envelopeScale));
}
