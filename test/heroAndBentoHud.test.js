'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const distHtmlPath = path.join(__dirname, '..', 'dist', 'index.html');

test('Module 2: Hero Print Stage & Unified Bento HUD System Verification', (t) => {
  assert.ok(
    fs.existsSync(distHtmlPath),
    'dist/index.html must exist after running astro build'
  );

  const html = fs.readFileSync(distHtmlPath, 'utf8');

  t.test('Hero Section 12-Column Grid & Live Status Pill', () => {
    assert.ok(
      html.includes('id="hero"') || html.includes('id=\'hero\''),
      'Hero section should have id="hero" anchor for spine navigation'
    );
    assert.ok(
      html.includes('A1 MINI PRINT LAB • ACTIVE'),
      'Hero should render glowing glassmorphic status pill'
    );
    assert.ok(
      html.includes('Precision 3D Printing Engineered for') && html.includes('Rapid Turnaround'),
      'Hero high-contrast display typography must be preserved'
    );
  });

  t.test('Hero 3D Stage & Bambu A1 Mini Build Volume Controls', () => {
    assert.ok(
      html.includes('hero-print-stage'),
      'Hero 3D print stage container should be mounted'
    );
    assert.ok(
      html.includes('hero-stage-canvas'),
      '3D WebGL canvas element should be present'
    );
    assert.ok(
      html.includes('180×180×180 mm'),
      '180x180x180mm Bambu Lab A1 Mini build volume should be displayed'
    );

    // Try a Model Switcher buttons
    assert.ok(html.includes('Mecha Figure'), 'Mecha Figure model switcher option should exist');
    assert.ok(html.includes('3DBenchy'), '3DBenchy model switcher option should exist');
    assert.ok(html.includes('Crystal Dragon'), 'Crystal Dragon model switcher option should exist');
    assert.ok(html.includes('Gear Bearing'), 'Gear Bearing model switcher option should exist');

    // 5 Filament Swatches
    assert.ok(html.includes('#FF6500'), 'Bambu Orange swatch should be present');
    assert.ok(html.includes('#00FF66'), 'Cyber Neon Green swatch should be present');
    assert.ok(html.includes('#1E2229'), 'Matte Charcoal swatch should be present');
    assert.ok(html.includes('#00E5FF'), 'Glacier Cyan swatch should be present');
    assert.ok(html.includes('#F3F4F6'), 'Arctic White swatch should be present');

    // Solid vs X-Ray Infill View Mode Toggle
    assert.ok(
      html.includes('view-mode-toggle-btn'),
      'View mode toggle button should be present'
    );
    assert.ok(
      html.includes('Solid Print View'),
      'Solid Print View mode label should be rendered'
    );
  });

  t.test('Live Quick Price Calculator Ticker & Magnetic HUD Brackets', () => {
    assert.ok(
      html.includes('quick-ticker-badge'),
      'Quick price calculator ticker badge should be present'
    );
    assert.ok(
      html.includes('₹2.00/g • 180×180×180mm Max • Ships from MP across India'),
      'Quick price ticker text should be present'
    );
    assert.ok(
      html.includes('hud-bracket-btn'),
      'Magnetic CTA buttons with corner HUD brackets should be rendered'
    );
  });

  t.test('Tactile Hardware Bento Cards & Farm Telemetry', () => {
    assert.ok(
      html.includes('bento-hud-card'),
      'Tactile hardware bento cards should be rendered'
    );
    assert.ok(
      html.includes('bento-counter'),
      'Animated number counters should be mounted'
    );
    assert.ok(
      html.includes('A1 MINI #01: READY • 215°C NOZZLE / 60°C PEI BED'),
      'Live printer farm telemetry badge #01 should be rendered'
    );
    assert.ok(
      html.includes('A1 MINI #02: PRINTING • 220°C NOZZLE / 65°C PEI BED'),
      'Live printer farm telemetry badge #02 should be rendered'
    );
  });

  t.test('Continuous Animated SVG Filament Extrusion Track', () => {
    assert.ok(
      html.includes('filament-spine-track'),
      'Continuous filament spine track container should be mounted'
    );
    assert.ok(
      html.includes('spine-extrusion-line'),
      'Animated SVG filament line should be rendered'
    );
    assert.ok(
      html.includes('spine-bead-pulse'),
      'Pulsing extrusion bead element should be rendered'
    );
    assert.ok(
      html.includes('01: PRINT STAGE') &&
        html.includes('02: PIPELINE') &&
        html.includes('03: SLICER ARENA') &&
        html.includes('04: MATERIAL SPECS') &&
        html.includes('05: NO-AMS CATALOG'),
      'All 5 waypoint stations along the spine must be connected'
    );
  });

  t.test('Bento HUD Section Seam Connectors', () => {
    assert.ok(
      html.includes('hud-section-seam'),
      'Bento HUD section seam connectors must replace plain horizontal dividers'
    );
    assert.ok(
      html.includes('hud-filament-pulse'),
      'Section seams should feature animated filament pulses'
    );
  });
});
