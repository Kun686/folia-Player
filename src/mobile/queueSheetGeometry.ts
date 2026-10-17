// queueSheetGeometry.ts — project the release velocity onto the existing sheet's three resting positions.
export function queueSheetAnchors(height: number) {
  const full = Math.max(0, height);
  return { full: 0, middle: full < 460 ? 0 : full * .42, closed: full + 24 };
}

export function queueSheetTarget(position: number, velocity: number, height: number) {
  const anchors = queueSheetAnchors(height);
  const projected = position + Math.max(-3000, Math.min(3000, velocity)) * .2;
  return (Object.keys(anchors) as (keyof typeof anchors)[])
    .reduce((best, key) => Math.abs(anchors[key] - projected) < Math.abs(anchors[best] - projected) ? key : best, 'full');
}
