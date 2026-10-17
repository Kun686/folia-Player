import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { createDioramaPreviewFraming } from '../../../src/components/visualizer/diorama/dioramaPreviewFraming';

// dioramaPreviewFraming.test.ts — assert actual projected endpoints and preserve the original cinematic pose.
describe('settings preview framing', () => {
  it.each([.46, 1, 2.8])('keeps a laterally offset lyric visible at aspect %s', aspect => {
    const camera = new PerspectiveCamera(55, aspect, .1, 100);
    camera.position.set(1.3, .6, 5.2); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
    const pose = camera.position.clone(), orientation = camera.quaternion.clone();
    const centre = new Vector3(-2, .2, 0), rotation = new Quaternion(), fit = createDioramaPreviewFraming();
    for (let i = 0; i < 120; i++) fit(camera, true, centre, rotation, 5, 1 / 60);
    for (const sign of [-1, 1]) {
      const point = new Vector3(sign * 2.5, .45, 0).add(centre).project(camera);
      expect(Math.abs(point.x)).toBeLessThanOrEqual(.801);
      expect(Math.abs(point.y)).toBeLessThanOrEqual(.801);
    }
    expect(camera.position.equals(pose)).toBe(true);
    expect(camera.quaternion.equals(orientation)).toBe(true);
    for (let i = 0; i < 120; i++) fit(camera, false, centre, rotation, 5, 1 / 60);
    expect(camera.zoom).toBe(1);
  });
  it('leaves a plane behind the camera and unavailable geometry to the original flight', () => {
    const camera = new PerspectiveCamera(), fit = createDioramaPreviewFraming();
    const centre = new Vector3(0, 0, 10);
    fit(camera, true, centre, new Quaternion(), 5, 1 / 60);
    expect(camera.zoom).toBe(1);
    fit(camera, true, centre, new Quaternion(), Number.NaN, 1 / 60);
    expect(camera.zoom).toBe(1);
  });
});
