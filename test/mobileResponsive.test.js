'use strict';

/**
 * test/mobileResponsive.test.js
 *
 * Locks in the Module 4 mobile-first responsive hardening so a future refactor
 * cannot silently regress phone (360px) behaviour back to a squeezed desktop
 * layout. These are source-text guardrails (same style as
 * webglContextAndSizing.test.js) rather than runtime DOM assertions.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', ...rel.split('/')), 'utf8');

const GLOBAL_CSS = read('src/styles/global.css');
const LAYOUT = read('src/layouts/Layout.astro');
const INDEX = read('src/pages/index.astro');
const STL_VIEWER = read('src/components/StlViewer.jsx');
const HERO_STAGE = read('src/components/HeroPrintStage.astro');
const HERO_STAGE_JS = read('src/components/heroPrintStage.js');
const CATALOG_PREVIEW = read('src/components/CatalogModelPreview.astro');
const MATERIAL_LAB = read('src/components/MaterialStressLab.astro');
const PIPELINE = read('src/components/InteractiveProductionPipeline.astro');
const SPINE = read('src/components/FilamentSpineTrack.astro');
const UPI = read('src/components/UpiPaymentQr.jsx');
const ADMIN_LAYOUT = read('src/layouts/AdminLayout.astro');
const ORDER_MGMT = read('src/components/admin/OrderManagement.jsx');
const TOUCH_CONTROLS = read('src/utils/viewerTouchControls.js');

test('M1: global viewport guard + mobile utility classes', () => {
  // overflow-x: clip (not hidden) protects sticky headers while killing sideways scroll
  assert.ok(GLOBAL_CSS.includes('overflow-x: clip'), 'html/body must use overflow-x: clip');
  assert.ok(GLOBAL_CSS.includes('max-width: 100vw'), 'html/body must cap width at 100vw');
  assert.ok(GLOBAL_CSS.includes('.no-scrollbar'), 'must ship a .no-scrollbar utility');
  assert.ok(GLOBAL_CSS.includes('.viewer-touch-lock'), 'must style the 3D touch-lock pill');
  // iOS Safari zoom guard for < 16px fields
  assert.ok(GLOBAL_CSS.includes('input.field-mech'), 'must force 16px on mobile field-mech inputs');
});

test('M1: sticky brand header + hamburger drawer with auto-close', () => {
  assert.ok(LAYOUT.includes('mobile-nav-toggle'), 'header must expose a hamburger toggle');
  assert.ok(LAYOUT.includes('mobile-nav-drawer'), 'header must render a slide-down drawer');
  assert.ok(LAYOUT.includes('min-w-[44px] min-h-[44px]'), 'hamburger must meet the 44x44px tap target');
  assert.ok(LAYOUT.includes("window.innerWidth >= 1024"), 'drawer must auto-close at the lg breakpoint');
  // Every drawer link closes the drawer on tap
  assert.ok(LAYOUT.includes("addEventListener('click', () => setOpen(false))"), 'drawer links must auto-close');
});

test('M1: fixed timeline rail is hidden below 1280px', () => {
  assert.ok(SPINE.includes('hidden xl:flex'), 'FilamentSpineTrack must be hidden xl:flex');
});

test('M2: hero grid, fluid headline, tappable CTAs and swipeable model pills', () => {
  assert.ok(INDEX.includes('grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-10 items-center'), 'hero grid must collapse to 1 col');
  assert.ok(INDEX.includes('text-[clamp(1.9rem,5vw,3.6rem)]'), 'hero headline must use a fluid clamp()');
  assert.ok(INDEX.includes('w-full sm:w-auto'), 'hero CTAs must be full-width on phones');
  assert.ok(HERO_STAGE.includes('h-[280px] sm:h-[340px] lg:h-[420px]'), 'hero stage must use the pinned responsive height');
  assert.ok(HERO_STAGE.includes('no-scrollbar touch-rail snap-x'), 'hero model pills must be a swipeable snap rail');
});

test('M3: mobile 3-tab workspace + pinned viewport + sticky checkout bar', () => {
  // Desktop 3-col cockpit preserved
  assert.ok(STL_VIEWER.includes('lg:grid-cols-[340px_minmax(0,1fr)_380px]'), 'desktop cockpit grid must remain');
  // Mobile flow becomes a flex column with ordered panels
  assert.ok(STL_VIEWER.includes('flex flex-col items-stretch lg:grid'), 'cockpit must stack as flex on mobile');
  assert.ok(STL_VIEWER.includes("order-3 lg:order-1"), 'left panel must be ordered after the arena');
  assert.ok(STL_VIEWER.includes("order-1 lg:order-2"), 'arena must be pinned first on mobile');
  assert.ok(STL_VIEWER.includes("order-4 lg:order-3"), 'right panel must be ordered last');
  // Tab switcher + labels
  assert.ok(STL_VIEWER.includes('Model & Filament'), 'must expose Tab 1');
  assert.ok(STL_VIEWER.includes('Slicer & Add-Ons'), 'must expose Tab 2');
  assert.ok(STL_VIEWER.includes('Final Quote & Pay'), 'must expose Tab 3');
  // Sticky tab bar + pinned mobile viewport
  assert.ok(STL_VIEWER.includes('sticky top-[67px] z-30'), 'tab bar must stick below the site header');
  assert.ok(STL_VIEWER.includes('h-[300px] sm:h-[380px] lg:h-[min(68vh,680px)]'), 'viewport must be pinned on mobile');
  // Sticky bottom bar with jump-to-checkout
  assert.ok(STL_VIEWER.includes('lg:hidden fixed bottom-0 inset-x-0 z-40'), 'must render a fixed mobile checkout bar');
  assert.ok(STL_VIEWER.includes("goToMobileTab('quote')"), 'bottom bar must jump to the quote tab');
  // Telemetry grid
  assert.ok(STL_VIEWER.includes('grid grid-cols-2 sm:grid-cols-4 gap-2.5'), 'telemetry must use the 2/4 responsive grid');
  // Toolbar touch ribbon
  assert.ok(STL_VIEWER.includes('slicer-ribbon'), 'toolbars must carry the touch-ribbon class');
  assert.ok(GLOBAL_CSS.includes('.slicer-ribbon button'), 'ribbon buttons must be styled to 38px on touch');
});

test('M4: coarse-pointer touch lock, pixel-ratio cap and ResizeObserver helpers', () => {
  assert.ok(TOUCH_CONTROLS.includes('resolvePixelRatio'), 'must export resolvePixelRatio');
  assert.ok(TOUCH_CONTROLS.includes('innerWidth < 768 ? 1.5 : 2'), 'pixel ratio must cap at 1.5 on phones');
  assert.ok(TOUCH_CONTROLS.includes('attachTouchScrollLock'), 'must export attachTouchScrollLock');
  assert.ok(TOUCH_CONTROLS.includes("(pointer: coarse)"), 'touch lock must be coarse-pointer gated');
  assert.ok(TOUCH_CONTROLS.includes('defaultLocked'), 'touch lock must default to locked-for-scroll');
  assert.ok(TOUCH_CONTROLS.includes('3D Touch: Locked for Scroll'), 'must show the locked pill label');
  assert.ok(TOUCH_CONTROLS.includes('3D Orbit Active'), 'must show the orbit-active pill label');

  // Wired into all three viewports
  assert.ok(STL_VIEWER.includes('attachTouchScrollLock'), 'StlViewer must attach the touch lock');
  assert.ok(STL_VIEWER.includes('resolvePixelRatio()'), 'StlViewer must use the capped pixel ratio');
  assert.ok(HERO_STAGE_JS.includes('resolvePixelRatio()'), 'hero stage must use the capped pixel ratio');
  assert.ok(HERO_STAGE_JS.includes('attachTouchScrollLock'), 'hero stage must attach the touch lock');
  assert.ok(read('src/components/catalogModelPreview.js').includes('attachTouchScrollLock'), 'catalog preview must attach the touch lock');
  assert.ok(STL_VIEWER.includes('new ResizeObserver'), 'StlViewer must keep its ResizeObserver');
});

test('M5: UPI mobile deep link, one-tap copy and collapsible QR', () => {
  assert.ok(UPI.includes('upi://pay?pa='), 'must build the NPCI upi:// deep link');
  assert.ok(UPI.includes('&cu=INR'), 'deep link must denominate in INR');
  assert.ok(UPI.includes('Pay ₹'), 'must render the primary pay CTA with the amount');
  assert.ok(UPI.includes('One-Tap Copy UPI ID'), 'must render a one-tap copy UPI ID button');
  assert.ok(UPI.includes('Copied!'), 'copy action must show a copied confirmation');
  assert.ok(UPI.includes('Tap to Show Payment QR'), 'phones must collapse the QR behind a toggle');
  assert.ok(UPI.includes('md:flex'), 'desktop must keep the QR always visible');
  assert.ok(UPI.includes('text-base sm:text-xs'), 'checkout inputs must be 16px on phones to avoid iOS zoom');
});

test('M6: section grids collapse cleanly', () => {
  assert.ok(PIPELINE.includes('grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6'), 'How It Works grid');
  assert.ok(MATERIAL_LAB.includes('grid grid-cols-3 w-full lg:w-auto'), 'Materials Lab segmented selector');
  assert.ok(MATERIAL_LAB.includes('h-[220px] sm:h-[260px]'), 'Materials Lab canvas height');
  assert.ok(MATERIAL_LAB.includes('p-4 sm:p-6'), 'Materials Lab telemetry padding');
});

test('M7: catalog rail, responsive grid and touch-sized actions', () => {
  assert.ok(INDEX.includes('overflow-x-auto no-scrollbar touch-rail'), 'catalog filters must be a swipe rail');
  assert.ok(INDEX.includes('grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-5 lg:gap-6'), 'catalog grid');
  assert.ok(CATALOG_PREVIEW.includes('h-[200px] sm:h-[220px]'), 'catalog preview height');
  assert.ok(CATALOG_PREVIEW.includes('min-h-[40px]'), 'catalog explode button must be >= 40px');
  assert.ok(INDEX.includes('py-3.5'), 'Load in Slicer button must stay a large tap target');
});

test('M8: tracking + admin responsiveness', () => {
  const tracking = read('src/components/TrackingView.jsx');
  assert.ok(tracking.includes('grid grid-cols-1 sm:grid-cols-4'), 'tracking timeline must stack on mobile');
  assert.ok(tracking.includes('p-4 sm:p-8'), 'tracking header must tighten padding on mobile');

  assert.ok(ADMIN_LAYOUT.includes('admin-sidebar'), 'admin must expose an off-canvas sidebar');
  assert.ok(ADMIN_LAYOUT.includes('admin-menu-toggle'), 'admin must expose a mobile hamburger');
  assert.ok(ADMIN_LAYOUT.includes('min-w-[44px] min-h-[44px]'), 'admin hamburger must meet 44x44px');
  assert.ok(!ADMIN_LAYOUT.includes('className='), 'AdminLayout.astro must not use className (ignored by browsers)');
  assert.ok(ORDER_MGMT.includes('overflow-x-auto'), 'admin tables must scroll horizontally');
  assert.ok(ORDER_MGMT.includes('min-w-[900px]'), 'admin orders table must keep a scrollable min width');
  assert.ok(ORDER_MGMT.includes('grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4'), 'admin KPI grid');
});
