'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const catalogPreviewJsPath = path.join(__dirname, '..', 'src', 'components', 'catalogModelPreview.js');
const catalogPreviewAstroPath = path.join(__dirname, '..', 'src', 'components', 'CatalogModelPreview.astro');
const heroStageJsPath = path.join(__dirname, '..', 'src', 'components', 'heroPrintStage.js');
const heroStageAstroPath = path.join(__dirname, '..', 'src', 'components', 'HeroPrintStage.astro');
const stlViewerJsxPath = path.join(__dirname, '..', 'src', 'components', 'StlViewer.jsx');
const distHtmlPath = path.join(__dirname, '..', 'dist', 'index.html');

test('WebGL Context Pooling & Sizing Hotfix: catalogModelPreview.js enforcement', () => {
  assert.ok(fs.existsSync(catalogPreviewJsPath), 'catalogModelPreview.js must exist');
  const content = fs.readFileSync(catalogPreviewJsPath, 'utf8');

  // 1. Max active catalog renderers cap (6 simultaneous contexts)
  assert.ok(
    content.includes('MAX_ACTIVE_CATALOG_RENDERERS = 6') || content.includes('MAX_ACTIVE_CATALOG_RENDERERS'),
    'Must define max active catalog renderers pool limit'
  );

  // 2. IntersectionObserver with rootMargin: 300px
  assert.ok(
    content.includes("rootMargin: '300px'") || content.includes('rootMargin: "300px"'),
    'Must use IntersectionObserver with rootMargin: 300px to prepare cards before scroll'
  );

  // 3. Complete context teardown on scroll out of view
  assert.ok(content.includes('forceContextLoss()'), 'Must call forceContextLoss() when evicted or scrolled out');
  assert.ok(content.includes('renderer.dispose()') || content.includes('dispose()'), 'Must dispose renderer');
  assert.ok(content.includes('replaceChild') || content.includes('replacementCanvas'), 'Must replace/remove canvas on context loss');

  // 4. Procedural fallback geometry on error
  assert.ok(content.includes('createFallbackProceduralGeometry'), 'Must export createFallbackProceduralGeometry');
  assert.ok(content.includes('TorusKnotGeometry'), 'Must use TorusKnotGeometry for procedural fallback mesh');

  // 5. Container ResizeObserver
  assert.ok(content.includes('ResizeObserver'), 'Must attach ResizeObserver to container');
});

test('WebGL Context Pooling & Sizing Hotfix: CatalogModelPreview.astro container dimensions & safe script execution', () => {
  assert.ok(fs.existsSync(catalogPreviewAstroPath), 'CatalogModelPreview.astro must exist');
  const content = fs.readFileSync(catalogPreviewAstroPath, 'utf8');

  // Explicit responsive CSS height (200px phone → 220px sm+)
  assert.ok(content.includes('h-[200px] sm:h-[220px]'), 'Card must have explicit responsive h-[200px] sm:h-[220px] height');
  assert.ok(content.includes('catalog-canvas-container'), 'Must wrap canvas in dedicated container');

  // Safe script execution
  assert.ok(content.includes("document.readyState === 'loading'"), 'Must check document.readyState');
  assert.ok(content.includes('astro:page-load'), 'Must listen to astro:page-load for Astro view transitions');
});

test('WebGL Context Pooling & Sizing Hotfix: heroPrintStage.js & HeroPrintStage.astro priority & fallback', () => {
  assert.ok(fs.existsSync(heroStageJsPath), 'heroPrintStage.js must exist');
  const jsContent = fs.readFileSync(heroStageJsPath, 'utf8');

  // WebGL context loss recovery
  assert.ok(jsContent.includes('webglcontextlost'), 'Must listen to webglcontextlost');
  assert.ok(jsContent.includes('webglcontextrestored'), 'Must listen to webglcontextrestored');

  // Procedural fallback on load error
  assert.ok(jsContent.includes('TorusKnotGeometry'), 'Must render procedural TorusKnotGeometry if STL load fails');

  // ResizeObserver
  assert.ok(jsContent.includes('ResizeObserver'), 'Must attach ResizeObserver to parent container');

  // Astro container markup
  const astroContent = fs.readFileSync(heroStageAstroPath, 'utf8');
  assert.ok(
    astroContent.includes('h-[280px] sm:h-[340px] lg:h-[420px]'),
    'Hero print stage must have explicit responsive height'
  );
  assert.ok(astroContent.includes('hero-canvas-container'), 'Must include hero-canvas-container');
});

test('WebGL Context Pooling & Sizing Hotfix: StlViewer.jsx container dimensions, ResizeObserver & binary STL fallback', () => {
  assert.ok(fs.existsSync(stlViewerJsxPath), 'StlViewer.jsx must exist');
  const content = fs.readFileSync(stlViewerJsxPath, 'utf8');

  // Explicit responsive container dimensions (pinned on mobile, flex-grow cockpit on lg)
  assert.ok(
    content.includes('h-[300px] sm:h-[380px] lg:h-[min(68vh,680px)]'),
    'Main 3D viewer container must have explicit responsive height'
  );
  assert.ok(
    content.includes('className="w-full h-full min-h-0 relative"'),
    'Main 3D viewer mount container must fill its parent with explicit dimensions'
  );

  // ResizeObserver
  assert.ok(content.includes('new ResizeObserver'), 'Must attach ResizeObserver to main slicer container');

  // WebGL context loss recovery
  assert.ok(content.includes('webglcontextlost'), 'Must handle webglcontextlost on main viewer');

  // Procedural binary STL fallback on fetch error
  assert.ok(content.includes('TorusKnotGeometry'), 'Must generate procedural fallback geometry if sample fetch fails');
  assert.ok(content.includes('geometryToBinaryStl') || content.includes('Uint32Array') || content.includes('DataView'), 'Must format binary STL buffer on fallback');
});

test('WebGL Context Pooling & Sizing Hotfix: dist/index.html includes updated container styles', () => {
  assert.ok(fs.existsSync(distHtmlPath), 'dist/index.html must exist');
  const html = fs.readFileSync(distHtmlPath, 'utf8');

  assert.ok(html.includes('h-[200px] sm:h-[220px]'), 'Compiled HTML must include responsive catalog card height');
  assert.ok(html.includes('catalog-canvas-container'), 'Compiled HTML must include catalog-canvas-container');
  assert.ok(html.includes('hero-canvas-container'), 'Compiled HTML must include hero-canvas-container');
});
