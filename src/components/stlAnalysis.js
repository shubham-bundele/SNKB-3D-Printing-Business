/**
 * Slicer-style overhang analysis & auto-orientation heuristics for STL geometry.
 *
 * Pure-math module (no Three.js dependency) so it can be unit-tested in Node.
 * All calculations run in **print space**: the STL-native coordinate frame where
 * the vertical build axis is **+Z** (up) and gravity pulls toward **-Z**, exactly
 * like Bambu Studio / professional slicers. The viewer maps print-space +Z to
 * the scene's +Y before rendering; face flags travel with the vertices, so the
 * analysis stays valid through any rigid transform.
 *
 * Overhang rule: a triangular face needs support when its outward unit normal
 * points downward at an angle steeper than 45° from the vertical, i.e.
 * `normal.z < -cos(45°) = -√2/2 ≈ -0.7071`.
 */

'use strict';

import {
  MATERIALS as ENGINE_MATERIALS,
  PRINT_PROFILES as ENGINE_PROFILES,
  calculateSlicerMetrics as engineSlicerMetrics,
  computeSupportWeight as engineSupportWeight,
  OVERHANG_THRESHOLD_COS as ENGINE_COS,
} from '../utils/pricingEngine.js';

const DEG2RAD = Math.PI / 180;

/** cos(45°) — overhang threshold on the downward vertical component. */
const OVERHANG_THRESHOLD_COS = Math.SQRT1_2;

/** Rotation candidates: 90° increments on each axis (4 × 4 × 4 = 64 poses). */
const ORIENTATION_STEP_DEG = 90;

/**
 * Traverse non-indexed triangle positions and derive per-face normals + areas.
 *
 * @param {ArrayLike<number>} positions flat [x0,y0,z0, x1,y1,z1, ...], 3 verts/face.
 * @returns {{ count:number, normals:Float64Array, areas:Float64Array, totalArea:number, positions:ArrayLike<number> }}
 *   `normals` holds one unit (or zero, if degenerate) normal per face.
 *   `positions` is a zero-copy reference used for plate-contact evaluation.
 */
function computeFaceData(positions) {
  const count = Math.floor(positions.length / 9);
  const normals = new Float64Array(count * 3);
  const areas = new Float64Array(count);
  let totalArea = 0;

  for (let f = 0; f < count; f++) {
    const o = f * 9;
    const ax = positions[o];
    const ay = positions[o + 1];
    const az = positions[o + 2];
    const bx = positions[o + 3];
    const by = positions[o + 4];
    const bz = positions[o + 5];
    const cx = positions[o + 6];
    const cy = positions[o + 7];
    const cz = positions[o + 8];

    // Edge vectors: ab = b - a, ac = c - a. Outward normal = ab × ac (right-hand rule).
    const abx = bx - ax;
    const aby = by - ay;
    const abz = bz - az;
    const acx = cx - ax;
    const acy = cy - ay;
    const acz = cz - az;

    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;

    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    const area = len / 2;
    areas[f] = area;
    totalArea += area;

    if (len > 0) {
      normals[f * 3] = nx / len;
      normals[f * 3 + 1] = ny / len;
      normals[f * 3 + 2] = nz / len;
    }
  }

  return { count, normals, areas, totalArea, positions };
}

/**
 * A face needs support when its normal points downward steeper than 45°.
 * @param {number} nz vertical (Z) component of the face unit normal.
 */
function isOverhangNormal(nz) {
  return nz < -OVERHANG_THRESHOLD_COS;
}

/**
 * Build a unit quaternion from XYZ-ordered Euler angles (degrees).
 * Convention matches THREE.Euler/Quaternion 'XYZ': q = qx * qy * qz.
 */
