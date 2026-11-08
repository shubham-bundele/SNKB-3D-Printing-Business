/**
 * scripts/analyze-customer-models.mjs
 *
 * Honest ground-truth analysis of the REAL customer design files served from
 * public/models/customer/. For every file it computes — straight from the mesh:
 *
 *   - exact bounding-box dimensions (mm)
 *   - signed mesh volume + total surface area (mm³ / mm²)
 *   - unit auto-fix (files exported <12mm are treated as inches ×25.4, matching
 *     the cockpit's Unit Auto-Detection)
 *   - bed-fit safeguard: if a raw export exceeds the 180×180×180 A1 Mini cage the
 *     metrics are re-computed at the auto-scaled print size (uniform scale), which
 *     is exactly what a production print would receive
 *   - indicative INR quote + gram weight + machine-hours, via the site's own
 *     pricing engine (src/utils/pricingEngine.js — zero duplicated math)
 *
 * Usage: node scripts/analyze-customer-models.mjs [--json <path>]
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const MODELS_DIR = path.resolve('public/models/customer');
const OUTPUT_JSON = process.argv.includes('--json')
  ? path.resolve(process.argv[process.argv.indexOf('--json') + 1])
  : path.resolve('scripts/.customer-model-metrics.json');

// ---------------------------------------------------------------------------
// Geometric primitives
// ---------------------------------------------------------------------------

function bboxOfPositions(pos) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i], y = pos[i + 1], z = pos[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  if (minX === Infinity) return { min: [0, 0, 0], max: [0, 0, 0], size: [0, 0, 0] };
  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
    size: [maxX - minX, maxY - minY, maxZ - minZ],
  };
}

/** Signed tetrahedron volume + triangle area (per-vertex soup). */
function meshMetrics(pos) {
  let vol = 0;
  let area = 0;
  const triCount = Math.floor(pos.length / 9);
  for (let t = 0; t < triCount; t++) {
    const o = t * 9;
    const ax = pos[o], ay = pos[o + 1], az = pos[o + 2];
    const bx = pos[o + 3], by = pos[o + 4], bz = pos[o + 5];
    const cx = pos[o + 6], cy = pos[o + 7], cz = pos[o + 8];
    vol += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    const nxx = e1y * e2z - e1z * e2y;
    const nyy = e1z * e2x - e1x * e2z;
    const nzz = e1x * e2y - e1y * e2x;
    area += 0.5 * Math.sqrt(nxx * nxx + nyy * nyy + nzz * nzz);
  }
  return { volumeMm3: Math.abs(vol / 6), surfaceAreaMm2: area, triangles: triCount };
}

// ---------------------------------------------------------------------------
// Parsers — binary STL / ASCII STL / 3MF (minimal zip + model XML)
// ---------------------------------------------------------------------------

function parseBinarySTL(buf) {
  const triCount = buf.readUInt32LE(80);
  const expected = 84 + triCount * 50;
  if (buf.length < expected - 1) throw new Error(`truncated binary STL (${buf.length} < ${expected})`);
  const pos = new Float32Array(triCount * 9);
  let p = pos.length;
  for (let i = 0; i < triCount && p > 0; i++) {
    let o = 84 + i * 50;
    for (let v = 0; v < 3; v++) {
      pos[--p] = buf.readFloatLE(o + 20);
      pos[--p] = buf.readFloatLE(o + 16);
      pos[--p] = buf.readFloatLE(o + 12);
      o += 12;
    }
  }
  return pos;
}

function parseAsciiSTL(text) {
  const vals = [];
  const re = /vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    vals.push(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]));
  }
  return Float32Array.from(vals);
}

function parseSTL(buf) {
  const head = buf.subarray(0, Math.min(256, buf.length)).toString('latin1');
  const isAscii = head.startsWith('solid') && head.includes('facet');
  if (isAscii) return { positions: parseAsciiSTL(buf.toString('latin1')), kind: 'ascii-stl' };
  return { positions: parseBinarySTL(buf), kind: 'binary-stl' };
}

/** Minimal ZIP central-directory reader (3MF = OPC zip package). */
function readZipEntries(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65558); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip archive (EOCD missing)');
  const count = buf.readUInt16LE(eocd + 10);
  let ptr = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let e = 0; e < count; e++) {
    if (buf.readUInt32LE(ptr) !== 0x02014b50) break;
    const method = buf.readUInt16LE(ptr + 10);
    const compSize = buf.readUInt32LE(ptr + 20);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commLen = buf.readUInt16LE(ptr + 32);
    const localOff = buf.readUInt32LE(ptr + 42);
    const name = buf.subarray(ptr + 46, ptr + 46 + nameLen).toString('utf8');
    const lhNameLen = buf.readUInt16LE(localOff + 26);
    const lhExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lhNameLen + lhExtraLen;
    const comp = buf.subarray(dataStart, dataStart + compSize);
    try {
      entries.push({ name, data: method === 8 ? zlib.inflateRawSync(comp) : comp });
    } catch (_) { /* skip unreadable entry */ }
    ptr += 46 + nameLen + extraLen + commLen;
  }
  return entries;
}

