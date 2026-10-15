'use strict';

/**
 * Procedural STL generators used by the unit/integration tests and the sample
 * generation script. Produces closed, axis-aligned boxes with a consistent
 * outward winding so the signed-tetrahedron volume is correct.
 */

const BINARY_HEADER_BYTES = 80;
const BINARY_COUNT_BYTES = 4;
const TRIANGLE_BYTES = 50;

/**
 * The 12 triangles of a box spanning (0,0,0) -> (x,y,z).
 * Winding matches the hand-written `plate_50x50x20_ascii.stl` sample.
 */
function boxFaceDefinitions(x, y, z) {
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

/** @returns {Buffer} Binary STL (80-byte header + uint32 count + 50 B/triangle). */
function createBinaryBoxStlBuffer(dimensions) {
  const faces = boxFaceDefinitions(dimensions.x, dimensions.y, dimensions.z);
  const buffer = Buffer.alloc(
    BINARY_HEADER_BYTES + BINARY_COUNT_BYTES + faces.length * TRIANGLE_BYTES,
  );

  buffer.write('SNKB box exported by test/helpers/stlGenerator.js', 0, 'utf8');
  buffer.writeUInt32LE(faces.length, BINARY_HEADER_BYTES);

  let offset = BINARY_HEADER_BYTES + BINARY_COUNT_BYTES;

  for (const face of faces) {
    for (const component of face.normal) {
      buffer.writeFloatLE(component, offset);
      offset += 4;
    }

    for (const vertex of [face.a, face.b, face.c]) {
      for (const component of vertex) {
        buffer.writeFloatLE(component, offset);
        offset += 4;
      }
    }

    buffer.writeUInt16LE(0, offset);
    offset += 2;
  }

  return buffer;
}

/** @returns {Buffer} ASCII STL. */
function createAsciiBoxStlBuffer(dimensions) {
  const faces = boxFaceDefinitions(dimensions.x, dimensions.y, dimensions.z);
  const lines = ['solid snkb_box'];

  for (const face of faces) {
    lines.push(`  facet normal ${face.normal.join(' ')}`);
    lines.push('    outer loop');
    for (const vertex of [face.a, face.b, face.c]) {
      lines.push(`      vertex ${vertex.join(' ')}`);
    }
    lines.push('    endloop');
    lines.push('  endfacet');
  }

  lines.push('endsolid snkb_box');

  return Buffer.from(lines.join('\n'), 'utf8');
}

const { zipSync, strToU8 } = require('three/examples/jsm/libs/fflate.module.js');

/** @returns {Buffer} 3MF Zip buffer. */
function createBox3mfBuffer(dimensions) {
  const { x, y, z } = dimensions;
  const vertices = [
    [0, 0, 0],
    [x, 0, 0],
    [x, y, 0],
    [0, y, 0],
    [0, 0, z],
    [x, 0, z],
    [x, y, z],
    [0, y, z],
  ];

  const triangles = [
    [0, 2, 1],
    [0, 3, 2],
    [4, 5, 6],
    [4, 6, 7],
    [0, 1, 5],
    [0, 5, 4],
    [2, 3, 7],
    [2, 7, 6],
    [0, 4, 7],
    [0, 7, 3],
    [1, 2, 6],
    [1, 6, 5],
  ];

  const vXml = vertices
    .map(([vx, vy, vz]) => `        <vertex x="${vx}" y="${vy}" z="${vz}" />`)
    .join('\n');

  const tXml = triangles
    .map(([v1, v2, v3]) => `        <triangle v1="${v1}" v2="${v2}" v3="${v3}" />`)
    .join('\n');

  const modelXml = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources>
    <object id="1" type="model">
      <mesh>
        <vertices>
${vXml}
        </vertices>
        <triangles>
${tXml}
        </triangles>
      </mesh>
    </object>
  </resources>
  <build>
    <item objectid="1" />
  </build>
</model>`;

  const zip = zipSync({
    '3D/3dmodel.model': strToU8(modelXml),
  });

  return Buffer.from(zip.buffer, zip.byteOffset, zip.byteLength);
}

module.exports = {
  boxFaceDefinitions,
  createBinaryBoxStlBuffer,
  createAsciiBoxStlBuffer,
  createBox3mfBuffer,
};

