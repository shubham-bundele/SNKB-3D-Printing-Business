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

  // Verify Unified Catalog Filter Bar (replaces the old stacked category headings)
  assert.ok(
    html.includes('Articulated &amp; Mecha') || html.includes('Articulated & Mecha'),
    'Articulated & Mecha catalog filter should be present'
  );
  assert.ok(
    html.includes('Maker &amp; IoT') || html.includes('Maker & IoT'),
    'Maker & IoT catalog filter should be present'
  );
  assert.ok(
    html.includes('Everyday &amp; Music') || html.includes('Everyday & Music'),
    'Everyday & Music catalog filter should be present'
  );

  // Verify CAD product renders (no placeholder boxes)
  assert.ok(
    html.includes('/images/products/'),
    'Catalog cards should render product illustration images'
  );
  assert.ok(
    (html.includes('esp32-wled-controller-case.jpg') || html.includes('esp32-wled-controller-case.svg')) &&
      (html.includes('modular-planter-trio-tray.jpg') || html.includes('modular-planter-trio-tray.svg')),
    'All six product renders should be referenced'
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