function quatFromEulerDeg(xDeg, yDeg, zDeg) {
  const hx = (xDeg * DEG2RAD) / 2;
  const hy = (yDeg * DEG2RAD) / 2;
  const hz = (zDeg * DEG2RAD) / 2;
  const cx = Math.cos(hx);
  const sx = Math.sin(hx);
  const cy = Math.cos(hy);
  const sy = Math.sin(hy);
  const cz = Math.cos(hz);
  const sz = Math.sin(hz);

  // q = qx * qy * qz expanded (same closed form as three.js Quaternion.setFromEuler XYZ).
  const x = sx * cy * cz + cx * sy * sz;
  const y = cx * sy * cz - sx * cy * sz;
  const z = cx * cy * sz + sx * sy * cz;
  const w = cx * cy * cz - sx * sy * sz;
  const len = Math.sqrt(x * x + y * y + z * z + w * w) || 1;
  return { x: x / len, y: y / len, z: z / len, w: w / len };
}

const IDENTITY_QUAT = Object.freeze({ x: 0, y: 0, z: 0, w: 1 });

/** Scalar quaternion rotation of (x,y,z) into `out` (no per-call allocation). */
function quatRotXYZ(x, y, z, q, out) {
  const tx = 2 * (q.y * z - q.z * y);
  const ty = 2 * (q.z * x - q.x * z);
  const tz = 2 * (q.x * y - q.y * x);
  out.x = x + q.w * tx + (q.y * tz - q.z * ty);
  out.y = y + q.w * ty + (q.z * tx - q.x * tz);
  out.z = z + q.w * tz + (q.x * ty - q.y * tx);
  return out;
}

/** Unit quaternion for a rotation of `deg` about a principal `axis`. */
function quatAxisAngle(axis, deg) {
  const h = (deg * DEG2RAD) / 2;
  const s = Math.sin(h);
  const q = { x: 0, y: 0, z: 0, w: Math.cos(h) };
  q[axis] = s;
  return q;
}

/** Decompose a unit quaternion into tilt angle (degrees) + dominant axis. */
function quatToAxisAngle(q) {
  const w = Math.min(1, Math.max(-1, q.w));
  const angle = (2 * Math.acos(w)) / DEG2RAD;
  const s = Math.sqrt(Math.max(0, 1 - w * w));
  if (s < 1e-9) return { angle: 0, axis: 'X', x: 1, y: 0, z: 0 };
  const ax = { x: q.x / s, y: q.y / s, z: q.z / s };
  const axis =
    Math.abs(ax.x) >= Math.abs(ax.y) && Math.abs(ax.x) >= Math.abs(ax.z)
      ? 'X'
      : Math.abs(ax.y) >= Math.abs(ax.z)
        ? 'Y'
        : 'Z';
  return { angle, axis, x: ax.x, y: ax.y, z: ax.z };
}

/**
 * Hamilton product `a * b` (applies `b` first, then `a`). Returns normalized quat.
 */
function quatMul(a, b) {
  const x = a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y;
  const y = a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x;
  const z = a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w;
  const w = a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z;
  const len = Math.sqrt(x * x + y * y + z * z + w * w) || 1;
  return { x: x / len, y: y / len, z: z / len, w: w / len };
}

/** Rotate a 3-vector by a unit quaternion. */
function rotateVecByQuat(v, q) {
  return quatRotXYZ(v.x, v.y, v.z, q, { x: 0, y: 0, z: 0 });
}

/**
 * Score one candidate orientation: total surface area whose rotated normals
 * breach the 45° overhang threshold.
 *
 * @param {{ count:number, normals:Float64Array, areas:Float64Array, totalArea:number }} faceData
 * @param {{x:number,y:number,z:number,w:number}} quat print-space orientation to test.
 * @returns {{ overhangArea:number, overhangFraction:number }}
 */
function evaluateOrientation(faceData, quat) {
  let overhangArea = 0;
  const { normals, areas, count, totalArea } = faceData;
  const v = { x: 0, y: 0, z: 0 };
  for (let f = 0; f < count; f++) {
    quatRotXYZ(normals[f * 3], normals[f * 3 + 1], normals[f * 3 + 2], quat, v);
    if (isOverhangNormal(v.z)) overhangArea += areas[f];
  }
  return {
    overhangArea,
    overhangFraction: totalArea > 0 ? overhangArea / totalArea : 0,
  };
}

