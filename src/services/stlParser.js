'use strict';

/**
 * Zero-dependency STL parser supporting both Binary and ASCII encodings.
 *
 * Produces the geometry required for a print quote:
 *  - the exact XYZ bounding box and resulting dimensions (mm)
 *  - the enclosed volume in mm^3 (divergence theorem / signed tetrahedra)
 */

const { unzipSync, strFromU8 } = require('fflate');

const BINARY_HEADER_BYTES = 80;
const BINARY_COUNT_BYTES = 4;
const TRIANGLE_BYTES = 50;
const FLOAT_BYTES = 4;

/** Check if buffer has PK zip header used by .3mf archives. */
function is3mf(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return false;
  return buffer[0] === 0x50 && buffer[1] === 0x4B && buffer[2] === 0x03 && buffer[3] === 0x04;
}

function parseXmlAttributes(attrString) {
  const attrs = {};
  const regex = /([a-zA-Z0-9_:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match;
  while ((match = regex.exec(attrString)) !== null) {
    attrs[match[1].toLowerCase()] = match[2] !== undefined ? match[2] : match[3];
  }
  return attrs;
}

function parse3mf(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('Invalid 3MF: the uploaded file is empty.');
  }

  let unzipped;
  try {
    unzipped = unzipSync(new Uint8Array(buffer));
  } catch {
    throw new Error('Invalid 3MF: file is not a valid zip archive.');
  }

  let modelEntry = null;
  for (const key of Object.keys(unzipped)) {
    if (key.toLowerCase().endsWith('3dmodel.model')) {
      modelEntry = unzipped[key];
      break;
    }
  }

  if (!modelEntry) {
    throw new Error('Invalid 3MF: missing 3D/3dmodel.model inside archive.');
  }

  const xmlText = strFromU8(modelEntry);
  const meshRegex = /<mesh\b[^>]*>([\s\S]*?)<\/mesh>/gi;
  const allTriangles = [];
  let meshMatch;

  while ((meshMatch = meshRegex.exec(xmlText)) !== null) {
    const meshContent = meshMatch[1];
    const vertexList = [];
    const vertexRegex = /<vertex\b([^>]*)\/?>/gi;
    let vMatch;
    while ((vMatch = vertexRegex.exec(meshContent)) !== null) {
      const attrs = parseXmlAttributes(vMatch[1]);
      const x = parseFloat(attrs.x || '0');
      const y = parseFloat(attrs.y || '0');
      const z = parseFloat(attrs.z || '0');
      vertexList.push([x, y, z]);
    }

    const triangleRegex = /<triangle\b([^>]*)\/?>/gi;
    let tMatch;
    while ((tMatch = triangleRegex.exec(meshContent)) !== null) {
      const attrs = parseXmlAttributes(tMatch[1]);
      const v1 = parseInt(attrs.v1, 10);
      const v2 = parseInt(attrs.v2, 10);
      const v3 = parseInt(attrs.v3, 10);
      if (!Number.isNaN(v1) && !Number.isNaN(v2) && !Number.isNaN(v3)) {
        if (vertexList[v1] && vertexList[v2] && vertexList[v3]) {
          allTriangles.push(vertexList[v1], vertexList[v2], vertexList[v3]);
        }
      }
    }
  }

  if (allTriangles.length === 0) {
    throw new Error('Invalid 3MF: no valid triangle geometry found in 3D model.');
  }

  return buildGeometry(allTriangles, '3mf', allTriangles.length / 3);
}

/**
 * A buffer is treated as binary only when its byte length exactly matches the
 * size declared in its 84-byte header. This guards against ASCII files whose
 * header begins with the word "solid" (and binary files that also do).
 */
function isBinaryStl(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < BINARY_HEADER_BYTES + BINARY_COUNT_BYTES) {
    return false;
  }

  const triangleCount = buffer.readUInt32LE(BINARY_HEADER_BYTES);
  const expectedBytes =
    BINARY_HEADER_BYTES + BINARY_COUNT_BYTES + triangleCount * TRIANGLE_BYTES;

  return expectedBytes === buffer.length;
}

function parseBinaryStl(buffer) {
  const triangleCount = buffer.readUInt32LE(BINARY_HEADER_BYTES);
  const vertices = [];
  let offset = BINARY_HEADER_BYTES + BINARY_COUNT_BYTES;

  for (let i = 0; i < triangleCount; i += 1) {
    // Skip the 12-byte face normal; only triangle vertices contribute to the quote.
    offset += FLOAT_BYTES * 3;

    for (let vertex = 0; vertex < 3; vertex += 1) {
      vertices.push([
        buffer.readFloatLE(offset),
        buffer.readFloatLE(offset + FLOAT_BYTES),
        buffer.readFloatLE(offset + FLOAT_BYTES * 2),
      ]);
      offset += FLOAT_BYTES * 3;
    }

    // Skip the 2-byte attribute byte count.
    offset += 2;
  }

  return buildGeometry(vertices, 'binary', triangleCount);
}

