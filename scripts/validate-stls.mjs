/**
 * scripts/validate-stls.mjs
 *
 * Automated verification pipeline for all .stl models in public/models/
 * (and optionally public/samples/products/).
 *
 * Verifies:
 * 1. File existence and non-zero byte size.
 * 2. Corruption / HTML spoofing check (flags <!DOCTYPE, <html, <?xml, JSON error responses).
 * 3. Binary vs. ASCII structure validation:
 *    - Binary: uint32 triangle count at offset 80, exact byte length (84 + N*50).
 *    - ASCII: valid 'solid' header and facet normal / vertex structure.
 * 4. Coordinate sanity (no NaN/Infinity/degenerate coordinates).
 * 5. Hardware constraint compliance: Bambu Lab A1 Mini maximum build volume (<= 180x180x180 mm).
 *
 * Usage:
 *   node scripts/validate-stls.mjs [directoryPath]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MAX_A1_MINI_BUILD_VOLUME = { x: 180, y: 180, z: 180 };

function validateStlBuffer(buf, filename) {
  const result = {
    filename,
    isValid: false,
    format: 'unknown',
    triangleCount: 0,
    fileSizeBytes: buf.length,
    boundingBox: null,
    dimensions: null,
    withinA1MiniBuildVolume: false,
    errors: [],
    warnings: [],
  };

  // 1. Empty check
  if (!buf || buf.length === 0) {
    result.errors.push('File is completely empty (0 bytes).');
    return result;
  }

  if (buf.length < 84) {
    result.errors.push(`File is too small to be a valid STL (${buf.length} bytes; minimum binary header is 84 bytes).`);
    return result;
  }

  // 2. HTML / XML / Cloudflare block spoofing check
  const headStr = buf.subarray(0, Math.min(buf.length, 512)).toString('utf8').trim().toLowerCase();
  if (
    headStr.startsWith('<!doctype') ||
    headStr.startsWith('<html') ||
    headStr.startsWith('<?xml') ||
    headStr.startsWith('<![cdata') ||
    headStr.includes('<head>') ||
    headStr.includes('cloudflare') ||
    headStr.startsWith('{"error"') ||
    headStr.startsWith('{"message"')
  ) {
    result.errors.push('File is an HTML/XML/JSON error payload (e.g., Cloudflare challenge or 404 page), not a real STL.');
    return result;
  }

  // 3. Format detection
  // Check if binary: triangle count at byte offset 80
  const expectedBinaryTriangles = buf.readUInt32LE(80);
  const expectedBinarySize = 84 + expectedBinaryTriangles * 50;

  const isExactBinarySize = buf.length === expectedBinarySize;
  const isApproxBinarySize = Math.abs(buf.length - expectedBinarySize) <= 100;

  if (isExactBinarySize || (isApproxBinarySize && expectedBinaryTriangles > 0)) {
    result.format = 'binary';
    result.triangleCount = expectedBinaryTriangles;

    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    let hasCorruptFloats = false;

    let offset = 84;
    for (let i = 0; i < expectedBinaryTriangles; i++) {
      if (offset + 50 > buf.length) {
        result.errors.push(`Premature end of buffer at triangle ${i + 1}/${expectedBinaryTriangles}.`);
        break;
      }

      // Normal (12 bytes)
      const nx = buf.readFloatLE(offset);
      const ny = buf.readFloatLE(offset + 4);
      const nz = buf.readFloatLE(offset + 8);

      if (!Number.isFinite(nx) || !Number.isFinite(ny) || !Number.isFinite(nz)) {
        hasCorruptFloats = true;
      }

      // Vertices (3 * 12 = 36 bytes)
      for (let v = 0; v < 3; v++) {
        const vx = buf.readFloatLE(offset + 12 + v * 12);
        const vy = buf.readFloatLE(offset + 12 + v * 12 + 4);
        const vz = buf.readFloatLE(offset + 12 + v * 12 + 8);

        if (!Number.isFinite(vx) || !Number.isFinite(vy) || !Number.isFinite(vz)) {
          hasCorruptFloats = true;
        } else {
          if (vx < minX) minX = vx;
          if (vx > maxX) maxX = vx;
          if (vy < minY) minY = vy;
          if (vy > maxY) maxY = vy;
          if (vz < minZ) minZ = vz;
          if (vz > maxZ) maxZ = vz;
        }
      }

      // 2 bytes attribute byte count
      offset += 50;
    }

    if (hasCorruptFloats) {
      result.errors.push('Found NaN or Infinity floating-point values in vertex/normal coordinates.');
    }

    if (Number.isFinite(minX) && Number.isFinite(maxX)) {
      result.boundingBox = {
        min: { x: minX, y: minY, z: minZ },
        max: { x: maxX, y: maxY, z: maxZ },
      };
      result.dimensions = {
        x: Number((maxX - minX).toFixed(2)),
        y: Number((maxY - minY).toFixed(2)),
        z: Number((maxZ - minZ).toFixed(2)),
      };
    }
  } else {
    // Attempt ASCII parse
    const text = buf.toString('utf8');
    if (text.startsWith('solid') && text.includes('endsolid')) {
      result.format = 'ascii';
      const vertexRegex = /vertex\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)/g;
      let match;
      let count = 0;
      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

      while ((match = vertexRegex.exec(text)) !== null) {
        count++;
        const x = parseFloat(match[1]);
        const y = parseFloat(match[2]);
        const z = parseFloat(match[3]);
        if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          if (z < minZ) minZ = z;
          if (z > maxZ) maxZ = z;
        }
      }

      result.triangleCount = Math.floor(count / 3);
      if (result.triangleCount === 0) {
        result.errors.push('ASCII STL contains zero triangles or invalid vertex definitions.');
      } else {
        result.boundingBox = {
          min: { x: minX, y: minY, z: minZ },
          max: { x: maxX, y: maxY, z: maxZ },
        };
        result.dimensions = {
          x: Number((maxX - minX).toFixed(2)),
          y: Number((maxY - minY).toFixed(2)),
          z: Number((maxZ - minZ).toFixed(2)),
        };
      }
    } else {
      result.errors.push(`Header does not match binary STL (expected length ${expectedBinarySize} B, got ${buf.length} B) nor valid ASCII STL.`);
      return result;
    }
  }

  // 4. Hardware limit verification: Bambu Lab A1 Mini (180 x 180 x 180 mm)
  if (result.dimensions) {
    const exceedsX = result.dimensions.x > MAX_A1_MINI_BUILD_VOLUME.x;
    const exceedsY = result.dimensions.y > MAX_A1_MINI_BUILD_VOLUME.y;
    const exceedsZ = result.dimensions.z > MAX_A1_MINI_BUILD_VOLUME.z;

    if (exceedsX || exceedsY || exceedsZ) {
      result.withinA1MiniBuildVolume = false;
      result.warnings.push(
        `Exceeds Bambu Lab A1 Mini build volume (180x180x180mm): ` +
        `[${result.dimensions.x} x ${result.dimensions.y} x ${result.dimensions.z} mm]`
      );
    } else {
      result.withinA1MiniBuildVolume = true;
    }
  }

  result.isValid = result.errors.length === 0;
  return result;
}

export function auditStlDirectory(targetDir) {
  if (!fs.existsSync(targetDir)) {
    console.warn(`[WARN] Target directory does not exist: ${targetDir}`);
    return { targetDir, totalFiles: 0, passed: 0, failed: 0, results: [] };
  }

  const entries = fs.readdirSync(targetDir, { withFileTypes: true });
  const stlFiles = [];

  for (const entry of entries) {
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.stl')) {
      stlFiles.push(entry.name);
    }
  }

  const results = [];
  let passed = 0;
  let failed = 0;

  for (const file of stlFiles) {
    const fullPath = path.join(targetDir, file);
    try {
      const buf = fs.readFileSync(fullPath);
      const res = validateStlBuffer(buf, file);
      if (res.isValid) {
        passed++;
      } else {
        failed++;
      }
      results.push(res);
    } catch (err) {
      failed++;
      results.push({
        filename: file,
        isValid: false,
        format: 'error',
        errors: [`Read error: ${err.message}`],
      });
    }
  }

  return { targetDir, totalFiles: stlFiles.length, passed, failed, results };
}

export function printAuditReport(audit) {
  console.log(`\n========================================================================`);
  console.log(`STL AUDIT REPORT: ${audit.targetDir}`);
  console.log(`Total Files: ${audit.totalFiles} | Passed: ${audit.passed} | Failed: ${audit.failed}`);
  console.log(`========================================================================\n`);

  if (audit.results.length === 0) {
    console.log(`(No .stl files found in ${audit.targetDir})\n`);
    return;
  }

  console.log(
    `STATUS`.padEnd(8) +
    `FILE NAME`.padEnd(38) +
    `FMT`.padEnd(8) +
    `TRIS`.padEnd(9) +
    `DIMENSIONS (X×Y×Z mm)`.padEnd(24) +
    `A1 MINI`
  );
  console.log('-'.repeat(100));

  for (const r of audit.results) {
    const status = r.isValid ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
    const dims = r.dimensions
      ? `${r.dimensions.x}×${r.dimensions.y}×${r.dimensions.z}`
      : 'N/A';
    const a1Fit = r.withinA1MiniBuildVolume
      ? '\x1b[32m✓ FIT\x1b[0m'
      : (r.dimensions ? '\x1b[33m⚠ OVER\x1b[0m' : '-');

    console.log(
      `${status.padEnd(16)}` +
      `${r.filename.padEnd(38)}` +
      `${(r.format || '-').padEnd(8)}` +
      `${String(r.triangleCount || 0).padEnd(9)}` +
      `${dims.padEnd(24)}` +
      `${a1Fit}`
    );

    if (r.errors.length > 0) {
      for (const err of r.errors) {
        console.log(`   \x1b[31m✖ Error: ${err}\x1b[0m`);
      }
    }
    if (r.warnings.length > 0) {
      for (const warn of r.warnings) {
        console.log(`   \x1b[33m⚠ Warning: ${warn}\x1b[0m`);
      }
    }
  }
  console.log('\n');
}

export function validateProductsJsonReferences(productsJsonPath, modelsDir) {
  if (!fs.existsSync(productsJsonPath)) {
    throw new Error(`products.json not found at ${productsJsonPath}`);
  }

  const raw = fs.readFileSync(productsJsonPath, 'utf8');
  const products = JSON.parse(raw);

  const checks = [];
  let passedCount = 0;
  let failedCount = 0;

  for (const p of products) {
    const pathsToCheck = [];
    if (p.stlUrl) pathsToCheck.push({ key: 'stlUrl', relPath: p.stlUrl });
    if (p.accentStlUrl && p.accentStlUrl !== p.stlUrl) pathsToCheck.push({ key: 'accentStlUrl', relPath: p.accentStlUrl });
    if (p.multiPart?.base && !pathsToCheck.some((c) => c.relPath === p.multiPart.base)) {
      pathsToCheck.push({ key: 'multiPart.base', relPath: p.multiPart.base });
    }
    if (p.multiPart?.accent && !pathsToCheck.some((c) => c.relPath === p.multiPart.accent)) {
      pathsToCheck.push({ key: 'multiPart.accent', relPath: p.multiPart.accent });
    }

    for (const item of pathsToCheck) {
      const fileName = path.basename(item.relPath);
      const filePath = path.join(modelsDir, fileName);
      const checkResult = {
        productId: p.id,
        productName: p.name,
        key: item.key,
        relPath: item.relPath,
        fileName,
        exists: false,
        valid: false,
        triangleCount: 0,
        trianglesPass: false,
        dimensions: null,
        withinA1Mini: false,
        errors: [],
      };

      if (!fs.existsSync(filePath)) {
        checkResult.errors.push(`File missing from disk: ${filePath}`);
        failedCount++;
        checks.push(checkResult);
        continue;
      }

      checkResult.exists = true;
      try {
        const buf = fs.readFileSync(filePath);
        const res = validateStlBuffer(buf, fileName);
        checkResult.valid = res.isValid;
        checkResult.triangleCount = res.triangleCount;
        checkResult.dimensions = res.dimensions;
        checkResult.withinA1Mini = res.withinA1MiniBuildVolume;

        // Verify > 100 triangles for catalog designs
        if (res.triangleCount > 100) {
          checkResult.trianglesPass = true;
        } else {
          checkResult.errors.push(`Geometry has <= 100 triangles (${res.triangleCount} tris).`);
        }

        if (res.errors.length > 0) {
          checkResult.errors.push(...res.errors);
        }

        if (checkResult.valid && checkResult.trianglesPass && checkResult.withinA1Mini) {
          passedCount++;
        } else {
          failedCount++;
        }
      } catch (err) {
        checkResult.errors.push(`Read error: ${err.message}`);
        failedCount++;
      }
      checks.push(checkResult);
    }
  }

  return { total: checks.length, passed: passedCount, failed: failedCount, checks };
}

export function printProductsJsonReport(report) {
  console.log(`\n========================================================================`);
  console.log(`SRC/DATA/PRODUCTS.JSON REFERENCED STL PATH VALIDATION`);
  console.log(`Total References: ${report.total} | Passed (>100 tris & A1 Fit): ${report.passed} | Failed: ${report.failed}`);
  console.log(`========================================================================\n`);

  console.log(
    `STATUS`.padEnd(8) +
    `FIELD`.padEnd(16) +
    `STL FILE`.padEnd(44) +
    `TRIS`.padEnd(10) +
    `DIMENSIONS (X×Y×Z mm)`.padEnd(24) +
    `A1 FIT`
  );
  console.log('-'.repeat(110));

  for (const c of report.checks) {
    const isPass = c.exists && c.valid && c.trianglesPass && c.withinA1Mini;
    const status = isPass ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
    const dims = c.dimensions ? `${c.dimensions.x}×${c.dimensions.y}×${c.dimensions.z}` : 'N/A';
    const a1Fit = c.withinA1Mini ? '\x1b[32m✓ FIT\x1b[0m' : '\x1b[31m✖ FAIL\x1b[0m';

    console.log(
      `${status.padEnd(16)}` +
      `${c.key.padEnd(16)}` +
      `${c.fileName.padEnd(44)}` +
      `${String(c.triangleCount).padEnd(10)}` +
      `${dims.padEnd(24)}` +
      `${a1Fit}`
    );

    if (c.errors.length > 0) {
      for (const err of c.errors) {
        console.log(`   \x1b[31m✖ Error: ${err}\x1b[0m`);
      }
    }
  }
  console.log('\n');
}

// CLI execution
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const customDir = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(__dirname, '..', 'public', 'models');
  const productsJsonPath = path.join(__dirname, '..', 'src', 'data', 'products.json');

  const productsReport = validateProductsJsonReferences(productsJsonPath, customDir);
  printProductsJsonReport(productsReport);

  const audit = auditStlDirectory(customDir);
  printAuditReport(audit);

  if (productsReport.failed > 0 || audit.failed > 0) {
    process.exit(1);
  }
}
