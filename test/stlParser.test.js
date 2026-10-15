'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseStl,
  parse3mf,
  isBinaryStl,
  is3mf,
} = require('../src/services/stlParser');
const {
  createBinaryBoxStlBuffer,
  createAsciiBoxStlBuffer,
  createBox3mfBuffer,
} = require('./helpers/stlGenerator');

const EPSILON = 1e-6;

test('parses binary STL bounding box, volume, and surface area', () => {
  const buffer = createBinaryBoxStlBuffer({ x: 20, y: 30, z: 40 });
  const geometry = parseStl(buffer);

  assert.equal(geometry.format, 'binary');
  assert.equal(geometry.triangleCount, 12);
  assert.ok(Math.abs(geometry.dimensions.x - 20) < EPSILON);
  assert.ok(Math.abs(geometry.dimensions.y - 30) < EPSILON);
  assert.ok(Math.abs(geometry.dimensions.z - 40) < EPSILON);
  assert.ok(Math.abs(geometry.volumeMm3 - 20 * 30 * 40) < 1e-3);
  // Box surface area: 2 * (20*30 + 30*40 + 20*40) = 2 * (600 + 1200 + 800) = 5200 mm^2
  assert.ok(Math.abs(geometry.surfaceAreaMm2 - 5200) < 1e-3);
});

test('parses ASCII STL bounding box, volume, and surface area', () => {
  const buffer = createAsciiBoxStlBuffer({ x: 50, y: 50, z: 20 });
  const geometry = parseStl(buffer);

  assert.equal(geometry.format, 'ascii');
  assert.equal(geometry.triangleCount, 12);
  assert.ok(Math.abs(geometry.dimensions.x - 50) < EPSILON);
  assert.ok(Math.abs(geometry.dimensions.y - 50) < EPSILON);
  assert.ok(Math.abs(geometry.dimensions.z - 20) < EPSILON);
  assert.ok(Math.abs(geometry.volumeMm3 - 50 * 50 * 20) < 1e-3);
  // Box surface area: 2 * (50*50 + 50*20 + 50*20) = 2 * (2500 + 1000 + 1000) = 9000 mm^2
  assert.ok(Math.abs(geometry.surfaceAreaMm2 - 9000) < 1e-3);
});

test('binary detection ignores a "solid" word in the header', () => {
  const buffer = createBinaryBoxStlBuffer({ x: 10, y: 10, z: 10 });
  buffer.write('solid sneaky', 0, 'utf8');

  assert.equal(isBinaryStl(buffer), true);
  assert.equal(parseStl(buffer).format, 'binary');
});

test('rejects malformed ASCII STL with no vertices', () => {
  assert.throws(() => parseStl(Buffer.from('solid empty\nendsolid empty', 'utf8')));
});

test('rejects an empty buffer', () => {
  assert.throws(() => parseStl(Buffer.alloc(0)));
});

test('normalizes negative zero in bounding box output', () => {
  const geometry = parseStl(createAsciiBoxStlBuffer({ x: 0, y: 0, z: 0 }));
  assert.equal(Object.is(geometry.dimensions.x, -0), false);
});

test('parses 3MF zip buffer bounding box, volume, and surface area', () => {
  const buffer = createBox3mfBuffer({ x: 30, y: 40, z: 50 });
  assert.equal(is3mf(buffer), true);

  const geometry = parseStl(buffer, 'test-part.3mf');
  assert.equal(geometry.format, '3mf');
  assert.equal(geometry.triangleCount, 12);
  assert.ok(Math.abs(geometry.dimensions.x - 30) < EPSILON);
  assert.ok(Math.abs(geometry.dimensions.y - 40) < EPSILON);
  assert.ok(Math.abs(geometry.dimensions.z - 50) < EPSILON);
  assert.ok(Math.abs(geometry.volumeMm3 - 30 * 40 * 50) < 1e-3);
  // Surface area: 2 * (30*40 + 40*50 + 30*50) = 2 * (1200 + 2000 + 1500) = 9400 mm^2
  assert.ok(Math.abs(geometry.surfaceAreaMm2 - 9400) < 1e-3);
});

test('rejects corrupted 3MF zip archive', () => {
  const corrupted = Buffer.from([0x50, 0x4B, 0x03, 0x04, 0x00, 0x00, 0x12, 0x34]);
  assert.throws(() => parse3mf(corrupted), /Invalid 3MF/);
});

