'use strict';

/**
 * Mock STL payload builders for the API acceptance tests.
 *
 * Kept independent of `test/helpers/stlGenerator.js` so the black-box BDD suite
 * owns its own fixtures and never reaches into the unit-test helpers.
 */

/**
 * The 12 triangles of an axis-aligned box from (0,0,0) to (x,y,z), wound so the
 * signed-tetrahedron volume comes out positive.
 */
function boxFaces(x, y, z) {
  const v000 = [0, 0, 0];
  const v100 = [x, 0, 0];
  const v110 = [x, y, 0];
  const v010 = [0, y, 0];
  const v001 = [0, 0, z];
  const v101 = [x, 0, z];
  const v111 = [x, y, z];
  const v011 = [0, y, z];

  return [
    { normal: [0, 0, -1], a: v000, b: v110, c: v100 },
    { normal: [0, 0, -1], a: v000, b: v010, c: v110 },
    { normal: [0, 0, 1], a: v001, b: v101, c: v111 },
    { normal: [0, 0, 1], a: v001, b: v111, c: v011 },
    { normal: [0, -1, 0], a: v000, b: v100, c: v101 },
    { normal: [0, -1, 0], a: v000, b: v101, c: v001 },
    { normal: [0, 1, 0], a: v010, b: v011, c: v111 },
    { normal: [0, 1, 0], a: v010, b: v111, c: v110 },
    { normal: [-1, 0, 0], a: v000, b: v001, c: v011 },
    { normal: [-1, 0, 0], a: v000, b: v011, c: v010 },
    { normal: [1, 0, 0], a: v100, b: v110, c: v111 },
    { normal: [1, 0, 0], a: v100, b: v111, c: v101 },
  ];
}

/** Build an ASCII STL buffer for a box of the given millimetre dimensions. */
function createAsciiBoxStlBuffer(dimensions) {
  const faces = boxFaces(dimensions.x, dimensions.y, dimensions.z);
  const lines = ['solid snkb_mock'];

  for (const face of faces) {
    lines.push(`  facet normal ${face.normal.join(' ')}`);
    lines.push('    outer loop');
    for (const vertex of [face.a, face.b, face.c]) {
      lines.push(`      vertex ${vertex.join(' ')}`);
    }
    lines.push('    endloop');
    lines.push('  endfacet');
  }

  lines.push('endsolid snkb_mock');

  return Buffer.from(lines.join('\n'), 'utf8');
}

/**
 * Factor a target volume (mm^3) into three integer edge lengths so a box has
 * exactly that volume. Largest sensible factors first, so 15000 -> 24x25x25.
 */
function dimensionsForVolume(targetVolume) {
  for (let x = Math.floor(Math.cbrt(targetVolume)); x >= 1; x -= 1) {
    if (targetVolume % x !== 0) continue;

    const remaining = targetVolume / x;
    for (let y = Math.floor(Math.sqrt(remaining)); y >= 1; y -= 1) {
      if (remaining % y === 0) {
        return { x, y, z: remaining / y };
      }
    }
  }

  throw new Error(`Unable to factor volume ${targetVolume} into integer dimensions.`);
}

module.exports = { createAsciiBoxStlBuffer, dimensionsForVolume };
