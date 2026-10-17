import { MathUtils, type PerspectiveCamera, type Quaternion, Vector3 } from 'three';

// dioramaPreviewFraming.ts — fit the active lyric into a mobile stage or settings preview, preserving its camera path.
export function createDioramaPreviewFraming() {
  const point = new Vector3();
  return (camera: PerspectiveCamera, enabled: boolean, centre: Vector3, orientation: Quaternion, width: number, delta: number) => {
    let target = 1;
    if (enabled && Number.isFinite(width) && width > 0) {
      camera.updateMatrixWorld();
      let extent = 0;
      corners: for (let x = -1; x <= 1; x += 2) for (let y = -1; y <= 1; y += 2) {
        point.set(x * width / 2, y * .45, 0).applyQuaternion(orientation).add(centre).project(camera);
        // A transition can carry the incoming plane behind the lens; leave its original flight intact.
        if (!Number.isFinite(point.x + point.y + point.z) || point.z >= 1) { extent = 0; break corners; }
        extent = Math.max(extent, Math.abs(point.x) / camera.zoom, Math.abs(point.y) / camera.zoom);
      }
      if (extent > .8) target = Math.max(.15, .8 / extent);
    }
    const damped = MathUtils.damp(camera.zoom, target, 12, Math.min(delta, .1));
    const zoom = Math.abs(damped - target) < .0005 ? target : damped;
    if (Math.abs(zoom - camera.zoom) > .0001) {
      camera.zoom = zoom; camera.updateProjectionMatrix();
    }
  };
}
