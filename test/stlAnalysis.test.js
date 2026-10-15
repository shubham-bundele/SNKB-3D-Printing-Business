'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  OVERHANG_THRESHOLD_COS,
  AREA_TOLERANCE_FRACTION,
  IDENTITY_QUAT,
  computeFaceData,
  isOverhangNormal,
  hasBedContact,
  quatFromEulerDeg,
  quatAxisAngle,
  quatToAxisAngle,
  quatMul,
  rotateVecByQuat,
  evaluateOrientation,
  evaluatePose,
  refineOrientation,
  orientedBBox,
  findBestOrientation,
} = require('../src/components/stlAnalysis');

/** Build a closed axis-aligned box (half-extents hx/hy/hz) with outward winding. */
function boxPositions(hx, hy, hz) {
  const tris = [
    // +Z (top)
    [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz]],
    [[-hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]],
    // -Z (bottom)
    [[-hx, -hy, -hz], [hx, hy, -hz], [hx, -hy, -hz]],
    [[-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]],
    // +X
    [[hx, -hy, -hz], [hx, hy, hz], [hx, -hy, hz]],
    [[hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz]],
    // -X
    [[-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz]],
    [[-hx, -hy, -hz], [-hx, hy, hz], [-hx, hy, -hz]],
    // +Y
    [[-hx, hy, -hz], [-hx, hy, hz], [hx, hy, hz]],
    [[-hx, hy, -hz], [hx, hy, hz], [hx, hy, -hz]],
    // -Y
    [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz]],
    [[-hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz]],
  ];
  return Float64Array.from(tris.flat(2));
}

/** Inverted square pyramid: apex down at origin, 100x100 base rim at z=10. */
function invertedPyramidPositions() {
  const O = [0, 0, 0];
  const tris = [
    [[50, -50, 10], [-50, -50, 10], O], // south
    [[-50, 50, 10], [50, 50, 10], O], // north
    [[50, 50, 10], [50, -50, 10], O], // east
    [[-50, -50, 10], [-50, 50, 10], O], // west
  ];
  return Float64Array.from(tris.flat(2));
}

test('threshold constant equals cos(45 degrees)', () => {
  assert.ok(Math.abs(OVERHANG_THRESHOLD_COS - Math.SQRT1_2) < 1e-12);
});

test('isOverhangNormal flags only normals steeper than 45 degrees downward', () => {
  assert.equal(isOverhangNormal(-1), true); // straight down
  assert.equal(isOverhangNormal(-0.9), true);
  assert.equal(isOverhangNormal(-Math.SQRT1_2 - 1e-6), true); // just past 45 deg
  assert.equal(isOverhangNormal(-Math.SQRT1_2), false); // exactly 45 deg: no support
  assert.equal(isOverhangNormal(0), false); // vertical wall
  assert.equal(isOverhangNormal(1), false); // facing up
});

test('computeFaceData: 20mm cube reports only the bottom face as overhang', () => {
  const faceData = computeFaceData(boxPositions(10, 10, 10));
  assert.equal(faceData.count, 12);
  assert.ok(Math.abs(faceData.totalArea - 2400) < 1e-9);

  const identity = evaluateOrientation(faceData, IDENTITY_QUAT);
  assert.ok(Math.abs(identity.overhangArea - 400) < 1e-9); // 20x20 bottom face
  assert.ok(Math.abs(identity.overhangFraction - 400 / 2400) < 1e-12);
});

test('computeFaceData: exactly-45-degree downward slope is not an overhang', () => {
  // Triangle (0,0,0)-(0,1,1)-(1,0,0): normal (0,1,-1)/sqrt(2), nz = -cos45 exactly.
  const tri = Float64Array.from([0, 0, 0, 0, 1, 1, 1, 0, 0]);
  const faceData = computeFaceData(tri);
  assert.ok(Math.abs(faceData.areas[0] - Math.SQRT1_2) < 1e-12);
  const nz = faceData.normals[2];
  assert.ok(Math.abs(nz + Math.SQRT1_2) < 1e-12);
  assert.equal(isOverhangNormal(nz), false);
});