/** Fraction of total area below which bed contact counts as "seated". */
const CONTACT_VALID_FRACTION = 1e-9;

/**
 * A pose is printable (adheres to the plate) only when a non-trivial area of
 * faces rests coplanar with the build plate. Edge- or point-balancing poses
 * (e.g. a cube stood on one edge) score contact ≈ 0 and are excluded.
 */
function hasBedContact(contactArea, totalArea) {
  return contactArea > CONTACT_VALID_FRACTION * totalArea;
}

/**
 * Full pose evaluation: overhang area + bed-contact area + build height.
 * Contact = faces COPLANAR with the build plate (every vertex at the rotated
 * bbox minimum, i.e. genuinely resting flat like a real slicer requires —
 * faces merely touching with an edge do not count).
 *
 * @param {{ count:number, normals:Float64Array, areas:Float64Array, totalArea:number, positions?:ArrayLike<number> }} faceData
 * @param {{x:number,y:number,z:number,w:number}} quat print-space orientation.
 * @param {{ min:{x,y,z}, max:{x,y,z} }} [bbox] print-space bounds (enables contact + height).
 */
function evaluatePose(faceData, quat, bbox) {
  const { overhangArea, overhangFraction } = evaluateOrientation(faceData, quat);
  let contactArea = 0;
  let height = 0;
  let supportVolumeMm3 = 0;
  let footprintAreaMm2 = 0;

  if (bbox) {
    let plateMinZ = Infinity;
    let maxZ = -Infinity;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const c of bboxCorners(bbox)) {
      const r = rotateVecByQuat(c, quat);
      if (r.z < plateMinZ) plateMinZ = r.z;
      if (r.z > maxZ) maxZ = r.z;
      if (r.x < minX) minX = r.x;
      if (r.x > maxX) maxX = r.x;
      if (r.y < minY) minY = r.y;
      if (r.y > maxY) maxY = r.y;
    }
    height = maxZ - plateMinZ;
    footprintAreaMm2 = (maxX - minX) * (maxY - minY);

    const { positions, count, areas, normals } = faceData;
    if (positions) {
      const dx = bbox.max.x - bbox.min.x;
      const dy = bbox.max.y - bbox.min.y;
      const dz = bbox.max.z - bbox.min.z;
      const contactEps = Math.max(1e-4 * Math.max(dx, dy, dz), 1e-9);
      const v = { x: 0, y: 0, z: 0 };
      const vn = { x: 0, y: 0, z: 0 };

      for (let f = 0; f < count; f++) {
        const o = f * 9;
        quatRotXYZ(positions[o], positions[o + 1], positions[o + 2], quat, v);
        let mx = v.z;
        let cza = v.z;
        quatRotXYZ(positions[o + 3], positions[o + 4], positions[o + 5], quat, v);
        if (v.z > mx) mx = v.z;
        let czb = v.z;
        quatRotXYZ(positions[o + 6], positions[o + 7], positions[o + 8], quat, v);
        if (v.z > mx) mx = v.z;
        let czc = v.z;

        const centroidZ = (cza + czb + czc) / 3;
        const relZ = centroidZ - plateMinZ;

        // Rotated face normal
        quatRotXYZ(normals[f * 3], normals[f * 3 + 1], normals[f * 3 + 2], quat, vn);

        // Coplanar with the plate: the whole face sits at the lowest level.
        if (mx <= plateMinZ + contactEps) {
          contactArea += areas[f];
        } else if (vn.z < -0.85 && relZ <= 0.8) {
          contactArea += areas[f];
        }

        // Downward overhanging faces requiring supports (>1.2mm above plate)
        if (vn.z < -OVERHANG_THRESHOLD_COS && relZ > 1.2) {
          supportVolumeMm3 += areas[f] * Math.abs(vn.z) * relZ;
        }
      }
    }
  }

  const totalArea = faceData.totalArea;
  // True support need: geometric overhang minus what already rests on the
  // plate (a flat bottom face prints directly on the bed — no supports).
  const supportArea = Math.max(0, overhangArea - contactArea);

  // 4-factor slicer penalty score:
  // S = (supportVolumeMm3 * 2.5) + (heightZ^2 * 8.0) - (bedContactAreaMm2 * 4.0) - (footprintAreaMm2 * 0.5)
  const penaltyScore =
    supportVolumeMm3 * 2.5 +
    height * height * 8.0 -
    contactArea * 4.0 -
    footprintAreaMm2 * 0.5;

  return {
    overhangArea,
    overhangFraction,
    contactArea,
    contactFraction: totalArea > 0 ? contactArea / totalArea : 0,
    supportArea,
    supportFraction: totalArea > 0 ? supportArea / totalArea : 0,
    height,
    supportVolumeMm3,
    footprintAreaMm2,
    penaltyScore,
  };
}