function parseAsciiStl(buffer) {
  const text = buffer.toString('utf8');
  const vertexPattern = /vertex\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)/g;
  const vertices = [];
  let match = vertexPattern.exec(text);

  while (match !== null) {
    vertices.push([Number(match[1]), Number(match[2]), Number(match[3])]);
    match = vertexPattern.exec(text);
  }

  if (vertices.length === 0) {
    throw new Error('Invalid ASCII STL: no vertex data found.');
  }

  if (vertices.length % 3 !== 0) {
    throw new Error('Invalid ASCII STL: vertex count is not a multiple of three.');
  }

  return buildGeometry(vertices, 'ascii', vertices.length / 3);
}

function buildGeometry(vertices, format, triangleCount) {
  const bounds = {
    x: { min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY },
    y: { min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY },
    z: { min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY },
  };

  let signedVolume = 0;
  let totalSurfaceArea = 0;

  for (let i = 0; i < vertices.length; i += 3) {
    const a = vertices[i];
    const b = vertices[i + 1];
    const c = vertices[i + 2];

    for (const vertex of [a, b, c]) {
      updateBounds(bounds.x, vertex[0]);
      updateBounds(bounds.y, vertex[1]);
      updateBounds(bounds.z, vertex[2]);
    }

    signedVolume += signedTetrahedronVolume(a, b, c);
    totalSurfaceArea += triangleSurfaceArea(a, b, c);
  }

  const dimensions = {
    x: normalize(bounds.x.max - bounds.x.min),
    y: normalize(bounds.y.max - bounds.y.min),
    z: normalize(bounds.z.max - bounds.z.min),
  };

  return {
    format,
    triangleCount,
    boundingBox: bounds,
    dimensions,
    volumeMm3: normalize(Math.abs(signedVolume)),
    surfaceAreaMm2: normalize(totalSurfaceArea),
  };
}

/** Surface area of a triangle formed by 3 vertices in 3D space. */
function triangleSurfaceArea(a, b, c) {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const abz = b[2] - a[2];
  const acx = c[0] - a[0];
  const acy = c[1] - a[1];
  const acz = c[2] - a[2];

  const nx = aby * acz - abz * acy;
  const ny = abz * acx - abx * acz;
  const nz = abx * acy - aby * acx;

  return Math.sqrt(nx * nx + ny * ny + nz * nz) / 2;
}

/** Signed volume of the tetrahedron formed by a triangle and the origin. */
function signedTetrahedronVolume(a, b, c) {
  const crossX = b[1] * c[2] - b[2] * c[1];
  const crossY = b[2] * c[0] - b[0] * c[2];
  const crossZ = b[0] * c[1] - b[1] * c[0];

  return (a[0] * crossX + a[1] * crossY + a[2] * crossZ) / 6;
}

function updateBounds(bound, value) {
  if (value < bound.min) bound.min = value;
  if (value > bound.max) bound.max = value;
}

/** Collapses -0 and NaN-producing float noise to stable values. */
function normalize(value) {
  if (!Number.isFinite(value)) return 0;
  return Object.is(value, -0) ? 0 : value;
}

/**
 * Parse an STL buffer in whichever encoding it uses.
 *
 * @param {Buffer} buffer raw STL bytes
 * @returns {{
 *   format: 'binary' | 'ascii',
 *   triangleCount: number,
 *   boundingBox: Record<string, { min: number, max: number }>,
 *   dimensions: { x: number, y: number, z: number },
 *   volumeMm3: number,
 * }}
 */
function parseStl(buffer, filename) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('Invalid STL: the uploaded file is empty.');
  }

  const isZip = is3mf(buffer);
  const is3mfFile = (typeof filename === 'string' && filename.toLowerCase().endsWith('.3mf')) || isZip;

  if (is3mfFile) {
    return parse3mf(buffer);
  }

  if (isBinaryStl(buffer)) {
    return parseBinaryStl(buffer);
  }

  return parseAsciiStl(buffer);
}

module.exports = {
  parseStl,
  parseBinaryStl,
  parseAsciiStl,
  parse3mf,
  isBinaryStl,
  is3mf,
  BINARY_HEADER_BYTES,
  TRIANGLE_BYTES,
};