test('computeFaceData: degenerate triangles contribute zero area and no flags', () => {
  const soup = Float64Array.from([
    1, 2, 3, 1, 2, 3, 1, 2, 3, // degenerate
    -10, -10, 10, 10, -10, 10, 10, 10, 10, // top face triangle (up)
  ]);
  const faceData = computeFaceData(soup);
  assert.equal(faceData.count, 2);
  assert.equal(faceData.areas[0], 0);
  const { overhangArea } = evaluateOrientation(faceData, IDENTITY_QUAT);
  assert.equal(overhangArea, 0);
});

test('quatFromEulerDeg(0,0,0) is the identity quaternion', () => {
  const q = quatFromEulerDeg(0, 0, 0);
  assert.ok(Math.abs(q.x) < 1e-12);
  assert.ok(Math.abs(q.y) < 1e-12);
  assert.ok(Math.abs(q.z) < 1e-12);
  assert.ok(Math.abs(q.w - 1) < 1e-12);
});

test('rotateVecByQuat: 180-degree X rotation maps +Z to -Z', () => {
  const r = rotateVecByQuat({ x: 0, y: 0, z: 1 }, quatFromEulerDeg(180, 0, 0));
  assert.ok(Math.abs(r.x) < 1e-9);
  assert.ok(Math.abs(r.y) < 1e-9);
  assert.ok(Math.abs(r.z + 1) < 1e-9);
});

test('findBestOrientation: cube keeps the identity orientation', () => {
  const faceData = computeFaceData(boxPositions(10, 10, 10));
  const bbox = { min: { x: -10, y: -10, z: -10 }, max: { x: 10, y: 10, z: 10 } };
  const best = findBestOrientation(faceData, bbox);
  assert.deepEqual(best.eulerDeg, [0, 0, 0]);
  assert.ok(Math.abs(best.overhangArea - 400) < 1e-9);
  assert.ok(Math.abs(best.height - 20) < 1e-9);
});

test('findBestOrientation: tall thin tower lays down (zero true supports, max contact)', () => {
  const faceData = computeFaceData(boxPositions(10, 10, 50));
  const bbox = { min: { x: -10, y: -10, z: -50 }, max: { x: 10, y: 10, z: 50 } };
  const best = findBestOrientation(faceData, bbox);
  // Standing: 400mm² bottom overhang, fully plate-supported (support 0).
  // Lying: 2000mm² side overhang, fully plate-supported (support 0) with 5x
  // the bed contact at 1/5 the height — the squat, stable print wins.
  assert.ok(best.supportArea < 1e-6);
  assert.ok(Math.abs(best.height - 20) < 1e-9);
  assert.ok(Math.abs(best.contactArea - 2000) < 1e-6);
});

test('findBestOrientation: inverted flat pyramid flips upright', () => {
  const faceData = computeFaceData(invertedPyramidPositions());
  const bbox = { min: { x: -50, y: -50, z: 0 }, max: { x: 50, y: 50, z: 10 } };

  const identity = evaluateOrientation(faceData, IDENTITY_QUAT);
  assert.ok(identity.overhangFraction > 0.99); // all four steep faces need supports

  const best = findBestOrientation(faceData, bbox);
  assert.ok(best.overhangArea < 1e-9); // flipped: every face normal points upward
  const up = rotateVecByQuat({ x: 0, y: 0, z: 1 }, best.quat);
  assert.ok(Math.abs(up.z + 1) < 1e-9); // winning rotation turns the model over
});

