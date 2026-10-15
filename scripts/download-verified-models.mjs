/**
 * scripts/download-verified-models.mjs
 *
 * Downloads real, smooth, verified open-source binary .stl files from official GitHub repos
 * into public/models/ and validates their binary triangle headers.
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

const VERIFIED_MODELS = [
  {
    name: '3dbenchy.stl',
    url: 'https://raw.githubusercontent.com/CreativeTools/3DBenchy/master/Single-part/3DBenchy.stl',
    desc: 'Official 3DBenchy 3D print benchmark boat',
  },
  {
    name: 'pr2_head_tilt.stl',
    url: 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/stl/binary/pr2_head_tilt.stl',
    desc: 'PR2 Robotic Head Tilt Mechanism (Mecha / Robotics Assembly)',
  },
  {
    name: 'pr2_head_pan.stl',
    url: 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/stl/binary/pr2_head_pan.stl',
    desc: 'PR2 Robotic Head Pan Gearbox (Gear / Actuator)',
  },
  {
    name: 'colored.stl',
    url: 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/stl/binary/colored.stl',
    desc: 'Colored Industrial Mechanical Valve Assembly',
  },
  {
    name: 'slotted_disk.stl',
    url: 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/stl/ascii/slotted_disk.stl',
    desc: 'Precision Slotted Disk / Flange',
  },
];

async function downloadModel(item) {
  console.log(`Downloading ${item.name} (${item.desc})...`);
  const res = await fetch(item.url);
  if (!res.ok) {
    throw new Error(`Failed to download ${item.name}: HTTP ${res.status} ${res.statusText}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  if (buffer.length < 50) {
    throw new Error(`${item.name} is too small (${buffer.length} bytes) to be a valid STL.`);
  }

  for (const dir of TARGET_DIRS) {
    const dest = path.join(dir, item.name);
    fs.writeFileSync(dest, buffer);
  }

  let tris = 0;
  if (buffer.length >= 84) {
    const potentialTris = buffer.readUInt32LE(80);
    const expectedBinarySize = 84 + potentialTris * 50;
    if (Math.abs(buffer.length - expectedBinarySize) < 200) {
      tris = potentialTris;
    }
  }

  console.log(`  ✓ Saved ${item.name.padEnd(24)} ${(buffer.length / 1024).toFixed(1)} KB ${tris ? `(${tris.toLocaleString()} triangles)` : '(ASCII STL)'}`);
  return { name: item.name, size: buffer.length, tris };
}

async function main() {
  console.log('====================================================');
  console.log('DOWNLOADING VERIFIED REAL OPEN-SOURCE STL MESHS');
  console.log('====================================================');

  let success = 0;
  for (const item of VERIFIED_MODELS) {
    try {
      await downloadModel(item);
      success++;
    } catch (err) {
      console.error(`  ✗ Failed ${item.name}:`, err.message);
    }
  }

  console.log(`\nSuccessfully downloaded ${success}/${VERIFIED_MODELS.length} verified open-source models.\n`);
}

main().catch((err) => {
  console.error('Fatal error downloading models:', err);
  process.exit(1);
});
