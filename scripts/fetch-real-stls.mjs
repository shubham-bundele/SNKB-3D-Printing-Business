/**
 * scripts/fetch-real-stls.mjs
 *
 * Downloads real open-source binary/ASCII .stl files from verified GitHub repositories
 * into public/models/ (and mirroring to public/samples/products/ and samples/products/).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TARGET_DIRS = [
  path.join(__dirname, '..', 'public', 'models'),
  path.join(__dirname, '..', 'public', 'samples', 'products'),
  path.join(__dirname, '..', 'samples', 'products'),
];

for (const dir of TARGET_DIRS) {
  fs.mkdirSync(dir, { recursive: true });
}

const GITHUB_STLS = [
  {
    name: 'pr2_head_pan.stl',
    url: 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/stl/binary/pr2_head_pan.stl',
  },
  {
    name: 'pr2_head_tilt.stl',
    url: 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/stl/binary/pr2_head_tilt.stl',
  },
  {
    name: 'colored.stl',
    url: 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/stl/binary/colored.stl',
  },
  {
    name: 'slotted_disk.stl',
    url: 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/stl/ascii/slotted_disk.stl',
  },
  {
    name: '3dbenchy.stl',
    url: 'https://raw.githubusercontent.com/CreativeTools/3DBenchy/master/Single-part/3DBenchy.stl',
  },
];

async function fetchStl(item) {
  console.log(`Downloading ${item.name} from ${item.url}...`);
  const response = await fetch(item.url);
  if (!response.ok) {
    throw new Error(`Failed to download ${item.name}: HTTP ${response.status} ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  if (buffer.length < 50) {
    throw new Error(`File ${item.name} is too small (${buffer.length} bytes) to be valid.`);
  }

  for (const dir of TARGET_DIRS) {
    const dest = path.join(dir, item.name);
    fs.writeFileSync(dest, buffer);
  }

  let tris = 0;
  // If binary STL (starts after 80 byte header and buffer size matches header triangle count)
  if (buffer.length >= 84) {
    const potentialTris = buffer.readUInt32LE(80);
    const expectedBinarySize = 84 + potentialTris * 50;
    if (Math.abs(buffer.length - expectedBinarySize) < 200) {
      tris = potentialTris;
    }
  }

  console.log(`  ✓ Saved ${item.name} (${(buffer.length / 1024).toFixed(1)} KB${tris ? `, ${tris} tris` : ''})`);
  return { name: item.name, size: buffer.length, tris };
}

async function main() {
  console.log('=== Fetching Real Verified Open-Source STLs ===');
  let successCount = 0;
  for (const item of GITHUB_STLS) {
    try {
      await fetchStl(item);
      successCount++;
    } catch (err) {
      console.error(`  ✗ Error with ${item.name}:`, err.message);
    }
  }
  console.log(`\nSuccessfully downloaded and verified ${successCount}/${GITHUB_STLS.length} models.`);
}

main().catch((err) => {
  console.error('Fatal error in fetch script:', err);
  process.exit(1);
});