test('quatMul composes rotations: two 90-degree X turns equal one 180-degree turn', () => {  const q90 = quatFromEulerDeg(90, 0, 0);
  const composed = quatMul(q90, q90);
  const direct = quatFromEulerDeg(180, 0, 0);
  for (const v of [{ x: 0, y: 0, z: 1 }, { x: 0, y: 1, z: 0 }, { x: 1, y: 2, z: 3 }]) {
    const a = rotateVecByQuat(v, composed);
    const b = rotateVecByQuat(v, direct);
    assert.ok(Math.abs(a.x - b.x) < 1e-9);
    assert.ok(Math.abs(a.y - b.y) < 1e-9);
    assert.ok(Math.abs(a.z - b.z) < 1e-9);
  }
  // Identity laws.
  const q = quatFromEulerDeg(0, 90, 0);
  const left = quatMul(IDENTITY_QUAT, q);
  const right = quatMul(q, IDENTITY_QUAT);
  assert.ok(Math.abs(left.y - q.y) < 1e-12 && Math.abs(left.w - q.w) < 1e-12);
  assert.ok(Math.abs(right.y - q.y) < 1e-12 && Math.abs(right.w - q.w) < 1e-12);
});

test('orientedBBox: 90-degree Z rotation swaps X/Y extents', () => {
  const bbox = { min: { x: -10, y: -20, z: -30 }, max: { x: 10, y: 20, z: 30 } };
  const out = orientedBBox(bbox, quatFromEulerDeg(0, 0, 90));
  assert.ok(Math.abs(out.min.x + 20) < 1e-9);
  assert.ok(Math.abs(out.max.x - 20) < 1e-9);
  assert.ok(Math.abs(out.min.y + 10) < 1e-9);
  assert.ok(Math.abs(out.max.y - 10) < 1e-9);
  assert.ok(Math.abs(out.min.z + 30) < 1e-9);
  assert.ok(Math.abs(out.max.z - 30) < 1e-9);
});

function boxBbox(hx, hy, hz) {
  return { min: { x: -hx, y: -hy, z: -hz }, max: { x: hx, y: hy, z: hz } };
}

test('evaluatePose: cube reports 400mm² plate contact when flat, ~0 when edge-stood', () => {
  const faceData = computeFaceData(boxPositions(10, 10, 10));
  const bbox = boxBbox(10, 10, 10);
  const flat = evaluatePose(faceData, IDENTITY_QUAT, bbox);
  assert.ok(Math.abs(flat.contactArea - 400) < 1e-6);
  assert.ok(hasBedContact(flat.contactArea, faceData.totalArea));

  const tilted = evaluatePose(faceData, quatAxisAngle('x', 45), bbox);
  assert.ok(tilted.contactArea < 1e-6); // balancing on an edge: no face on plate
  assert.equal(hasBedContact(tilted.contactArea, faceData.totalArea), false);
});

test('refineOrientation: never strands a cube balancing on its edge', () => {
  const faceData = computeFaceData(boxPositions(10, 10, 10));
  const bbox = boxBbox(10, 10, 10);
  // Seed exactly on the 45° edge-balancing pose (reads 0% overhang by the
  // strict angle rule, but floats with no bed contact).
  const refined = refineOrientation(faceData, bbox, quatAxisAngle('x', 45));
  assert.ok(hasBedContact(refined.contactArea, faceData.totalArea));
  assert.ok(Math.abs(refined.overhangArea - 400) < 1e-6);
});

test('findBestOrientation: thin plate stays flat instead of edge-balancing', () => {
  const faceData = computeFaceData(boxPositions(35, 35, 1));
  const best = findBestOrientation(faceData, boxBbox(35, 35, 1));
  assert.ok(best.tiltDeg < 0.5); // already optimal: no rotation applied
  assert.ok(hasBedContact(best.contactArea, faceData.totalArea));
});

