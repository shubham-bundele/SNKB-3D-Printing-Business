/**
 * Dedicated Web Worker for off-thread STL/3MF geometry processing,
 * volume/surface-area integration, and overhang normal analysis.
 *
 * Uses transferable Float32Array buffers to eliminate main UI thread jank.
 */

const OVERHANG_THRESHOLD_COS = Math.SQRT1_2; // cos(45°) ≈ 0.7071

const GREY_R = 0x8E / 255;
const GREY_G = 0x92 / 255;
const GREY_B = 0x96 / 255;

const CORAL_R = 0xFF / 255;
const CORAL_G = 0x51 / 255;
const CORAL_B = 0x47 / 255;

function isOverhangNormal(nz) {
  return nz < -OVERHANG_THRESHOLD_COS;
}

function rotateVecByQuat(v, q) {
  if (!q) return v;
  const qx = q.x || 0;
  const qy = q.y || 0;
  const qz = q.z || 0;
  const qw = q.w !== undefined ? q.w : 1;

  // t = 2 * cross(q.xyz, v)
  const tx = 2 * (qy * v.z - qz * v.y);
  const ty = 2 * (qz * v.x - qx * v.z);
  const tz = 2 * (qx * v.y - qy * v.x);

  // v + qw * t + cross(q.xyz, t)
  return {
    x: v.x + qw * tx + (qy * tz - qz * ty),
    y: v.y + qw * ty + (qz * tx - qx * tz),
    z: v.z + qw * tz + (qx * ty - qy * tx),
  };
}

function parseBinaryStl(buffer) {
  const dataView = new DataView(buffer);
  const triangles = dataView.getUint32(80, true);
  const positions = new Float32Array(triangles * 9);

  let offset = 84;
  for (let i = 0; i < triangles; i++) {
    offset += 12; // skip facet normal
    const pIdx = i * 9;
    positions[pIdx] = dataView.getFloat32(offset, true);
    positions[pIdx + 1] = dataView.getFloat32(offset + 4, true);
    positions[pIdx + 2] = dataView.getFloat32(offset + 8, true);
    offset += 12;

    positions[pIdx + 3] = dataView.getFloat32(offset, true);
    positions[pIdx + 4] = dataView.getFloat32(offset + 4, true);
    positions[pIdx + 5] = dataView.getFloat32(offset + 8, true);
    offset += 12;

    positions[pIdx + 6] = dataView.getFloat32(offset, true);
    positions[pIdx + 7] = dataView.getFloat32(offset + 4, true);
    positions[pIdx + 8] = dataView.getFloat32(offset + 8, true);
    offset += 12;

    offset += 2; // skip attribute byte count
  }

  return positions;
}

function processMeshPositions(positions, options = {}) {
  const count = Math.floor(positions.length / 9);
  const colors = new Float32Array(count * 9);
  const normals = new Float32Array(count * 3);

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  let totalSurfaceArea = 0;
  let signedVolume = 0;
  let overhangArea = 0;
  let overhangCount = 0;
  let bedContactArea = 0;

  const currentQuat = options.currentQuat || { x: 0, y: 0, z: 0, w: 1 };

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

    // Bounding box tracking
    if (ax < minX) minX = ax; if (ax > maxX) maxX = ax;
    if (ay < minY) minY = ay; if (ay > maxY) maxY = ay;
    if (az < minZ) minZ = az; if (az > maxZ) maxZ = az;

    if (bx < minX) minX = bx; if (bx > maxX) maxX = bx;
    if (by < minY) minY = by; if (by > maxY) maxY = by;
    if (bz < minZ) minZ = bz; if (bz > maxZ) maxZ = bz;

    if (cx < minX) minX = cx; if (cx > maxX) maxX = cx;
    if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;
    if (cz < minZ) minZ = cz; if (cz > maxZ) maxZ = cz;

    // Signed tetrahedron volume = (a · (b × c)) / 6
    const crossX = by * cz - bz * cy;
    const crossY = bz * cx - bx * cz;
    const crossZ = bx * cy - by * cx;
    signedVolume += (ax * crossX + ay * crossY + az * crossZ) / 6;

    // Edge vectors: ab = b - a, ac = c - a
    const abx = bx - ax;
    const aby = by - ay;
    const abz = bz - az;
    const acx = cx - ax;
    const acy = cy - ay;
    const acz = cz - az;

    // Outward normal = ab × ac
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;

    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    const area = len / 2;
    totalSurfaceArea += area;

    let unx = 0, uny = 0, unz = 0;
    if (len > 0) {
      unx = nx / len;
      uny = ny / len;
      unz = nz / len;
    }

    normals[f * 3] = unx;
    normals[f * 3 + 1] = uny;
    normals[f * 3 + 2] = unz;

    // Rotate normal by current pose quaternion to evaluate overhang
    const rotated = rotateVecByQuat({ x: unx, y: uny, z: unz }, currentQuat);
    const isOverhang = isOverhangNormal(rotated.z);

    if (isOverhang) {
      overhangArea += area;
      overhangCount++;
    }

    // Plate contact check (downward-facing coplanar bottom within 0.1mm tolerance)
    if (rotated.z < -0.99) {
      bedContactArea += area;
    }

    // Vertex color assignment
    const cr = isOverhang ? CORAL_R : GREY_R;
    const cg = isOverhang ? CORAL_G : GREY_G;
    const cb = isOverhang ? CORAL_B : GREY_B;

    for (let k = 0; k < 3; k++) {
      colors[o + k * 3] = cr;
      colors[o + k * 3 + 1] = cg;
      colors[o + k * 3 + 2] = cb;
    }
  }

  const volumeMm3 = Math.abs(signedVolume);
  const overhangPercent = totalSurfaceArea > 0 ? (overhangArea / totalSurfaceArea) * 100 : 0;
  const supportNeededArea = Math.max(0, overhangArea - bedContactArea);

  const boundingBox = {
    min: { x: minX, y: minY, z: minZ },
    max: { x: maxX, y: maxY, z: maxZ },
    dimensions: {
      x: Math.max(0, maxX - minX),
      y: Math.max(0, maxY - minY),
      z: Math.max(0, maxZ - minZ),
    },
  };

  return {
    triangleCount: count,
    surfaceAreaMm2: totalSurfaceArea,
    volumeMm3,
    boundingBox,
    colors,
    normals,
    overhangMetrics: {
      overhangArea,
      overhangPercent,
      overhangCount,
      bedContactArea,
      supportNeededArea,
      isSupportFree: overhangCount === 0 || overhangArea < 1,
    },
  };
}

self.onmessage = function (e) {
  const { id, type, payload } = e.data || {};

  try {
    if (type === 'ANALYZE_POSITIONS') {
      const { positions, options } = payload;
      const result = processMeshPositions(positions, options);

      // Transfer Float32Arrays back with zero copy
      self.postMessage(
        {
          id,
          success: true,
          result: {
            ...result,
            positions,
          },
        },
        [positions.buffer, result.colors.buffer, result.normals.buffer]
      );
    } else if (type === 'PARSE_AND_ANALYZE_STL') {
      const { buffer, options } = payload;
      const positions = parseBinaryStl(buffer);
      const result = processMeshPositions(positions, options);

      self.postMessage(
        {
          id,
          success: true,
          result: {
            ...result,
            positions,
          },
        },
        [positions.buffer, result.colors.buffer, result.normals.buffer]
      );
    } else {
      self.postMessage({ id, success: false, error: 'Unknown worker action: ' + type });
    }
  } catch (err) {
    self.postMessage({ id, success: false, error: err.message });
  }
};
