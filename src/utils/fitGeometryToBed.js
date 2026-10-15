/**
 * src/utils/fitGeometryToBed.js
 *
 * Strict Mathematical Build-Plate Centering & 180x180x180mm Containment Engine
 * for the Bambu Lab A1 Mini Build Volume.
 *
 * Rules:
 * 1. Orientation First: If STL is Z-up, rotateX(-Math.PI / 2) before computing bounds.
 * 2. Compute Raw Bounding Box.
 * 3. Strict Footprint Clamping: Scale uniformly to targetMaxDimensionMm (110–145mm)
 *    ensuring safety margins inside the 180x180x180mm cage.
 *    If X/Z footprint exceeds 150mm or Y exceeds 160mm, clamp down.
 * 4. Recompute Box & Snap Center to (0, 0, 0) with Bottom Flush at Y = 0:
 *    translate(-center.x, -boundingBox.min.y, -center.z).
 * 5. Guarantees:
 *    - min.x >= -90 && max.x <= 90
 *    - min.z >= -90 && max.z <= 90
 *    - min.y === 0 && max.y <= 180
 *    - dead-center rotation around (0, Y, 0) on the 180x180mm PEI plate.
 */

import * as THREE from 'three';

export function fitGeometryToA1MiniBed(geometry, targetMaxDimensionMm = 140, isZUp = true) {
  if (!geometry) {
    return {
      size: new THREE.Vector3(),
      scale: 1,
      boundingBox: new THREE.Box3(),
    };
  }

  // 1. Orientation First (Before Centering): If the STL is Z-up, map print +Z to scene +Y
  if (isZUp) {
    geometry.rotateX(-Math.PI / 2);
  }

  // 2. Compute Raw Bounding Box
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  const size = new THREE.Vector3();
  geometry.boundingBox.getSize(size);

  let scale = 1;
  const maxAxis = Math.max(size.x, size.y, size.z);

  // 3. Strict Footprint Clamping (Keep inside 180x180x180mm cage with safety margin)
  if (maxAxis > 0 && targetMaxDimensionMm > 0) {
    scale = targetMaxDimensionMm / maxAxis;
    geometry.scale(scale, scale, scale);
  }

  // Re-check after target scaling to guarantee X/Z <= 150mm and Y <= 160mm
  geometry.computeBoundingBox();
  geometry.boundingBox.getSize(size);

  const maxHoriz = Math.max(size.x, size.z);
  if (maxHoriz > 150 || size.y > 160) {
    const extraScale = Math.min(
      150 / Math.max(maxHoriz, 1),
      160 / Math.max(size.y, 1)
    );
    geometry.scale(extraScale, extraScale, extraScale);
    scale *= extraScale;
  }

  // 4. Recompute Box & Snap Center to (0, 0, 0) with Bottom Flush at Y = 0
  geometry.computeBoundingBox();
  const center = new THREE.Vector3();
  geometry.boundingBox.getCenter(center);

  // Translate vertices directly so geometry center is at (0, Y_center, 0) and min.y is 0
  const offsetY = -geometry.boundingBox.min.y;
  geometry.translate(-center.x, offsetY, -center.z);

  // Final recompute bounding box and sphere
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.boundingBox.getSize(size);

  return {
    size,
    scale,
    boundingBox: geometry.boundingBox,
  };
}

/**
 * Fits and synchronizes multi-part (No-AMS) assembly geometries (base + accent)
 * so they maintain exact mutual alignment while strictly fitting inside the 180x180x180mm envelope.
 */
export function fitMultiPartGeometriesToA1MiniBed(baseGeom, accentGeom, targetMaxDimensionMm = 125, isZUp = true) {
  if (!baseGeom || !accentGeom) return null;

  if (isZUp) {
    baseGeom.rotateX(-Math.PI / 2);
    accentGeom.rotateX(-Math.PI / 2);
  }

  baseGeom.computeVertexNormals();
  baseGeom.computeBoundingBox();
  accentGeom.computeVertexNormals();
  accentGeom.computeBoundingBox();

  const combined = new THREE.Box3();
  combined.union(baseGeom.boundingBox);
  combined.union(accentGeom.boundingBox);

  const size = new THREE.Vector3();
  combined.getSize(size);
  const maxAxis = Math.max(size.x, size.y, size.z);

  let scale = 1;
  if (maxAxis > 0 && targetMaxDimensionMm > 0) {
    scale = targetMaxDimensionMm / maxAxis;
    baseGeom.scale(scale, scale, scale);
    accentGeom.scale(scale, scale, scale);
  }

  // Re-check after scaling to ensure horizontal <= 150mm and vertical <= 160mm
  baseGeom.computeBoundingBox();
  accentGeom.computeBoundingBox();
  combined.makeEmpty();
  combined.union(baseGeom.boundingBox);
  combined.union(accentGeom.boundingBox);
  combined.getSize(size);

  const maxHoriz = Math.max(size.x, size.z);
  if (maxHoriz > 150 || size.y > 160) {
    const extraScale = Math.min(
      150 / Math.max(maxHoriz, 1),
      160 / Math.max(size.y, 1)
    );
    baseGeom.scale(extraScale, extraScale, extraScale);
    accentGeom.scale(extraScale, extraScale, extraScale);
    scale *= extraScale;
  }

  // Recompute combined box and center flush on bed at Y = 0
  baseGeom.computeBoundingBox();
  accentGeom.computeBoundingBox();
  combined.makeEmpty();
  combined.union(baseGeom.boundingBox);
  combined.union(accentGeom.boundingBox);

  const center = new THREE.Vector3();
  combined.getCenter(center);
  const offsetY = -combined.min.y;

  baseGeom.translate(-center.x, offsetY, -center.z);
  accentGeom.translate(-center.x, offsetY, -center.z);

  baseGeom.computeBoundingBox();
  baseGeom.computeBoundingSphere();
  accentGeom.computeBoundingBox();
  accentGeom.computeBoundingSphere();

  combined.makeEmpty();
  combined.union(baseGeom.boundingBox);
  combined.union(accentGeom.boundingBox);
  combined.getSize(size);

  return {
    scale,
    combinedBox: combined,
    size,
  };
}

/**
 * Checks whether a geometry is 100% contained within the 180x180x180mm A1 Mini envelope.
 */
export function isGeometryWithinBed(geometry, tolerance = 0.5) {
  if (!geometry || !geometry.boundingBox) return false;
  const bb = geometry.boundingBox;
  const halfBed = 90 + tolerance;
  return (
    bb.min.x >= -halfBed &&
    bb.max.x <= halfBed &&
    bb.min.z >= -halfBed &&
    bb.max.z <= halfBed &&
    bb.min.y >= -tolerance &&
    bb.max.y <= 180 + tolerance
  );
}

export default fitGeometryToA1MiniBed;

