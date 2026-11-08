'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const distHtmlPath = path.join(__dirname, '..', 'dist', 'index.html');

test('Frontend Storefront - static build verification', () => {
  assert.ok(
    fs.existsSync(distHtmlPath),
    'dist/index.html should exist after running astro build'
  );

  const html = fs.readFileSync(distHtmlPath, 'utf8');

  // Verify Title and Meta
  assert.ok(html.includes('SNKB 3D Studio'), 'HTML should contain studio branding');

  // Verify Hero Section
  assert.ok(
    html.includes('Precision 3D Printing Engineered for') || html.includes('Rapid Turnaround'),
    'Hero section title should be present'
  );

  // Verify Unified Catalog Filter Bar (rebuilt in Phase 30 around the REAL
  // customer design archive in public/models/customer/)
  assert.ok(
    html.includes('Utility &amp; Everyday') || html.includes('Utility & Everyday'),
    'Utility & Everyday catalog filter should be present'
  );
  assert.ok(
    html.includes('Maker &amp; Machine Hardware') || html.includes('Maker & Machine Hardware'),
    'Maker & Machine Hardware catalog filter should be present'
  );
  assert.ok(
    html.includes('Gaming Gear Stands'),
    'Gaming Gear Stands catalog filter should be present'
  );

  // Verify the catalog is now built from the real customer archive
  assert.ok(
    html.includes('/models/customer/'),
    'Catalog designs must reference the real customer STL/3MF archive'
  );
  assert.ok(html.includes('/models/customer/bag-clip-6mm.3mf'), 'Bag clip design should be referenced');
  assert.ok(html.includes('/models/customer/nataraja-brass-square.stl'), 'Nataraja design should be referenced');
  assert.ok(html.includes('/models/customer/sweeping-name-plate-2line.3mf'), 'Nameplate design should be referenced');

  // Verify product posters (CAD-style placeholders until the live WebGL
  // snapshot finishes rendering — no fake product illustrations)
  assert.ok(
    html.includes('/images/products/customer/'),
    'Catalog cards should reference the customer poster SVGs'
  );
  assert.ok(
    html.includes('bag-clip-6mm.svg') && html.includes('sweeping-name-plate-2line.svg'),
    'Poster SVGs for real designs should be referenced'
  );

  // Verify Indian localization and material standards
  assert.ok(html.includes('₹') || html.includes('INR'), 'INR pricing (₹) should be present in storefront');
  assert.ok(html.includes('Pan-India') || html.includes('India'), 'Pan-India shipping should be stated');
  assert.ok(html.includes('PLA+'), 'PLA+ material standard should be mentioned');

  // Verify Astro Client:only Island element
  assert.ok(
    html.includes('astro-island') || html.includes('StlViewer'),
    'Astro client island for Three.js viewer should be mounted'
  );
});
