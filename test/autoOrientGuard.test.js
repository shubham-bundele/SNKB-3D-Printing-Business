'use strict';

/**
 * test/autoOrientGuard.test.js
 *
 * Regression guard for the "Auto-Orient makes the whole 3D section disappear"
 * bug: `setOrientResult({ rotated: true, ... })` omitted `tiltDeg` / `tiltAxis`
 * / `fromPct` / `toPct`, while the arena-header tooltip dereferenced
 * `orientResult.tiltDeg.toFixed(0)` unconditionally whenever `rotated` was true.
 * That threw a TypeError during render and React 19 unmounted the entire
 * client-only island root, blanking the whole cockpit.
 *
 * These are source-text guardrails (consistent with webglContextAndSizing /
 * mobileResponsive tests) that assert:
 *   1. the rotated branch now supplies every field the render reads;
 *   2. the render never calls `.toFixed()` on a possibly-undefined orientResult
 *      field without a `typeof ... === 'number'` guard;
 *   3. the cockpit island is wrapped in an error boundary so a future render
 *      crash degrades gracefully instead of vanishing.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', ...rel.split('/')), 'utf8');

const STL_VIEWER = read('src/components/StlViewer.jsx');
const SLICER_ISLAND = read('src/components/SlicerIsland.jsx');
const INDEX = read('src/pages/index.astro');

test('Auto-Orient rotated result supplies every field the render reads', () => {
  // The rotated:true branch must define the tilt telemetry fields.
  assert.ok(
    STL_VIEWER.includes('rotated: true,\n                tiltDeg,'),
    'rotated branch must include tiltDeg'
  );
  assert.ok(STL_VIEWER.includes('tiltAxis,'), 'rotated branch must include tiltAxis');
  assert.ok(STL_VIEWER.includes('fromPct,'), 'rotated branch must include fromPct');
  assert.ok(STL_VIEWER.includes('toPct,'), 'rotated branch must include toPct');
  // And they must be computed from the orientation quaternions / metrics.
  assert.ok(STL_VIEWER.includes('q0.angleTo(targetQuat)'), 'tilt angle must be derived from the quaternions');
  assert.ok(STL_VIEWER.includes('bestMetrics.overhangFraction * 100'), 'post-rotation overhang % must come from bestMetrics');
});

test('Arena tooltip never dereferences an unguarded orientResult field', () => {
  // Every `orientResult.<tilt field>.toFixed(...)` call must live on a line that
  // also carries the `typeof orientResult.tiltDeg === 'number'` guard.
  const offenders = STL_VIEWER.split('\n').filter(
    (line) =>
      /orientResult\.(tiltDeg|fromPct|toPct)\.toFixed\(/.test(line) &&
      !line.includes("typeof orientResult.tiltDeg === 'number'")
  );
  assert.equal(
    offenders.length,
    0,
    `unguarded orientResult deref on line(s): ${offenders.join(' | ')}`
  );
  // The guards themselves must exist (both the tooltip and the inline badge).
  assert.ok(
    STL_VIEWER.includes("orientResult?.rotated && typeof orientResult.tiltDeg === 'number'"),
    'the tooltip must gate on typeof orientResult.tiltDeg === number'
  );
});

test('Slicer cockpit island is wrapped in an error boundary', () => {
  assert.ok(SLICER_ISLAND.includes('getDerivedStateFromError'), 'must implement getDerivedStateFromError');
  assert.ok(SLICER_ISLAND.includes('componentDidCatch'), 'must log via componentDidCatch');
  assert.ok(SLICER_ISLAND.includes('<StlViewer />'), 'must render the StlViewer inside the boundary');
  assert.ok(INDEX.includes("from '../components/SlicerIsland.jsx'"), 'index.astro must import the guarded island');
  assert.ok(INDEX.includes('<SlicerIsland client:only="react" />'), 'index.astro must mount the guarded island');
});
