'use strict';

/**
 * Procedural reproduction models for the auto-orient bug report.
 * Generates closed, outward-wound solids (verified by signed-volume check):
 *   1. repro_veil.stl  — thin vertical curved shell, opening sideways (jellyfish-veil class)
 *   2. repro_jelly.stl  — dome-up hemisphere + 8 hanging tentacles (swimming jellyfish)
 * Both are Z-up, matching slicer convention.
 *
 * Usage: node scripts/reproModels.js [outDir]
 * Also prints the repo's own overhang analysis + solver choice for each model.
 */

const fs = require('node:fs');
const path = require('node:path');
const {
  computeFaceData,
  evaluateOrientation,
  findBestOrientation,
  IDENTITY_QUAT,
} = require('../src/components/stlAnalysis');

function tri(a, b, c) {
  return [a, b, c];
}

function signedVolume(tris) {
  let v = 0;
  for (const [a, b, c] of tris) {
    v +=
      a[0] * (b[1] * c[2] - b[2] * c[1]) -
      a[1] * (b[0] * c[2] - b[2] * c[0]) +
      a[2] * (b[0] * c[1] - b[1] * c[0]);
  }
  return v / 6;
}

/** Flip every triangle (swap b/c) so a consistently-wound part points outward. */
function ensureOutward(tris) {
  if (signedVolume(tris) < 0) {
    for (const t of tris) {
      const tmp = t[1];
      t[1] = t[2];
      t[2] = tmp;
    }
  }
  return tris;
}

/** Grid patch -> triangles. grid[i][j] = point; consistent winding throughout. */
function patchTris(grid) {
  const tris = [];
  for (let i = 0; i < grid.length - 1; i++) {
    for (let j = 0; j < grid[i].length - 1; j++) {
      const a = grid[i][j];
      const b = grid[i + 1][j];
      const c = grid[i + 1][j + 1];
      const d = grid[i][j + 1];
      tris.push(tri(a, b, c), tri(a, c, d));
    }
  }
  return tris;
}

function bboxOf(tris) {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const t of tris) {
    for (const p of t) {
      for (let k = 0; k < 3; k++) {
        if (p[k] < lo[k]) lo[k] = p[k];
        if (p[k] > hi[k]) hi[k] = p[k];
      }
    }
  }
  return { lo, hi };
}

/** Closed cylindrical veil shell: axis along Y, arc around +X, opening faces -X. */
function buildVeil() {
  const R = 35;
  const T = 2; // wall thickness
  const LEN = 70;
  const A = (75 * Math.PI) / 180; // half-angle of arc
  const NU = 28;
  const NV = 14;
  const parts = [];

  const surf = (r) => {
    const g = [];
    for (let i = 0; i <= NU; i++) {
      const phi = -A + (2 * A * i) / NU;
      const row = [];
      for (let j = 0; j <= NV; j++) {
        row.push([r * Math.cos(phi), (LEN * j) / NV, r * Math.sin(phi)]);
      }
      g.push(row);
    }
    return g;
  };

  parts.push(patchTris(surf(R))); // outer
  parts.push(patchTris(surf(R - T))); // inner
  // Rim strips close the 4 open edges (u=0, u=NU, v=0, v=NV).
  const outer = surf(R);
  const inner = surf(R - T);
  const rims = [];
  for (let i = 0; i < NU; i++) {
    rims.push(tri(outer[i][0], outer[i + 1][0], inner[i + 1][0]), tri(outer[i][0], inner[i + 1][0], inner[i][0]));
    rims.push(tri(outer[i][NV], inner[i + 1][NV], outer[i + 1][NV]), tri(outer[i][NV], inner[i][NV], inner[i + 1][NV]));
  }
  for (let j = 0; j < NV; j++) {
    rims.push(tri(outer[0][j], inner[0][j], inner[0][j + 1]), tri(outer[0][j], inner[0][j + 1], outer[0][j + 1]));
    rims.push(tri(outer[NU][j], outer[NU][j + 1], inner[NU][j + 1]), tri(outer[NU][j], inner[NU][j], inner[NU][j + 1]));
  }
  parts.push(rims);

  const all = [];
  for (const p of parts) all.push(...ensureOutward(p));
  return all;
}

