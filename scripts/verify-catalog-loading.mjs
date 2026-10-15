/**
 * scripts/verify-catalog-loading.mjs
 *
 * Automated verification script asserting that all 15 catalog 3D models:
 * 1. Parse cleanly through Three.js STLLoader.
 * 2. Compute vertex normals, bounding box, and bounding sphere without NaN or Inf.
 * 3. Fit strictly inside the Bambu Lab A1 Mini build volume (180x180x180 mm).
 * 4. Multi-part assemblies have both valid base and accent STL geometries.
 * 5. Dynamic camera auto-framing distance calculation produces valid numbers.
 *
 * Usage:
 *   node scripts/verify-catalog-loading.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const PRODUCTS_JSON_PATH = path.join(ROOT_DIR, 'src', 'data', 'products.json');
const MODELS_DIR = path.join(ROOT_DIR, 'public', 'models');
const A1_MINI_MAX = { x: 180, y: 180, z: 180 };

function computeAutoFramingDistance(sphereRadius, fovDeg = 45, aspect = 1.33, coverage = 0.75) {
  const targetRadius = sphereRadius / Math.max(0.1, coverage);
  const fovRad = THREE.MathUtils.degToRad(fovDeg);
  const horizontalFov = 2 * Math.atan(Math.tan(fovRad / 2) * aspect);
  const distV = targetRadius / Math.sin(fovRad / 2);
  const distH = targetRadius / Math.sin(horizontalFov / 2);
  return Math.max(distV, distH, 45);
}

function verifyStlGeometry(loader, buffer, label) {
  let geometry;
  try {
    geometry = loader.parse(buffer);
  } catch (err) {
    return { success: false, error: `STLLoader parse failed: ${err.message}` };
  }

  if (geometry.index) {
    geometry = geometry.toNonIndexed();
  }

  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  const posAttr = geometry.getAttribute('position');
  if (!posAttr || posAttr.count === 0) {
    return { success: false, error: 'Empty geometry (0 vertices).' };
  }

  const triCount = posAttr.count / 3;
  const bb = geometry.boundingBox;
  const bs = geometry.boundingSphere;

  if (!bb || !bs) {
    return { success: false, error: 'Failed to compute bounding box or sphere.' };
  }

  const size = {
    x: bb.max.x - bb.min.x,
    y: bb.max.y - bb.min.y,
    z: bb.max.z - bb.min.z,
  };

  for (const axis of ['x', 'y', 'z']) {
    if (!Number.isFinite(size[axis]) || size[axis] <= 0) {
      return { success: false, error: `Degenerate dimension on ${axis}: ${size[axis]}` };
    }
    if (size[axis] > A1_MINI_MAX[axis] + 0.01) {
      return {
        success: false,
        error: `Exceeds A1 Mini build volume on ${axis} axis (${size[axis].toFixed(2)} mm > 180 mm).`,
      };
    }
  }

  if (!Number.isFinite(bs.radius) || bs.radius <= 0) {
    return { success: false, error: `Degenerate bounding sphere radius: ${bs.radius}` };
  }

  const normAttr = geometry.getAttribute('normal');
  if (!normAttr || normAttr.count !== posAttr.count) {
    return { success: false, error: 'Vertex normals count does not match position count.' };
  }

  // Check for NaN in coordinates
  for (let i = 0; i < Math.min(posAttr.array.length, 300); i++) {
    if (Number.isNaN(posAttr.array[i]) || !Number.isFinite(posAttr.array[i])) {
      return { success: false, error: `Found non-finite position at index ${i}` };
    }
  }

  const autoFramingDist = computeAutoFramingDistance(bs.radius);

  return {
    success: true,
    triCount,
    size,
    sphereRadius: bs.radius,
    autoFramingDist,
  };
}

function toArrayBuffer(buf) {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

async function main() {
  console.log('='.repeat(78));
  console.log('SNKB 3D Studio - Catalog 3D Preview Geometry Verification');
  console.log('Testing STLLoader normalization, bounding sphere & auto-framing math');
  console.log('='.repeat(78));

  if (!fs.existsSync(PRODUCTS_JSON_PATH)) {
    console.error(`FATAL: products.json not found at ${PRODUCTS_JSON_PATH}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(PRODUCTS_JSON_PATH, 'utf8');
  const products = JSON.parse(raw);
  console.log(`Found ${products.length} products in catalog.\n`);

  const loader = new STLLoader();
  let totalErrors = 0;
  let totalModelsChecked = 0;

  for (const prod of products) {
    console.log(`[Rank #${prod.trendingRank}] ${prod.name} (${prod.slug})`);
    console.log(`  Assembly: ${prod.assemblyType} | Parts: ${prod.partsCount}`);

    const combinedFile = path.join(MODELS_DIR, `${prod.slug}.stl`);
    if (!fs.existsSync(combinedFile)) {
      console.error(`  FAIL: Combined STL missing: ${combinedFile}`);
      totalErrors++;
      continue;
    }

    const combinedBuf = fs.readFileSync(combinedFile);
    const combinedRes = verifyStlGeometry(loader, toArrayBuffer(combinedBuf), `${prod.slug}.stl`);
    totalModelsChecked++;

    if (!combinedRes.success) {
      console.error(`  FAIL Combined STL: ${combinedRes.error}`);
      totalErrors++;
    } else {
      console.log(
        `  PASS Combined: ${combinedRes.triCount.toLocaleString()} tris | ` +
        `${combinedRes.size.x.toFixed(1)}x${combinedRes.size.y.toFixed(1)}x${combinedRes.size.z.toFixed(1)} mm | ` +
        `Radius: ${combinedRes.sphereRadius.toFixed(1)} mm | CamDist: ${combinedRes.autoFramingDist.toFixed(1)} mm`
      );
    }

    // Check Multi-Part STLs if configured
    if (prod.partsCount > 1 || prod.accentStlUrl) {
      const baseFile = path.join(MODELS_DIR, `${prod.slug}-base.stl`);
      const accentFile = path.join(MODELS_DIR, `${prod.slug}-accent.stl`);

      if (!fs.existsSync(baseFile)) {
        console.error(`  FAIL: Base plate STL missing: ${baseFile}`);
        totalErrors++;
      } else {
        const baseBuf = fs.readFileSync(baseFile);
        const baseRes = verifyStlGeometry(loader, toArrayBuffer(baseBuf), `${prod.slug}-base.stl`);
        totalModelsChecked++;
        if (!baseRes.success) {
          console.error(`  FAIL Base Plate STL: ${baseRes.error}`);
          totalErrors++;
        } else {
          console.log(`    Plate 1 (Base): ${baseRes.triCount.toLocaleString()} tris | ${baseRes.size.x.toFixed(1)}x${baseRes.size.y.toFixed(1)}x${baseRes.size.z.toFixed(1)} mm`);
        }
      }

      if (!fs.existsSync(accentFile)) {
        console.error(`  FAIL: Accent plate STL missing: ${accentFile}`);
        totalErrors++;
      } else {
        const accentBuf = fs.readFileSync(accentFile);
        const accentRes = verifyStlGeometry(loader, toArrayBuffer(accentBuf), `${prod.slug}-accent.stl`);
        totalModelsChecked++;
        if (!accentRes.success) {
          console.error(`  FAIL Accent Plate STL: ${accentRes.error}`);
          totalErrors++;
        } else {
          console.log(`    Plate 2 (Accent): ${accentRes.triCount.toLocaleString()} tris | ${accentRes.size.x.toFixed(1)}x${accentRes.size.y.toFixed(1)}x${accentRes.size.z.toFixed(1)} mm`);
        }
      }
    }

    console.log('');
  }

  console.log('='.repeat(78));
  console.log(`Catalog Verification Complete:`);
  console.log(`  Models checked: ${totalModelsChecked}`);
  console.log(`  Failures: ${totalErrors}`);
  console.log('='.repeat(78));

  if (totalErrors > 0) {
    console.error(`\nFAILED with ${totalErrors} error(s).`);
    process.exit(1);
  } else {
    console.log(`\nALL ${totalModelsChecked} MODEL GEOMETRIES PASSED VALIDATION WITH ZERO ERRORS.`);
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
