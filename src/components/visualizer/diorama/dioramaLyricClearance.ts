import { Box2, MathUtils, type Object3D, type PerspectiveCamera, Vector3 } from 'three';

// dioramaLyricClearance.ts — preserve the mobile reading lane without hiding lyrics or changing camera motion.
export function createDioramaLyricClearance() {
  const protectedBox = new Box2(), neighbourBox = new Box2();
  const corners = Array.from({ length: 4 }, () => new Vector3());
  const projected = new Vector3(), cameraUp = new Vector3();
  const offsets = new WeakMap<Object3D, number>();
  let camera: PerspectiveCamera | null = null, gap = 0;

  // Project a conservative text band, excluding the active glyphs' decorative glow padding.
  function project(object: Object3D, width: number, height: number, box: Box2) {
    if (!camera || !Number.isFinite(width + height) || width <= 0 || height <= 0) return false;
    object.updateWorldMatrix(true, false);
    box.makeEmpty();
    for (let i = 0; i < 4; i++) {
      const point = corners[i].set((i & 1 ? 1 : -1) * width / 2, (i & 2 ? 1 : -1) * height / 2, 0)
        .applyMatrix4(object.matrixWorld).applyMatrix4(camera.matrixWorldInverse);
      projected.copy(point).applyMatrix4(camera.projectionMatrix);
      if (!Number.isFinite(projected.x + projected.y + projected.z) || projected.z < -1 || projected.z >= 1) return false;
      box.min.x = Math.min(box.min.x, projected.x); box.max.x = Math.max(box.max.x, projected.x);
      box.min.y = Math.min(box.min.y, projected.y); box.max.y = Math.max(box.max.y, projected.y);
    }
    return true;
  }

  return {
    begin(lens: PerspectiveCamera, active: Object3D, width: number, height: number, viewportHeight: number) {
      camera = lens; camera.updateMatrixWorld();
      cameraUp.setFromMatrixColumn(camera.matrixWorld, 1);
      gap = 16 / Math.max(1, viewportHeight); // Eight CSS pixels in normalized device coordinates.
      if (!project(active, width, height, protectedBox)) { camera = null; return; }
      // Do not relocate background text around an offscreen hero during the original camera flight.
      if (protectedBox.max.x < -1 || protectedBox.min.x > 1 || protectedBox.max.y < -1 || protectedBox.min.y > 1) camera = null;
    },
    place(mesh: Object3D, width: number, height: number, side: -1 | 1, delta: number) {
      let target = 0;
      if (camera && project(mesh, width, height, neighbourBox)
        && neighbourBox.max.x > protectedBox.min.x - gap && neighbourBox.min.x < protectedBox.max.x + gap
        && neighbourBox.max.y > protectedBox.min.y - gap && neighbourBox.min.y < protectedBox.max.y + gap) {
        const boundary = side > 0 ? protectedBox.max.y + gap : protectedBox.min.y - gap;
        const verticalScale = camera.projectionMatrix.elements[5];
        for (const point of corners) {
          const y = point.y * verticalScale / -point.z;
          const shift = (boundary - y) * -point.z / verticalScale;
          target = side > 0 ? Math.max(target, shift) : Math.min(target, shift);
        }
      }
      const previous = offsets.get(mesh) ?? 0;
      // Move out before ink intersects, then return gently as the camera clears the reading lane.
      const offset = Math.abs(target) >= Math.abs(previous) || previous * side < 0
        ? target : MathUtils.damp(previous, target, 12, Math.min(Math.max(delta, 0), .1));
      offsets.set(mesh, Math.abs(offset) < .0001 ? 0 : offset);
      if (camera) mesh.position.addScaledVector(cameraUp, offset);
    },
  };
}
