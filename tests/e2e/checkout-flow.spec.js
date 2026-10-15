import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';

/**
 * End-to-end customer journey and hardware constraint validation test suite.
 *
 * Verifies:
 *   1. Hardware Constraint Guardrail: Rejection of models exceeding the maximum
 *      supported build boundary.
 *   2. Happy Path & Pricing: Upload of a valid model, Three.js rendering, instant
 *      PLA+ quoting, and checkout confirmation.
 *   3. Dynamic Routing: Immediate post-submission redirect to /track/[order_id],
 *      displaying live progress stepper, reference token, and technical specs.
 */

const VALID_SAMPLE_STL = path.join(process.cwd(), 'public', 'samples', 'cube_20mm_binary.stl');
const OVERSIZED_SAMPLE_STL = path.join(process.cwd(), 'public', 'samples', 'oversized_200mm_binary.stl');
const VEIL_SAMPLE_STL = path.join(process.cwd(), 'public', 'samples', 'veil_shell_70mm_binary.stl');
const TINY_SAMPLE_STL = path.join(process.cwd(), 'public', 'samples', 'tiny_bracket_10mm_binary.stl');
const SAMPLE_3MF = path.join(process.cwd(), 'public', 'samples', 'cube_30mm.3mf');
const EXPECTED_PRICE = '149.00'; // 20mm cube: 19.84 + 20.67 + 9.92 + 39 + 25 = 114.43 -> ₹149 minimum

test.beforeAll(() => {
  if (!fs.existsSync(VALID_SAMPLE_STL)) {
    throw new Error(`Valid sample STL missing at ${VALID_SAMPLE_STL}.`);
  }
  if (!fs.existsSync(OVERSIZED_SAMPLE_STL)) {
    throw new Error(`Oversized sample STL missing at ${OVERSIZED_SAMPLE_STL}.`);
  }
  if (!fs.existsSync(VEIL_SAMPLE_STL)) {
    throw new Error(`Veil sample STL missing at ${VEIL_SAMPLE_STL}.`);
  }
  if (!fs.existsSync(TINY_SAMPLE_STL)) {
    throw new Error(`Tiny sample STL missing at ${TINY_SAMPLE_STL}.`);
  }
  if (!fs.existsSync(SAMPLE_3MF)) {
    throw new Error(`Sample 3MF missing at ${SAMPLE_3MF}.`);
  }
});

