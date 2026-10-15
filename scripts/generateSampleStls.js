'use strict';

/**
 * Regenerates the STL fixtures in `samples/` used for manual testing and the
 * README examples.
 *
 *   npm run samples
 */

const fs = require('node:fs');
const path = require('node:path');

const {
  createBinaryBoxStlBuffer,
  createAsciiBoxStlBuffer,
} = require('../test/helpers/stlGenerator');

const outputDirectory = path.join(__dirname, '..', 'samples');

const samples = [
  ['cube_20mm_binary.stl', createBinaryBoxStlBuffer({ x: 20, y: 20, z: 20 })],
  ['plate_50x50x20_ascii.stl', createAsciiBoxStlBuffer({ x: 50, y: 50, z: 20 })],
  ['oversized_200mm_binary.stl', createBinaryBoxStlBuffer({ x: 200, y: 50, z: 50 })],
];

fs.mkdirSync(outputDirectory, { recursive: true });

for (const [name, buffer] of samples) {
  const target = path.join(outputDirectory, name);
  fs.writeFileSync(target, buffer);
  console.log(`wrote ${path.relative(process.cwd(), target)} (${buffer.length} bytes)`);
}