test('findBestOrientation: mini veil lays flat with zero support need and real bed contact', () => {
  // Closed curved shell (outer + inner walls + rim strips, outward wound):
  // R=35 arc ±75° about +X, 70 long in Y. Identity leaves ~16% hanging; the
  // solver must lay it flat AND keep it seated on coplanar rim faces.
  const R = 35;
  const T = 2;
  const LEN = 70;
  const ARC = (75 * Math.PI) / 180;
  const NU = 6;
  const NV = 3;
  const surf = (r) => {
    const g = [];
    for (let i = 0; i <= NU; i++) {
      const phi = -ARC + (2 * ARC * i) / NU;
      const row = [];
      for (let j = 0; j <= NV; j++) {
        row.push([r * Math.cos(phi), (LEN * j) / NV, r * Math.sin(phi)]);
      }
      g.push(row);
    }
    return g;
  };
  const patch = (g) => {
    const t = [];
    for (let i = 0; i < g.length - 1; i++) {
      for (let j = 0; j < g[i].length - 1; j++) {
        const a = g[i][j];
        const b = g[i + 1][j];
        const c = g[i + 1][j + 1];
        const d = g[i][j + 1];
        t.push([a, c, b], [a, d, c]);
      }
    }
    return t;
  };
  const signedVol = (tris) => {
    let v = 0;
    for (const [a, b, c] of tris) {
      v +=
        a[0] * (b[1] * c[2] - b[2] * c[1]) -
        a[1] * (b[0] * c[2] - b[2] * c[0]) +
        a[2] * (b[0] * c[1] - b[1] * c[0]);
    }
    return v / 6;
  };
  const outward = (part) => {
    if (signedVol(part) < 0) {
      for (const t of part) {
        const tmp = t[1];
        t[1] = t[2];
        t[2] = tmp;
      }
    }
    return part;
  };
  const outer = surf(R);
  const inner = surf(R - T);
  const rims = [];
  for (let i = 0; i < NU; i++) {
    rims.push(
      [outer[i][0], outer[i + 1][0], inner[i + 1][0]],
      [outer[i][0], inner[i + 1][0], inner[i][0]],
      [outer[i][NV], inner[i + 1][NV], outer[i + 1][NV]],
      [outer[i][NV], inner[i][NV], inner[i + 1][NV]]
    );
  }
  for (let j = 0; j < NV; j++) {
    rims.push(
      [outer[0][j], inner[0][j], inner[0][j + 1]],
      [outer[0][j], inner[0][j + 1], outer[0][j + 1]],
      [outer[NU][j], outer[NU][j + 1], inner[NU][j + 1]],
      [outer[NU][j], inner[NU][j], inner[NU][j + 1]]
    );
  }
  const tris = [...outward(patch(outer)), ...outward(patch(inner)), ...outward(rims)];
  const faceData = computeFaceData(Float64Array.from(tris.flat(2)));
  const bbox = { min: { x: 0, y: 0, z: -R }, max: { x: R, y: LEN, z: R } };

  const identity = evaluateOrientation(faceData, IDENTITY_QUAT);
  assert.ok(identity.overhangFraction > 0.1);

  const best = findBestOrientation(faceData, bbox);
  assert.ok(best.supportArea < 1e-6); // plate-supported overhangs need no supports
  assert.ok(best.tiltDeg > 10); // genuinely rotated, not identity-by-default
  assert.ok(hasBedContact(best.contactArea, faceData.totalArea)); // seated, not floating
});

test('quatToAxisAngle: identity is 0°, 45° X-turn reports 45° about X', () => {
  const id = quatToAxisAngle({ ...IDENTITY_QUAT });
  assert.ok(Math.abs(id.angle) < 1e-9);
  const t = quatToAxisAngle(quatAxisAngle('x', 45));
  assert.ok(Math.abs(t.angle - 45) < 1e-9);
  assert.equal(t.axis, 'X');
});

test('AREA_TOLERANCE_FRACTION keeps near-optimal squat poses competitive', () => {
  assert.ok(AREA_TOLERANCE_FRACTION > 0 && AREA_TOLERANCE_FRACTION < 0.1);
});
