'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const THREE = require('three');
const { OrbitControls } = require('three/examples/jsm/controls/OrbitControls.js');
const { frameObjectToCamera } = require('../src/utils/cameraFraming.js');

/** Minimal DOM stub so OrbitControls can construct headless in Node. */
const makeFakeDomElement = () => {
  const docStub = { addEventListener() {}, removeEventListener() {} };
  return {
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {},
    style: {},
    ownerDocument: docStub,
    getRootNode: () => docStub,
    setPointerCapture() {},
    releasePointerCapture() {},
  };
};

const makeCamera = () => new THREE.PerspectiveCamera(45, 4 / 3, 1, 2000);
const makeControls = (camera) => new OrbitControls(camera, makeFakeDomElement());

/**
 * A model standing at an arbitrary export origin: a 100×40×60 box translated
 * so the bbox spans x:[25,125], y:[0,40], z:[-320,-260] — center (75,20,-290),
 * like many real STL files exported far from the world origin.
 */
const makeOffsetModel = () => {
  const geometry = new THREE.BoxGeometry(100, 40, 60);
  geometry.translate(75, 20, -290);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  const group = new THREE.Group();
  group.add(mesh);
  return group;
};

// Analytic expectations for makeOffsetModel()
const EXPECTED_CENTER = new THREE.Vector3(75, 20, -290);
const EXPECTED_RADIUS = Math.sqrt(50 * 50 + 20 * 20 + 30 * 30); // half box diagonal
const STUDIO_DIR = new THREE.Vector3(0.75, 0.65, 0.85).normalize();

test('frameObjectToCamera computes exact bbox center for off-origin models', () => {
  const model = makeOffsetModel();
  const camera = makeCamera();
  const controls = makeControls(camera);

  const result = frameObjectToCamera(camera, controls, model, { minRadius: 5 });

  assert.ok(result, 'framing returns metrics');
  assert.ok(result.center.distanceTo(EXPECTED_CENTER) < 1e-6, `center ${result.center.toArray()} vs ${EXPECTED_CENTER.toArray()}`);
  assert.ok(Math.abs(result.radius - EXPECTED_RADIUS) < 1e-6, `radius ${result.radius} vs ${EXPECTED_RADIUS}`);
});

test('frameObjectToCamera derives near/far clipping planes from model size', () => {
  const model = makeOffsetModel();
  const camera = makeCamera();
  const controls = makeControls(camera);

  frameObjectToCamera(camera, controls, model, { minRadius: 5 });

  const diameter = EXPECTED_RADIUS * 2;
  assert.ok(Math.abs(camera.near - diameter / 100) < 1e-6, `near ${camera.near} should be diameter/100`);
  assert.ok(camera.far >= Math.max(2000, diameter * 100), `far ${camera.far} must exceed diameter*100`);
});

test('camera is pulled back so the full model fits the frustum (no clipping)', () => {
  const model = makeOffsetModel();
  const camera = makeCamera();
  const controls = makeControls(camera);

  const { radius, distance } = frameObjectToCamera(camera, controls, model, { minRadius: 5 });

  // Whole sphere strictly inside the frustum.
  assert.ok(distance - radius > camera.near, `distance ${distance} - radius ${radius} must exceed near ${camera.near}`);
  assert.ok(distance + radius < camera.far, 'distance + radius must sit inside far');

  // Camera offset must lie along the studio bearing, exactly `distance` out.
  const offset = new THREE.Vector3().subVectors(camera.position, EXPECTED_CENTER);
  assert.ok(Math.abs(offset.length() - distance) < 1e-6, 'camera sits exactly `distance` from center');
  const dir = offset.normalize();
  assert.ok(Math.abs(dir.dot(STUDIO_DIR) - 1) < 1e-6, 'camera lies on the requested bearing');
});

test('OrbitControls.target pivots exactly on the bbox center; zoom stays outside the mesh', () => {
  const model = makeOffsetModel();
  const camera = makeCamera();
  const controls = makeControls(camera);

  const { radius } = frameObjectToCamera(camera, controls, model, { minRadius: 5 });

  assert.ok(controls.target.distanceTo(EXPECTED_CENTER) < 1e-6, 'target == bbox center');
  assert.ok(controls.minDistance >= radius * 1.05 + 2 - 1e-6, 'closest orbit stays outside the bounding sphere');
  assert.ok(controls.maxDistance >= controls.minDistance, 'maxDistance >= minDistance');
});

test('tiny models still frame sanely (min radius floor + graceful clipping)', () => {
  const geometry = new THREE.BoxGeometry(6, 5, 4);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  const camera = makeCamera();
  const controls = makeControls(camera);

  const result = frameObjectToCamera(camera, controls, mesh, { minRadius: 15 });

  assert.ok(result.radius >= 15, 'radius floored at minRadius');
  assert.ok(camera.near >= 0.05, 'near never degenerates below 0.05');
  assert.ok(result.distance - result.radius > camera.near, 'tiny model fully inside frustum');
  assert.ok(controls.target.distanceTo(new THREE.Vector3(0, 0, 0)) < 1e-6, 'target at origin');
});

test('custom bearing (plain object) is honoured — generic snapshot cameras keep their angle', () => {
  const model = makeOffsetModel();
  const camera = makeCamera();
  const controls = makeControls(camera);

  const result = frameObjectToCamera(camera, null, model, {
    minRadius: 5,
    direction: { x: 130, y: 110, z: 150 },
  });

  const offset = new THREE.Vector3().subVectors(camera.position, EXPECTED_CENTER);
  assert.ok(Math.abs(offset.length() - result.distance) < 1e-6);
  const dir = offset.normalize();
  assert.ok(Math.abs(dir.dot(new THREE.Vector3(130, 110, 150).normalize()) - 1) < 1e-6, 'plain-object bearing honoured');
});
