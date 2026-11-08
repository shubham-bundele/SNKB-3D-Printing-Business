'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const modelsDir = path.join(__dirname, '..', 'public', 'models');
const distHtmlPath = path.join(__dirname, '..', 'dist', 'index.html');
const catalogPreviewJsPath = path.join(__dirname, '..', 'src', 'components', 'catalogModelPreview.js');
const catalogPreviewAstroPath = path.join(__dirname, '..', 'src', 'components', 'CatalogModelPreview.astro');

test('Catalog 3D Models: verified open-source GitHub STLs are downloaded and valid', () => {
  const verifiedStls = [
    'pr2_head_pan.stl',
    'pr2_head_tilt.stl',
    'colored.stl',
    'slotted_disk.stl',
    '3dbenchy.stl',
  ];

  for (const filename of verifiedStls) {
    const filePath = path.join(modelsDir, filename);
    assert.ok(fs.existsSync(filePath), `Verified GitHub STL ${filename} should exist in public/models/`);
    const stat = fs.statSync(filePath);
    assert.ok(stat.size > 1000, `${filename} should have non-trivial file size (> 1KB)`);
  }
});

test('Catalog 3D Models: high-polygon solid meshes are generated (>5,000 triangles)', () => {
  const highPolyModels = [
    'posable-snap-fit-mecha.stl',
    'articulated-crystal-dragon.stl',
    'modular-gridfinity-2x3-desk-organizer.stl',
    'dual-tone-geometric-planter.stl',
    'gaming-controller-headphone-stand.stl',
    'mx-switch-tester-12.stl',
    'folding-phone-tablet-stand.stl',
    'guitar-headstock-pick-dispenser.stl',
    'esp32-wled-controller-case.stl',
    'planetary-gear-fidget-spinner.stl',
    'under-desk-clamp-headphone-hanger.stl',
    'custom-raised-letter-nameplate.stl',
    'bambu-poop-chute-catch-box.stl',
    'rpi-zero-sensor-housing.stl',
    'modular-planter-trio-tray.stl',
    'artisan-keycap-display-stand.stl',
    'hex-self-watering-planter.stl',
    'gridfinity-rugged-parts-bin.stl',
  ];

  for (const filename of highPolyModels) {
    const filePath = path.join(modelsDir, filename);
    assert.ok(fs.existsSync(filePath), `Catalog model ${filename} must exist`);
    const buffer = fs.readFileSync(filePath);
    assert.ok(buffer.length >= 84, `${filename} must have a valid STL binary header`);

    const triCount = buffer.readUInt32LE(80);
    assert.ok(
      triCount >= 5000,
      `Expected ${filename} to have >= 5,000 triangles, but got ${triCount}`
    );
  }
});

test('Catalog 3D Turntable Renderer: components exist and enforce solid physical rendering (no wireframes)', () => {
  assert.ok(fs.existsSync(catalogPreviewAstroPath), 'CatalogModelPreview.astro must exist');
  assert.ok(fs.existsSync(catalogPreviewJsPath), 'catalogModelPreview.js must exist');

  const jsContent = fs.readFileSync(catalogPreviewJsPath, 'utf8');

  // Verify Three.js imports
  assert.ok(jsContent.includes('STLLoader'), 'Must use STLLoader');
  assert.ok(jsContent.includes('OrbitControls'), 'Must use OrbitControls');
  assert.ok(jsContent.includes('MeshPhysicalMaterial'), 'Must use MeshPhysicalMaterial');

  // Verify STRICT RULE: NO wireframes / stick lines
  assert.ok(!jsContent.includes('wireframe: true'), 'Must strictly forbid wireframe: true');
  assert.ok(!jsContent.includes('EdgesGeometry'), 'Must strictly forbid EdgesGeometry stick lines');

  // Verify studio lighting rig
  assert.ok(jsContent.includes('DirectionalLight'), 'Must use DirectionalLight for studio lighting');
  assert.ok(jsContent.includes('HemisphereLight'), 'Must use HemisphereLight for fill');

  // Verify OrbitControls zoom protection
  assert.ok(jsContent.includes('enableZoom = false'), 'OrbitControls must disable zoom to protect scrolling');

  // Verify turntable rotation and centering — geometry is bed-fit and centered
  // via fitGeometryToA1MiniBed (strict 180x180x180mm containment engine).
  assert.ok(jsContent.includes('turntableGroup.rotation.y'), 'Must smoothly rotate turntable');
  assert.ok(
    jsContent.includes('fitGeometryToA1MiniBed') && jsContent.includes('fitMultiPartGeometriesToA1MiniBed'),
    'Must compute bounding box + center geometry via the A1 Mini bed-fit engine'
  );
  assert.ok(jsContent.includes('GridHelper'), 'Must include 180x180mm subtle grid plate');
});

test('Frontend Storefront: dist/index.html includes 3D cards, swatches, and Load in 3D Slicer buttons', () => {
  assert.ok(fs.existsSync(distHtmlPath), 'dist/index.html must exist');
  const html = fs.readFileSync(distHtmlPath, 'utf8');

  // Verify 3D turntable cards
  assert.ok(html.includes('catalog-model-card'), 'HTML must include catalog-model-card containers');
  assert.ok(html.includes('catalog-3d-canvas'), 'HTML must include catalog-3d-canvas elements');
  assert.ok(html.includes('SOLID 3D PREVIEW'), 'HTML must display solid 3D preview badge');

  // Verify 4 filament swatches
  assert.ok(html.includes('data-color="#FF6500"'), 'HTML must include Bambu Orange swatch');
  assert.ok(html.includes('data-color="#00FF66"'), 'HTML must include Cyber Neon Green swatch');
  assert.ok(html.includes('data-color="#1E2229"'), 'HTML must include Matte Charcoal swatch');
  assert.ok(html.includes('data-color="#00E5FF"'), 'HTML must include Glacier Cyan swatch');

  // Verify Explode Parts toggle affordance on every card — the honest catalog
  // (Phase 30) ships single-piece real customer designs, so the label renders
  // the disabled "Cannot Explode" state; genuine multi-part SKUs re-enable it.
  assert.ok(html.includes('explode-parts-btn'), 'HTML must include the explode-parts toggle');
  assert.ok(html.includes('Cannot Explode'), 'Single-piece cards must state honestly that they cannot explode');
  assert.ok(html.includes('lock-badge'), 'Lock badge copy must be passed through for tooltip');

  // Verify Load in 3D Slicer buttons
  assert.ok(html.includes('Load in 3D Slicer →'), 'HTML must feature Load in 3D Slicer button');
});