const EPS_SCORE = 1e-9;

/** Lexicographic pose score: less true support need wins, ties break to lower height. */
function isBetterScore(a, b) {
  if (a.area < b.area - EPS_SCORE) return true;
  if (Math.abs(a.area - b.area) <= EPS_SCORE && a.height < b.height - EPS_SCORE) {
    return true;
  }
  return false;
}

const REFINE_START_DEG = 45;
const REFINE_MIN_DEG = 5;
const REFINE_MAX_ITERS = 32;
/**
 * Poses within this fraction of total area of the minimum overhang count as
 * "equally good" — among them the final selection prefers bed contact, then
 * lowest height (squat, stable, fast prints over tall tippy ones).
 */
const AREA_TOLERANCE_FRACTION = 0.02;

/**
 * Greedy hill-climb refinement from a seed orientation. Explores ±step twists
 * about each principal axis (step halved whenever nothing improves) so optima
 * sitting between the coarse 90° grid points are still found. Bed-contact-free
 * (edge-balancing) poses can never win a move. Every evaluated pose is
 * reported through `onEval` for tolerance-band final selection.
 *
 * @returns {{ quat, overhangArea, overhangFraction, contactArea, height }}
 */
function refineOrientation(faceData, bbox, seedQuat, onEval) {
  const evalPose = (quat) => {
    const s = evaluatePose(faceData, quat, bbox);
    const rec = {
      quat: { ...quat },
      overhangArea: s.overhangArea,
      overhangFraction: s.overhangFraction,
      contactArea: s.contactArea,
      supportArea: s.supportArea,
      supportFraction: s.supportFraction,
      height: s.height,
    };
    if (onEval) onEval(rec);
    return rec;
  };
  const scoreOf = (r) => ({
    area: r.supportArea,
    height: r.height,
    valid: hasBedContact(r.contactArea, faceData.totalArea),
  });
  const better = (a, b) => {
    if (a.valid !== b.valid) return a.valid; // a seated pose always beats floating
    return isBetterScore(a, b);
  };

  let cur = evalPose(seedQuat);
  let step = REFINE_START_DEG;
  let iters = 0;
  while (step >= REFINE_MIN_DEG && iters < REFINE_MAX_ITERS) {
    let moved = false;
    for (const axis of ['x', 'y', 'z']) {
      for (const s of [step, -step]) {
        const cand = evalPose(quatMul(quatAxisAngle(axis, s), cur.quat));
        if (better(scoreOf(cand), scoreOf(cur))) {
          cur = cand;
          moved = true;
        }
      }
    }
    if (!moved) step /= 2;
    iters++;
  }
  return cur;
}

/**
 * Re-express face data in a rotated frame (normals + positions), so candidate
 * scoring can run relative to the model's current orientation.
 */