/** Closed dome-up jellyfish: hemisphere cap (opening down) + 8 hanging tentacles. */
function buildJelly() {
  const R = 35;
  const T = 2;
  const NU = 32;
  const NV = 12;
  const parts = [];

  const cap = (r) => {
    const g = [];
    for (let i = 0; i <= NU; i++) {
      const u = (2 * Math.PI * i) / NU;
      const row = [];
      for (let j = 0; j <= NV; j++) {
        const v = ((Math.PI / 2) * j) / NV;
        row.push([r * Math.sin(v) * Math.cos(u), r * Math.sin(v) * Math.sin(u), r * Math.cos(v)]);
      }
      g.push(row);
    }
    return g;
  };

  parts.push(patchTris(cap(R))); // outer dome
  parts.push(patchTris(cap(R - T))); // inner dome
  // Equator rim ring.
  const outer = cap(R);
  const inner = cap(R - T);
  const rim = [];
  for (let i = 0; i < NU; i++) {
    const a = outer[i][NV];
    const b = outer[i + 1][NV];
    const c = inner[i + 1][NV];
    const d = inner[i][NV];
    rim.push(tri(a, b, c), tri(a, c, d));
  }
  parts.push(rim);

  // Tapered 4-sided tentacles hanging from the rim ring, slight outward splay.
  const NT = 8;
  const LEN = 42;
  for (let k = 0; k < NT; k++) {
    const u = (2 * Math.PI * k) / NT;
    const dir = [Math.cos(u), Math.sin(u), 0];
    const cx = (R - 1) * dir[0];
    const cy = (R - 1) * dir[1];
    const w0 = 5;
    const w1 = 2.2;
    const tilt = 0.18; // outward splay factor over the length
    const top = [];
    const bot = [];
    // Square cross-section corners around the center axis.
    for (const [sx, sy] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) {
      top.push([cx + (sx * w0) / 2, cy + (sy * w0) / 2, 2]);
      bot.push([
        cx + dir[0] * LEN * tilt + (sx * w1) / 2,
        cy + dir[1] * LEN * tilt + (sy * w1) / 2,
        2 - LEN,
      ]);
    }
    const t = [];
    for (let s = 0; s < 4; s++) {
      const s2 = (s + 1) % 4;
      t.push(tri(top[s], top[s2], bot[s2]), tri(top[s], bot[s2], bot[s]));
    }
    t.push(tri(top[0], top[2], top[1]), tri(top[0], top[3], top[2])); // top cap
    t.push(tri(bot[0], bot[1], bot[2]), tri(bot[0], bot[2], bot[3])); // tip cap
    parts.push(t);
  }

  const all = [];
  for (const p of parts) all.push(...ensureOutward(p));
  return all;
}

function writeBinaryStl(filePath, tris) {
  const buf = Buffer.alloc(84 + tris.length * 50);
  buf.write('SNKB repro model', 0, 'utf8');
  buf.writeUInt32LE(tris.length, 80);
  let o = 84;
  for (const [a, b, c] of tris) {
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0],
    ];
    const len = Math.hypot(n[0], n[1], n[2]) || 1;
    buf.writeFloatLE(n[0] / len, o);
    buf.writeFloatLE(n[1] / len, o + 4);
    buf.writeFloatLE(n[2] / len, o + 8);
    o += 12;
    for (const p of [a, b, c]) {
      buf.writeFloatLE(p[0], o);
      buf.writeFloatLE(p[1], o + 4);
      buf.writeFloatLE(p[2], o + 8);
      o += 12;
    }
    buf.writeUInt16LE(0, o);
    o += 2;
  }
  fs.writeFileSync(filePath, buf);
}

function diagnose(name, tris) {
  const flat = Float64Array.from(tris.flat(2));
  const faceData = computeFaceData(flat);
  const bb = bboxOf(tris);
  const size = [bb.hi[0] - bb.lo[0], bb.hi[1] - bb.lo[1], bb.hi[2] - bb.lo[2]];
  const id = evaluateOrientation(faceData, IDENTITY_QUAT);
  const best = findBestOrientation(faceData, {
    min: { x: bb.lo[0], y: bb.lo[1], z: bb.lo[2] },
    max: { x: bb.hi[0], y: bb.hi[1], z: bb.hi[2] },
  });
  console.log(`--- ${name} ---`);
  console.log(`faces=${faceData.count} volume=${signedVolume(tris).toFixed(0)}mm^3 size=${size.map((s) => s.toFixed(1)).join('x')}`);
  console.log(`identity: overhang=${(id.overhangFraction * 100).toFixed(1)}% (${id.overhangArea.toFixed(0)}mm^2)`);
  console.log(
    `solver: tilt=${best.tiltDeg.toFixed(1)}deg/${best.tiltAxis} support=${best.supportArea.toFixed(0)}mm^2 overhang=${(best.overhangFraction * 100).toFixed(1)}% contact=${best.contactArea.toFixed(0)}mm^2 height=${best.height.toFixed(1)} evals=${best.evaluated}`
  );
}

function main() {
  const outDir = process.argv[2] || path.join(__dirname, '..', 'repro-tmp');
  fs.mkdirSync(outDir, { recursive: true });
  const veil = buildVeil();
  const jelly = buildJelly();
  writeBinaryStl(path.join(outDir, 'repro_veil.stl'), veil);
  writeBinaryStl(path.join(outDir, 'repro_jelly.stl'), jelly);
  diagnose('repro_veil.stl', veil);
  diagnose('repro_jelly.stl', jelly);
  console.log('wrote', outDir);
}

if (require.main === module) main();