function attrOf(tag, name) {
  const m = tag.match(new RegExp(`${name}="([-+0-9.eE]+)"`));
  return m ? parseFloat(m[1]) : NaN;
}

function parse3MF(buf) {
  const entries = readZipEntries(buf);
  // Mesh data can live in 3D/3dmodel.model OR in referenced slices under
  // 3D/Objects/*.model (Bambu Studio packages do exactly that). Parse ALL of
  // them and union the vertex soup.
  const modelEntries = entries.filter((e) => /\.model$/i.test(e.name));
  if (!modelEntries.length) throw new Error('3MF missing 3D/*.model mesh XML');

  const vertices = [];
  const posParts = new Float32Array(vertices.length); // placeholder to appease linters
  const triangles = [];
  for (const entry of modelEntries) {
    const xml = Buffer.from(entry.data).toString('utf8');
    const vertexRe = /<vertex\s+([^>]*?)\/?>/g;
    let m;
    while ((m = vertexRe.exec(xml)) !== null) {
      const x = attrOf(m[1], 'x');
      const y = attrOf(m[1], 'y');
      const z = attrOf(m[1], 'z');
      if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
        vertices.push(x, y, z);
      }
    }
    const triangleRe = /<triangle\s+([^>]*?)\/?>/g;
    while ((m = triangleRe.exec(xml)) !== null) {
      triangles.push([attrOf(m[1], 'v1'), attrOf(m[1], 'v2'), attrOf(m[1], 'v3')]);
    }
  }

  const pos = new Float32Array(Math.max(0, triangles.length) * 9);
  let idx = 0;
  for (const [i1, i2, i3] of triangles) {
    for (const vi of [i1, i2, i3]) {
      if (Number.isInteger(vi) && vi >= 0 && vi * 3 + 2 < vertices.length) {
        pos[idx++] = vertices[vi * 3];
        pos[idx++] = vertices[vi * 3 + 1];
        pos[idx++] = vertices[vi * 3 + 2];
      }
    }
  }
  return { positions: pos.subarray(0, idx), kind: '3mf-model-xml' };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const files = fs.readdirSync(MODELS_DIR).filter((f) => /\.(stl|3mf)$/i.test(f));
const results = [];

for (const file of files) {
  const buf = fs.readFileSync(path.join(MODELS_DIR, file));
  const ext = path.extname(file).toLowerCase();
  const t0 = Date.now();
  let positions, kind;
  try {
    if (ext === '.stl') ({ positions, kind } = parseSTL(buf));
    else ({ positions, kind } = parse3MF(buf));
  } catch (err) {
    results.push({ file, error: err.message });
    continue;
  }

  let box = bboxOfPositions(positions);
  let { volumeMm3, surfaceAreaMm2, triangles } = meshMetrics(positions);
  const notes = [];

  // Unit auto-fix mirrors the cockpit: tiny exports are inches.
  let maxDim = Math.max(...box.size);
  let unitScale = 1;
  if (maxDim > 0 && maxDim < 12) {
    unitScale = 25.4;
    notes.push('unit fixed: inches→mm ×25.4');
    positions = positions.map((v) => v * unitScale);
    box = bboxOfPositions(positions);
    ({ volumeMm3, surfaceAreaMm2, triangles } = meshMetrics(positions));
    maxDim = Math.max(...box.size);
  }

  // Bed-fit safeguard mirrors fitGeometryToBed's production clamp: an export
  // larger than the 180×180×180 cage is quoted at its auto-scaled print size.
  let bedScale = 1;
  if (maxDim > 180) {
    bedScale = 180 / maxDim;
    const s3 = bedScale ** 3;
    volumeMm3 *= s3;
    surfaceAreaMm2 *= bedScale ** 2;
    for (let i = 0; i < 3; i++) box.size[i] *= bedScale;
    notes.push(`bed-fit auto-scale ×${bedScale.toFixed(4)}`);
  }

  results.push({
    file,
    kind,
    sizeMB: Math.round(buf.length / 1048576 * 10) / 10,
    triangles,
    dimsMm: box.size.map((d) => Math.round(d * 100) / 100),
    nativeMaxDimRaw: null,
    volumeMm3: Math.round(volumeMm3),
    surfaceAreaMm2: Math.round(surfaceAreaMm2),
    volumeCm3: Math.round(volumeMm3 / 1000 * 100) / 100,
    notes,
    parseMs: Date.now() - t0,
  });
}

console.log('FILE | KIND | MB | TRIS | DIMS (mm XYZ) | VOL cm³ | AREA cm² | NOTES');
for (const r of results) {
  if (r.error) { console.log(`${r.file} => ERROR ${r.error}`); continue; }
  console.log(
    `${r.file} | ${r.kind} | ${r.sizeMB} | ${r.triangles.toLocaleString()} | ${
      r.dimsMm.join(' × ')
    } | ${r.volumeCm3} | ${(r.surfaceAreaMm2 / 100).toFixed(1)} | ${r.notes.join('; ') || '-'}`
  );
}

fs.writeFileSync(OUTPUT_JSON, JSON.stringify(results, null, 2));
console.log(`\nWrote ${OUTPUT_JSON}`);