function transformFaceData(faceData, quat) {
  const v = { x: 0, y: 0, z: 0 };
  const normals = new Float64Array(faceData.normals.length);
  for (let f = 0; f < faceData.count; f++) {
    quatRotXYZ(faceData.normals[f * 3], faceData.normals[f * 3 + 1], faceData.normals[f * 3 + 2], quat, v);
    normals[f * 3] = v.x;
    normals[f * 3 + 1] = v.y;
    normals[f * 3 + 2] = v.z;
  }
  let positions = null;
  if (faceData.positions) {
    positions = new Float64Array(faceData.positions.length);
    for (let i = 0; i < positions.length; i += 3) {
      quatRotXYZ(faceData.positions[i], faceData.positions[i + 1], faceData.positions[i + 2], quat, v);
      positions[i] = v.x;
      positions[i + 1] = v.y;
      positions[i + 2] = v.z;
    }
  }
  return {
    count: faceData.count,
    normals,
    areas: faceData.areas,
    totalArea: faceData.totalArea,
    positions,
  };
}

/** Eight corners of an axis-aligned bounding box `{ min:{x,y,z}, max:{x,y,z} }`. */
function bboxCorners(bbox) {
  const { min, max } = bbox;
  const corners = [];
  for (const x of [min.x, max.x]) {
    for (const y of [min.y, max.y]) {
      for (const z of [min.z, max.z]) {
        corners.push({ x, y, z });
      }
    }
  }
  return corners;
}

/** Vertical (Z) extent of a bbox after applying an orientation. */
function orientedHeight(bbox, quat) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const c of bboxCorners(bbox)) {
    const r = rotateVecByQuat(c, quat);
    if (r.z < lo) lo = r.z;
    if (r.z > hi) hi = r.z;
  }
  return hi - lo;
}

/** Axis-aligned bbox enclosing `bbox` after applying an orientation. */
function orientedBBox(bbox, quat) {
  const lo = { x: Infinity, y: Infinity, z: Infinity };
  const hi = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const c of bboxCorners(bbox)) {
    const r = rotateVecByQuat(c, quat);
    if (r.x < lo.x) lo.x = r.x;
    if (r.y < lo.y) lo.y = r.y;
    if (r.z < lo.z) lo.z = r.z;
    if (r.x > hi.x) hi.x = r.x;
    if (r.y > hi.y) hi.y = r.y;
    if (r.z > hi.z) hi.z = r.z;
  }
  return { min: lo, max: hi };
}

/**
 * Heuristic auto-orient in three stages:
 *   1. Coarse 90° X/Y/Z grid (64 poses) for global coverage.
 *   2. Greedy hill-climb refinement from the coarse winner (finds optima
 *      hiding between grid points, e.g. a 45° tilt with zero overhang).
 *   3. Tolerance-band final selection over EVERY evaluated pose: poses with
 *      no bed contact are excluded (a model must sit on the plate, not balance
 *      on an edge); selection minimizes TRUE support need
 *      (overhang − plate-supported); among poses within 2% of total area of
 *      the minimum, the largest plate contact wins, then the lowest height.
 *
 * @param {{ count:number, normals:Float64Array, areas:Float64Array, totalArea:number, positions?:ArrayLike<number> }} faceData
 * @param {{ min:{x:number,y:number,z:number}, max:{x:number,y:number,z:number} }} bbox print-space bounds.
 * @returns {{ quat:{x,y,z,w}, eulerDeg:[number,number,number], tiltDeg:number, tiltAxis:string, overhangArea:number, overhangFraction:number, contactArea:number, supportArea:number, supportFraction:number, height:number, evaluated:number }}
 */