test.describe('SNKB 3D Studio E2E Suite', () => {
  test('Constraint Guardrail: uploading an oversized STL triggers clear UI rejection', async ({
    page,
  }) => {
    // 1. Visit storefront homepage
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Precision 3D Printing Engineered/ })).toBeVisible();

    // 2. Upload oversized STL (200 × 50 × 50 mm, exceeds X axis limit)
    await page.locator('input[type="file"]').setInputFiles(OVERSIZED_SAMPLE_STL);

    // 3. Assert clear rejection UI banner appears
    await expect(page.getByText('Print Volume Rejection')).toBeVisible({ timeout: 20_000 });
    await expect(
      page.getByText(/Model exceeds the maximum build volume of 180 × 180 × 180 mm/i),
    ).toBeVisible();
    await expect(page.getByText(/Model Dimensions: 200\.00/)).toBeVisible();

    // 4. Guardrail assertion: Quote breakdown and checkout form must NOT be displayed
    await expect(page.getByText('Instant 3D Print Quote Breakdown')).not.toBeVisible();
    await expect(page.getByRole('button', { name: /Proceed to Instant UPI Checkout/ })).not.toBeVisible();
  });

  test('Happy Path & Routing: uploading a valid STL renders, quotes PLA+, and confirms order redirecting to /track/[id]', async ({
    page,
  }) => {
    // 1. Visit storefront homepage
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Precision 3D Printing Engineered/ })).toBeVisible();

    // 2. Upload valid 20mm cube STL (8,000 mm³, 9.92 g PLA+)
    await page.locator('input[type="file"]').setInputFiles(VALID_SAMPLE_STL);

    // 3. Wait for Three.js canvas to render and pricing breakdown to display
    await expect(page.locator('#instant-quote canvas')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Instant 3D Print Quote Breakdown')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Standard Print Fit')).toBeVisible();
    await expect(page.getByText(EXPECTED_PRICE, { exact: false }).first()).toBeVisible();

    // 3b. Slicer toolbar: support-warnings toggle + auto-orient button render.
    // The cube's bottom face (-Z normal) is a geometric overhang under the 45°
    // rule (16.7% of 2400 mm² surface), but it rests fully on the plate, so
    // the verdict must read "on-plate supported" instead of supports needed.
    await expect(page.getByText('Show Support Warnings')).toBeVisible();
    await expect(page.getByRole('button', { name: /Auto-Orient for Best Print/ })).toBeEnabled();
    await expect(page.getByText(/Overhang: 16\.7% of surface/)).toBeVisible();
    await expect(page.getByText('on-plate supported')).toBeVisible();

    // 3c. Auto-orient: the flat cube is already optimal — no rotation, seated
    // footprint reported. (A symmetric part must NOT report a spurious tilt.)
    await page.getByRole('button', { name: /Auto-Orient for Best Print/ }).click();
    await expect(page.getByText(/Optimal Orientation/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/Footprint 20(?:\.0+)? × 20(?:\.0+)? mm/)).toBeVisible();
    // Regression guard: auto-orient must never unmount the cockpit island.
    await expect(page.getByRole('heading', { name: '3D SPECTRAL ARENA' })).toBeVisible();

    // 4. Delivery estimate: enter PIN in right column
    await page.getByPlaceholder(/e\.g\. (?:110001|450221)/).first().fill('110001');
    await expect(page.getByText('Delivery to 110001: ₹99.00')).toBeVisible({ timeout: 20_000 });

    // Open checkout slide-over drawer
    await page.getByRole('button', { name: /Proceed to Instant UPI Checkout/ }).click();

    // 4b. Fill in customer checkout form inside drawer
    await page.getByPlaceholder('e.g. Alex Chen').fill('E2E Tester');
    await page.getByPlaceholder('alex.chen@example.com').fill('e2e.tester@example.com');
    await page.getByPlaceholder('e.g. 20% infill, smooth surface').fill('20% infill, smooth surface');

    await expect(page.getByText('Grand total (print + delivery)')).toBeVisible();
    await expect(page.getByText('₹248.00', { exact: false }).first()).toBeVisible();

    // 4c. Payment mode: Cash on Delivery.
    await page.locator('input[name="paymentMode"][value="COD"]').check();
    await expect(page.locator('input[name="paymentMode"][value="COD"]')).toBeChecked();

    // 5. Submit order and assert instant confirmation feedback
    await page.getByRole('button', { name: /Confirm & Queue Print Job/ }).click();
    await expect(page.getByText('Order Confirmed!')).toBeVisible({ timeout: 30_000 });

    // 6. Assert dynamic routing: browser redirects to /track/<order_id>
    await page.waitForURL(/\/track\/\d+\/?$/, { timeout: 30_000 });
    const orderIdMatch = page.url().match(/\/track\/(\d+)/);
    expect(orderIdMatch).toBeTruthy();
    const orderId = orderIdMatch[1];

    // 7. Verify tracking page presentation and manufacturing pipeline
    await expect(page.getByText('Live Order Tracking')).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByRole('heading', { name: new RegExp(`Order #${orderId}`) }),
    ).toBeVisible();
    await expect(page.getByText(`Ref: SNKB-ORD-${orderId}`)).toBeVisible();
    await expect(page.getByText('Submitted', { exact: true }).first()).toBeVisible();
    await expect(page.locator('body')).toContainText(EXPECTED_PRICE, { timeout: 30_000 });

    // 8. Settled delivery rows: metro courier + grand total on the tracking page
    await expect(page.getByText(/Delivery to 110001/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Grand Total')).toBeVisible();
    await expect(page.locator('body')).toContainText('₹248.00', { timeout: 30_000 });

    // 9. COD payment mode carried through checkout to tracking
    await expect(page.getByText('Cash on Delivery')).toBeVisible({ timeout: 30_000 });
  });

  test('Auto-Orient: curved veil shell lays flat with supports nearly eliminated', async ({
    page,
  }) => {
    // 1. Visit storefront homepage
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Precision 3D Printing Engineered/ })).toBeVisible();

    // 2. Upload the thin standing veil (26.5 x 70 x 67.6 mm shell)
    await page.locator('input[type="file"]').setInputFiles(VEIL_SAMPLE_STL);

    // 3. Standing pose reports ~20% geometric overhang needing supports
    await expect(page.locator('#instant-quote canvas')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Overhang: 20\.4% of surface/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('supports recommended')).toBeVisible();

    // 4. Auto-orient must lay it flat: height drops and supports collapse to 0g.
    // Regression guard: the cockpit section stays mounted (a missing tilt
    // telemetry field used to throw during render and blank the whole island).
    await page.getByRole('button', { name: /Auto-Orient for Best Print/ }).click();
    await expect(page.getByRole('heading', { name: '3D SPECTRAL ARENA' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Auto-Oriented Flat on Bed: Height reduced/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Supports reduced \d+(?:\.\d+)?g → 0g/)).toBeVisible();
    await expect(page.getByText(/· tilted \d+°/)).toBeVisible();
    await expect(
      page.getByTitle(/Auto-oriented: tilt \d+° about [XYZ] · overhang \d+(?:\.\d+)?% → \d+(?:\.\d+)?%/)
    ).toBeVisible();

    // 5. Underside inspection: the Bottom preset dips below the plate (which
    // stays see-through from underneath) so support paint remains inspectable.
    await page.getByRole('button', { name: 'Bottom', exact: true }).click();
    await expect(page.locator('#instant-quote canvas')).toBeVisible();
  });

  test('Interactive Swatch & Catalog Quote: cycling swatch updates preset and catalog button loads 3D model with instant quote', async ({
    page,
  }) => {
    // 1. Visit storefront homepage
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Precision 3D Printing Engineered/ })).toBeVisible();

    // 2. Swatch dial starts with default preset
    const swatchBtn = page.locator('button.swatch-split');
    await expect(swatchBtn).toBeVisible();
    await expect(page.getByText(/Concrete Grey · Tough PLA\+/)).toBeVisible();

    // 3. Click swatch dial: cycles to Carbon Black
    await swatchBtn.click();
    await expect(page.getByText(/Carbon Black · Tough PLA\+/)).toBeVisible();

    // 4. Click swatch dial again: cycles to Signal Orange
    await swatchBtn.click();
    await expect(page.getByText(/Signal Orange · Tough PLA\+/)).toBeVisible();

    // 5. Click "Quote This Design (.STL)" on ESP32 WLED Controller Case in catalog
    const esp32QuoteBtn = page.locator('button.quote-design-btn[data-name="esp32-wled-controller-case.stl"]');
    await expect(esp32QuoteBtn).toBeVisible();
    await esp32QuoteBtn.click();

    // 6. Assert model loads into Three.js arena and triggers quote calculation
    await expect(page.locator('#instant-quote canvas')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('esp32-wled-controller-case.stl', { exact: true }).first()).toBeVisible({ timeout: 20_000 });

    // 7. Assert quote details reflect the exact 95 x 65 x 32 mm dimensions and price
    await expect(page.getByText(/X:\s*95\.00\s*mm/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/Y:\s*65\.00\s*mm/)).toBeVisible();
    await expect(page.getByText(/Z:\s*32\.00\s*mm/)).toBeVisible();
    await expect(page.getByText('Instant 3D Print Quote Breakdown')).toBeVisible();
    await expect(page.getByText(/₹(355|389|421|446|449|464|568|611)\.00/).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /Proceed to Instant UPI Checkout/ })).toBeVisible();

    // 8. Assert Z-Axis Cross-Section cut slider toggles and displays telemetry
    const crossSectionBtn = page.getByRole('button', { name: /Cross-Section/i });
    await expect(crossSectionBtn).toBeVisible();
    await crossSectionBtn.click();
    await expect(page.getByText(/Z-AXIS CROSS-SECTION:/i)).toBeVisible();
  });

  test('Slicer & Unit Controls: 3MF archive loading, vertical Z-slicer slider, inch auto-detection and live scale capping', async ({
    page,
  }) => {
    // 1. Visit storefront homepage
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Precision 3D Printing Engineered/ })).toBeVisible();

    // 2. Upload valid 3MF file (cube_30mm.3mf: 30 × 30 × 25 mm)
    await page.locator('input[type="file"]').setInputFiles(SAMPLE_3MF);

    // 3. Assert Three.js canvas renders and filename badge displays
    await expect(page.locator('#instant-quote canvas')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('cube_30mm.3mf', { exact: true }).first()).toBeVisible({ timeout: 20_000 });

    // 4. Assert dimensions and pricing quote for 3MF
    await expect(page.getByText(/X:\s*30\.00\s*mm/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/Y:\s*30\.00\s*mm/)).toBeVisible();
    await expect(page.getByText(/Z:\s*25\.00\s*mm/)).toBeVisible();
    await expect(page.getByText('Instant 3D Print Quote Breakdown')).toBeVisible();

    // 5. Assert Vertical Z-Layer Slicer Rail is visible with Z-SLICER indicator
    const verticalSlicer = page.getByLabel('Vertical Z-Layer Slicer Slider');
    await expect(verticalSlicer).toBeVisible();
    await expect(page.getByText('Z-SLICER')).toBeVisible();

    // 6. Test Vertical Z-Slicer Toggle Button (knife toggle)
    const slicerToggleBtn = page.getByTitle('Toggle Z-Axis local clipping plane');
    await expect(slicerToggleBtn).toBeVisible();
    await slicerToggleBtn.click();
    await expect(page.getByRole('button', { name: /🔪 ACTIVE/ })).toBeVisible();

    // 7. Upload Tiny STL (tiny_bracket_10mm_binary.stl: 6 × 5 × 4 mm, max dimension < 12mm)
    await page.locator('input[type="file"]').setInputFiles(TINY_SAMPLE_STL);
    await expect(page.locator('#instant-quote canvas')).toBeVisible({ timeout: 30_000 });

    // 8. Assert prominent Unit Warning Banner appears for tiny models (< 12mm)
    await expect(page.getByText(/Model looks tiny—was it exported in Inches\?/i)).toBeVisible({ timeout: 20_000 });
    const convertInchesBtn = page.getByRole('button', { name: /Convert Inches → mm/i });
    await expect(convertInchesBtn).toBeVisible();

    // 9. Click 1-Click Convert Inches → mm (×25.4)
    await convertInchesBtn.click();

    // 10. Assert Converted confirmation badge and updated dimensions (6 * 25.4 = 152.4 mm)
    await expect(page.getByText(/CONVERTED: INCHES → MM/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/152\.4/).first()).toBeVisible({ timeout: 20_000 });

    // 11. Assert Live Scale % Controls and Preset Buttons
    const scaleInput = page.getByLabel('Scale Percentage', { exact: true });
    await expect(scaleInput).toBeVisible();

    // Scale to 50%
    const scale50Btn = page.getByRole('button', { name: '50%', exact: true }).first();
    await expect(scale50Btn).toBeVisible();
    await scale50Btn.click();
    await expect(scaleInput).toHaveValue('50');

    // Scale to Fit Max (strictly capped at 180mm Bambu Lab A1 Mini limit)
    const fitMaxBtn = page.getByRole('button', { name: /Fit Max/i });
    await expect(fitMaxBtn).toBeVisible();
    await fitMaxBtn.click();
    const scaleVal = await scaleInput.inputValue();
    expect(parseInt(scaleVal, 10)).toBeGreaterThan(50);
  });
});