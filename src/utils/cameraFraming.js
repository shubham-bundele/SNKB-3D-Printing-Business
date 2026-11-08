/**
 * src/utils/cameraFraming.js
 *
 * Shared dynamic camera framing for every 3D viewport (slicer cockpit, hero
 * stage, catalog cards). Eliminates the "model gets cut off" class of bugs:
 *
 *  1. Computes the object's exact `THREE.Box3` + center + bounding sphere.
 *  2. Derives the PerspectiveCamera clipping planes FROM THE MODEL ITSELF:
 *       near = max(0.05, diameter / 100)  — never clips a close-up nose-dive
 *       far  = max(2000, diameter * 100)  — never truncates a tall/big model
 *  3. Pulls the camera back along a fixed 3/4 studio direction so the whole
 *     model fits inside the vertical AND horizontal FOV with real margin.
 *  4. Points `OrbitControls.target` at the exact bounding-box center, so
 *     orbiting pivots on the model instead of swinging it off-screen.
 *
 * DOM-free and renderer-free: pure math, unit-testable in Node.
 */

'use strict';

import * as THREE from 'three';

/** Suggested camera bearing: raised 3/4 studio angle. */
export const STUDIO_VIEW_DIRECTION = new THREE.Vector3(0.75, 0.65, 0.85).normalize();

/**
 * Frame `object` with `camera` + `controls`.
 *
 * @param {THREE.PerspectiveCamera} camera
 * @param {THREE.OrbitControls} controls
 * @param {THREE.Object3D} object — the model root to frame
 * @param {object} [opts]
 * @param {number}  [opts.coverage=0.70] — fraction of the FOV the sphere may occupy (≤0.70 guarantees ≥30% margin)
 * @param {THREE.Vector3|number[]} [opts.direction] — orbit bearing from center
 * @param {number}  [opts.minRadius=15] — floor for degenerate/empty geometry
 * @returns {{ box: THREE.Box3, center: THREE.Vector3, radius: number, distance: number } | null}
 */
export function frameObjectToCamera(camera, controls, object, opts = {}) {
  if (!camera || !object) return null;
  if (typeof object.updateMatrixWorld === 'function') {
    object.updateMatrixWorld(true);
  }

  // 1. Exact world-space bounds + center (+ bounding sphere radius).
  const box = new THREE.Box3().setFromObject(object);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const center = sphere.center.clone();
  const radius = Number.isFinite(sphere.radius)
    ? Math.max(sphere.radius, opts.minRadius ?? 15)
    : (opts.minRadius ?? 15);

  const fovRad = THREE.MathUtils.degToRad(camera.fov || 45);
  const aspect = camera.aspect && Number.isFinite(camera.aspect) ? camera.aspect : 1;
  const horizontalFov = 2 * Math.atan(Math.tan(fovRad / 2) * aspect);

  // 2. Fit distance: whole sphere (with margin) inside BOTH FOVs.
  const coverage = Math.min(Math.max(opts.coverage ?? 0.70, 0.2), 0.70);
  const targetRadius = radius / coverage;
  const distVertical = targetRadius / Math.sin(fovRad / 2);
  const distHorizontal = targetRadius / Math.sin(horizontalFov / 2);
  const distance = Math.max(distVertical, distHorizontal, radius * 2.6, 120);

  // 3. Dynamic clipping planes derived from the model's own size.
  const diameter = radius * 2;
  const near = Math.max(0.05, diameter / 100);
  const far = Math.max(2000, diameter * 100);
  if (Number.isFinite(near) && Number.isFinite(far) && far / near >= 4) {
    camera.near = near;
    camera.far = far;
    camera.updateProjectionMatrix();
  }

  // 4. Camera sits ON the orbit line-of-sight: center + dir * distance.
  const rawDir = opts.direction instanceof THREE.Vector3
    ? opts.direction.clone()
    : (Array.isArray(opts.direction)
      ? new THREE.Vector3(...opts.direction)
      : (opts.direction && typeof opts.direction === 'object'
        ? new THREE.Vector3(opts.direction.x, opts.direction.y, opts.direction.z)
        : STUDIO_VIEW_DIRECTION.clone()));
  const dir = rawDir.lengthSq() > 0 ? rawDir.normalize() : STUDIO_VIEW_DIRECTION.clone();
  camera.position.copy(center).addScaledVector(dir, distance);
  camera.updateProjectionMatrix();

  // 5. Orbit pivots exactly on the model's center.
  if (controls) {
    controls.target.copy(center);
    // Zoom bounds scale with the model: the closest allowed orbit stays just
    // OUTSIDE the bounding sphere (a camera diving inside the mesh is what
    // makes models look chopped/cut), and the far bound keeps the whole
    // model strictly inside the far clipping plane.
    controls.minDistance = Math.max(15, radius * 1.05 + 2);
    controls.maxDistance = Math.max(controls.maxDistance || 0, distance * 4, radius * 25);
    controls.update();
  }

  camera.lookAt(center);

  return { box, center, radius, distance };
}

export default frameObjectToCamera;