function findBestOrientation(faceData, bbox) {
  const seen = [];
  const push = (quat, eulerDeg) => {
    const s = evaluatePose(faceData, quat, bbox);
    const rec = {
      quat: { ...quat },
      eulerDeg: eulerDeg || null,
      overhangArea: s.overhangArea,
      overhangFraction: s.overhangFraction,
      contactArea: s.contactArea,
      supportArea: s.supportArea,
      supportFraction: s.supportFraction,
      height: s.height,
      supportVolumeMm3: s.supportVolumeMm3,
      footprintAreaMm2: s.footprintAreaMm2,
      penaltyScore: s.penaltyScore,
    };
    seen.push(rec);
    return rec;
  };

  // Evaluate the 6 primary orthogonal CAD orientations
  const CAD_ORTHOGONAL = [
    [0, 0, 0],
    [90, 0, 0],
    [-90, 0, 0],
    [180, 0, 0],
    [0, 0, 90],
    [0, 0, -90],
  ];
  for (const euler of CAD_ORTHOGONAL) {
    push(quatFromEulerDeg(euler[0], euler[1], euler[2]), euler);
  }

  let coarse = null;
  for (let ix = 0; ix < 4; ix++) {
    for (let iy = 0; iy < 4; iy++) {
      for (let iz = 0; iz < 4; iz++) {
        const eulerDeg = [ix * ORIENTATION_STEP_DEG, iy * ORIENTATION_STEP_DEG, iz * ORIENTATION_STEP_DEG];
        const quat = quatFromEulerDeg(eulerDeg[0], eulerDeg[1], eulerDeg[2]);
        const rec = push(quat, eulerDeg);
        if (
          !coarse ||
          rec.penaltyScore < coarse.penaltyScore - 1e-6 ||
          isBetterScore(
            { area: rec.supportArea, height: rec.height },
            { area: coarse.supportArea, height: coarse.height }
          )
        ) {
          coarse = rec;
        }
      }
    }
  }

  refineOrientation(faceData, bbox, coarse.quat, (rec) => seen.push(rec));

  const total = faceData.totalArea;
  let pool = seen.filter((r) => hasBedContact(r.contactArea, total));
  if (pool.length === 0) pool = seen; // degenerate soup: fall back to pure area

  let winner = null;
  for (const r of pool) {
    if (
      !winner ||
      r.penaltyScore < winner.penaltyScore - 1e-6 ||
      (Math.abs(r.penaltyScore - winner.penaltyScore) <= 1e-6 &&
        (r.contactArea > winner.contactArea + 1e-9 ||
          (Math.abs(r.contactArea - winner.contactArea) <= 1e-9 &&
            r.height < winner.height - 1e-9)))
    ) {
      winner = r;
    }
  }

  const aa = quatToAxisAngle(winner.quat);
  return {
    quat: winner.quat,
    eulerDeg: winner.eulerDeg || coarse.eulerDeg,
    tiltDeg: aa.angle,
    tiltAxis: aa.axis,
    overhangArea: winner.overhangArea,
    overhangFraction: winner.overhangFraction,
    contactArea: winner.contactArea,
    supportArea: winner.supportArea,
    supportFraction: winner.supportFraction,
    height: winner.height,
    supportVolumeMm3: winner.supportVolumeMm3,
    penaltyScore: winner.penaltyScore,
    evaluated: seen.length,
  };
}

const PRINT_PROFILES = ENGINE_PROFILES;
const MATERIALS = ENGINE_MATERIALS;

function roundNum(val, dec = 2) {
  const factor = 10 ** dec;
  return Math.round((val + Number.EPSILON) * factor) / factor;
}

/**
 * Single-source delegate: all shell/infill/support math lives in
 * src/utils/pricingEngine.js (Model vs Support split, 0.18 density,
 * 1.5g interface allowance, PETG profile).
 */
function calculateSlicerMetrics(opts = {}) {
  return engineSlicerMetrics(opts);
}

function computeSupportWeight(opts = {}) {
  return engineSupportWeight(opts);
}

export {
  OVERHANG_THRESHOLD_COS,
  ORIENTATION_STEP_DEG,
  AREA_TOLERANCE_FRACTION,
  IDENTITY_QUAT,
  PRINT_PROFILES,
  MATERIALS,
  calculateSlicerMetrics,
  computeSupportWeight,
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
  orientedHeight,
  orientedBBox,
  refineOrientation,
  transformFaceData,
  findBestOrientation,
};

export default {
  OVERHANG_THRESHOLD_COS,
  ORIENTATION_STEP_DEG,
  AREA_TOLERANCE_FRACTION,
  IDENTITY_QUAT,
  PRINT_PROFILES,
  MATERIALS,
  calculateSlicerMetrics,
  computeSupportWeight,
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
  orientedHeight,
  orientedBBox,
  refineOrientation,
  transformFaceData,
  findBestOrientation,
};
