'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const distHtmlPath = path.join(__dirname, '..', 'dist', 'index.html');

test('Module 3: Material Stress-Test Lab & Interactive Production Pipeline Verification', (t) => {
  assert.ok(
    fs.existsSync(distHtmlPath),
    'dist/index.html must exist after running astro build'
  );

  const html = fs.readFileSync(distHtmlPath, 'utf8');

  t.test('Material Stress-Test Lab & Cantilever Simulator', () => {
    assert.ok(
      html.includes('material-stress-lab'),
      'MaterialStressLab container should be mounted'
    );
    assert.ok(
      html.includes('force-load-slider'),
      'Force load slider (0-100 N) should be present'
    );
    assert.ok(
      html.includes('beam-svg-path'),
      'SVG cantilever beam should be rendered'
    );
    assert.ok(
      html.includes('bar-rigidity') &&
        html.includes('bar-impact') &&
        html.includes('bar-heat') &&
        html.includes('bar-adhesion') &&
        html.includes('bar-flexibility'),
      'All 5 mechanical property progress bars should be present'
    );
    assert.ok(
      html.includes('select-quoter-btn'),
      'Select This Material in Quoter CTA should be present'
    );

    // Verify materials
    assert.ok(html.includes('Tough PLA+'), 'Tough PLA+ should be present');
    assert.ok(html.includes('PETG / Industrial'), 'PETG / Industrial should be present');
    assert.ok(html.includes('Flexible TPU (95A)'), 'Flexible TPU (95A) should be present');
    assert.ok(html.includes('Density: 1.24 g/cm³'), 'PLA+ density should be documented');
  });

  t.test('Interactive 4-Stage Production Pipeline & Data Conduit', () => {
    assert.ok(
      html.includes('interactive-production-pipeline'),
      'InteractiveProductionPipeline container should be mounted'
    );
    assert.ok(
      html.includes('conduit-laser-line'),
      'Animated glowing data conduit should be rendered between cards'
    );

    // Card 01: Bounding Box Snap
    assert.ok(
      html.includes('pipeline-card-01') && html.includes('bbox-status-text'),
      'Card 01 bounding box snap widget should be present'
    );

    // Card 02: Overhang Detection & Auto-Orient
    assert.ok(
      html.includes('pipeline-card-02') && html.includes('pipeline-orient-btn'),
      'Card 02 overhang orientation simulator should be present'
    );

    // Card 03: Extruder Toolpath
    assert.ok(
      html.includes('pipeline-card-03') && html.includes('nozzle-svg-head'),
      'Card 03 extruder nozzle toolpath graphic should be present'
    );

    // Card 04: Pan-India Delivery Estimator
    assert.ok(
      html.includes('pipeline-card-04') && html.includes('pin-quick-chip'),
      'Card 04 Pan-India express delivery timeline estimator should be present'
    );
  });
});
