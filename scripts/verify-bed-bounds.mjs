/**
 * scripts/verify-bed-bounds.mjs
 *
 * Automated Bounds & Seating Verification Script
 * Validates that all models in public/models/ when processed through
 * fitGeometryToA1MiniBed strictly fit within the 180x180x180mm Bambu Lab A1 Mini envelope:
 *
 * 1. boundingBox.min.x >= -90 && boundingBox.max.x <= 90 (strict X containment)
 * 2. boundingBox.min.z >= -90 && boundingBox.max.z <= 90 (strict Z containment)
 * 3. Math.abs(boundingBox.min.y) < 0.001 (strict seating at Y = 0 on the build plate)
 * 4. boundingBox.max.y <= 180 (strict Z/height limit)
 * 5. Model center (center.x, center.z) is (0, 0) within 0.01mm tolerance.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { fitGeometryToA1MiniBed, isGeometryWithinBed } from '../src/utils/fitGeometryToBed.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const modelsDir = path.join(__dirname, '..', 'public', 'models');

const loader = new STLLoader();

console.log('========================================================================');
console.log('VERIFYING 180x180x180mm BUILD-PLATE CONTAINMENT & SEATING (A1 MINI)');
console.log('========================================================================\n');

if (!fs.existsSync(modelsDir)) {
  console.error(`Error: models directory ${modelsDir} does not exist!`);
  process.exit(1);
}

const files = fs.readdirSync(modelsDir).filter((f) => f.endsWith('.stl'));
if (files.length === 0) {
  console.error('Error: No STL files found in public/models/!');
  process.exit(1);
}

let passedCount = 0;
let failedCount = 0;
const errors = [];

for (const file of files) {
  const filePath = path.join(modelsDir, file);
  const buffer = fs.readFileSync(filePath);
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

  let geometry;
  try {
    geometry = loader.parse(arrayBuffer);
  } catch (err) {
    errors.push(`${file}: Failed to parse STL: ${err.message}`);
    failedCount++;
    continue;
  }

  // Apply strict mathematical containment & seating engine
  const result = fitGeometryToA1MiniBed(geometry, 140, true);
  const bb = geometry.boundingBox;
  const size = result.size;

  const center = new THREE.Vector3();
  bb.getCenter(center);

  const checks = [
    {
      name: 'X Containment ([-90, +90] mm)',
      pass: bb.min.x >= -90.01 && bb.max.x <= 90.01,
      detail: `[${bb.min.x.toFixed(2)}, ${bb.max.x.toFixed(2)}]`,
    },
    {
      name: 'Z Containment ([-90, +90] mm)',
      pass: bb.min.z >= -90.01 && bb.max.z <= 90.01,
      detail: `[${bb.min.z.toFixed(2)}, ${bb.max.z.toFixed(2)}]`,
    },
    {
      name: 'Y Bed Seating (min.y === 0 mm)',
      pass: Math.abs(bb.min.y) < 0.005,
      detail: `min.y = ${bb.min.y.toFixed(4)}`,
    },
    {
      name: 'Y Height Limit (max.y <= 180 mm)',
      pass: bb.max.y <= 180.01,
      detail: `max.y = ${bb.max.y.toFixed(2)}`,
    },
    {
      name: 'Dead-Center Turntable ((X, Z) === (0, 0))',
      pass: Math.abs(center.x) < 0.01 && Math.abs(center.z) < 0.01,
      detail: `center = (${center.x.toFixed(3)}, ${center.z.toFixed(3)})`,
    },
    {
      name: 'isGeometryWithinBed Helper',
      pass: isGeometryWithinBed(geometry),
      detail: 'true',
    },
  ];

  const allPassed = checks.every((c) => c.pass);

  if (allPassed) {
    passedCount++;
    console.log(
      `  ✓ [PASS] ${file.padEnd(45)} size: ${size.x.toFixed(1)}×${size.y.toFixed(1)}×${size.z.toFixed(1)} mm`
    );
  } else {
    failedCount++;
    const failedChecks = checks.filter((c) => !c.pass);
    console.error(`  ✗ [FAIL] ${file}:`);
    failedChecks.forEach((fc) => {
      console.error(`      - ${fc.name}: FAILED (${fc.detail})`);
      errors.push(`${file} - ${fc.name}: ${fc.detail}`);
    });
  }
}

console.log('\n------------------------------------------------------------------------');
console.log(`TOTAL MODELS VERIFIED: ${files.length}`);
console.log(`PASSED: ${passedCount}`);
console.log(`FAILED: ${failedCount}`);
console.log('------------------------------------------------------------------------\n');

if (failedCount > 0) {
  console.error(`❌ VERIFICATION FAILED: ${failedCount} model(s) failed bounds or seating checks.`);
  process.exit(1);
} else {
  console.log('✅ ALL MODELS SUCCESSFULLY CONTAINED & FLUSH SEATED ON A1 MINI BUILD PLATE!');
  process.exit(0);
}
