import { describe, expect, it } from 'vitest';
import { Object3D, PerspectiveCamera, Vector3 } from 'three';
import { createDioramaLyricClearance } from '../../../src/components/visualizer/diorama/dioramaLyricClearance';

// dioramaLyricClearance.test.ts — check separation in screen space and retention of the authored scene.
describe('mobile lyric reading lane', () => {
  it.each([.46, 1, 1.43])('keeps tilted, deeper neighbours clear at aspect %s', aspect => {
    const camera = new PerspectiveCamera(55, aspect, .1, 100);
    camera.position.set(1, .4, 5.2); camera.lookAt(0, 0, 0);
    const pose = camera.position.clone(), rotation = camera.quaternion.clone();
    const active = new Object3D(); active.rotation.z = .12;
    const clearance = createDioramaLyricClearance();
    for (const side of [-1, 1] as const) {
      const neighbour = new Object3D(); neighbour.position.z = -8; neighbour.rotation.z = -.2;
      const original = neighbour.position.clone(), orientation = neighbour.quaternion.clone();
      clearance.begin(camera, active, 4, 1, 844);
      clearance.place(neighbour, 6, 1, side, 1 / 60);
      const bounds = (object: Object3D, width: number) => {
        object.updateWorldMatrix(true, false);
        const ys = [-1, 1].flatMap(x => [-1, 1].map(y => new Vector3(x * width / 2, y / 2, 0)
          .applyMatrix4(object.matrixWorld).project(camera).y));
        return [Math.min(...ys), Math.max(...ys)];
      };
      const hero = bounds(active, 4), next = bounds(neighbour, 6);
      expect(side > 0 ? next[0] - hero[1] : hero[0] - next[1]).toBeGreaterThanOrEqual(16 / 844 - 1e-8);
      expect(neighbour.visible).toBe(true);
      expect(neighbour.quaternion.equals(orientation)).toBe(true);
      expect(neighbour.scale.toArray()).toEqual([1, 1, 1]);
      const viewDepth = (position: Vector3) => position.clone().applyMatrix4(camera.matrixWorldInverse).z;
      expect(viewDepth(neighbour.position)).toBeCloseTo(viewDepth(original), 8);
    }
    expect(camera.position.equals(pose)).toBe(true);
    expect(camera.quaternion.equals(rotation)).toBe(true);
  });

  it('returns an offset smoothly and leaves nonintersecting neighbours untouched', () => {
    const camera = new PerspectiveCamera(55, 1, .1, 100); camera.position.z = 5;
    const active = new Object3D(), neighbour = new Object3D(), clearance = createDioramaLyricClearance();
    neighbour.position.z = -8;
    clearance.begin(camera, active, 4, 1, 844); clearance.place(neighbour, 4, 1, -1, 1 / 60);
    const displaced = neighbour.position.y;
    expect(displaced).toBeLessThan(0);
    active.position.x = 20;
    for (let i = 0; i < 120; i++) {
      neighbour.position.set(0, 0, -8);
      clearance.begin(camera, active, 4, 1, 844); clearance.place(neighbour, 4, 1, -1, 1 / 60);
    }
    expect(Math.abs(neighbour.position.y)).toBeLessThan(.0001);
    const untouched = new Object3D(); untouched.position.set(6, 0, -3);
    active.position.x = 0;
    clearance.begin(camera, active, 4, 1, 844); clearance.place(untouched, 2, 1, -1, 1 / 60);
    expect(untouched.position.toArray()).toEqual([6, 0, -3]);
  });

  it('does not push planes behind the lens or an unavailable active line', () => {
    const camera = new PerspectiveCamera(55, 1, .1, 100), active = new Object3D(), next = new Object3D();
    active.position.z = 10; next.position.z = -10;
    const clearance = createDioramaLyricClearance();
    clearance.begin(camera, active, 4, 1, 844); clearance.place(next, 4, 1, -1, 1 / 60);
    expect(next.position.toArray()).toEqual([0, 0, -10]);
    active.position.z = -5; next.position.z = 10;
    clearance.begin(camera, active, 4, 1, 844); clearance.place(next, 4, 1, -1, 1 / 60);
    expect(next.position.toArray()).toEqual([0, 0, 10]);
  });
});
