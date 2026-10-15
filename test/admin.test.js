'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const adminHtmlPath = path.join(__dirname, '..', 'dist', 'admin', 'index.html');

test('Admin Dashboard - static build verification and UI components', () => {
  assert.ok(
    fs.existsSync(adminHtmlPath),
    'dist/admin/index.html should exist after running astro build'
  );

  const html = fs.readFileSync(adminHtmlPath, 'utf8');

  // Verify Admin Layout & Navigation
  assert.ok(html.includes('Admin Console') || html.includes('Admin Dashboard'), 'Admin Console heading should be present');
  assert.ok(html.includes('Printer Fleet') || html.includes('Production Unit') || html.includes('Print Farm'), 'Fleet indicator should be present');
  assert.ok(html.includes('Back to Storefront'), 'Navigation link to public storefront should be present');

  // Verify Profit Dashboard Summary Cards
  assert.ok(
    html.includes('Total Filament Used') || html.includes('Filament') || html.includes('Material Consumption'),
    'Total Filament Used summary card should be present'
  );
  assert.ok(
    html.includes('Overhead Costs') || html.includes('Operating Overhead'),
    'Overhead Costs summary card should be present'
  );
  assert.ok(
    html.includes('Net Profit') || html.includes('Cumulative Net Profit'),
    'Net Profit summary card should be present'
  );
  assert.ok(
    html.includes('₹') || html.includes('INR'),
    'Indian pricing (₹) should be reflected in profit calculations'
  );

  // Verify Order Management Table Columns
  assert.ok(html.includes('Order ID'), 'Order ID column header should be present');
  assert.ok(html.includes('Customer Name'), 'Customer Name column header should be present');
  assert.ok(html.includes('Uploaded File') || html.includes('STL'), 'Uploaded File (STL) column header should be present');
  assert.ok(html.includes('Volume (mm³)') || html.includes('Volume'), 'Calculated Volume column header should be present');
  assert.ok(html.includes('Quoted Price'), 'Quoted Price column header should be present');
  assert.ok(html.includes('Delivery'), 'Delivery column header should be present');
  assert.ok(html.includes('Payment'), 'Payment column header should be present');
  assert.ok(html.includes('Status'), 'Status column header should be present');

  // Verify Payment Remittance Split Card
  assert.ok(html.includes('Payment Remittance'), 'Payment Remittance split card should be present');
  assert.ok(html.includes('Prepaid'), 'Prepaid remittance label should be present');
  assert.ok(html.includes('COD'), 'COD remittance label should be present');

  // Verify Order Status Workflow Options
  assert.ok(html.includes('Pending'), 'Status option Pending should be present');
  assert.ok(html.includes('Slicing'), 'Status option Slicing should be present');
  assert.ok(html.includes('Printing'), 'Status option Printing should be present');
  assert.ok(html.includes('Completed'), 'Status option Completed should be present');
  assert.ok(html.includes('Cancelled'), 'Status option Cancelled should be present');
});
