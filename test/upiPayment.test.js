'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_UPI_ID,
  DEFAULT_MERCHANT_NAME,
  buildUpiUri,
  generateUpiQrDataUrl,
  isValidUtr,
  buildWhatsAppShareUrl,
} = require('../src/services/upiPayment');

test('buildUpiUri constructs a compliant NPCI UPI payment intent URI', () => {
  const uri = buildUpiUri({
    upiId: 'merchant@upi',
    merchantName: 'SNKB Studio',
    amount: 248.5,
    orderId: 42,
  });

  assert.ok(uri.startsWith('upi://pay?'));
  assert.ok(uri.includes('pa=merchant%40upi'));
  assert.ok(uri.includes('pn=SNKB%20Studio'));
  assert.ok(uri.includes('am=248.50'));
  assert.ok(uri.includes('cu=INR'));
  assert.ok(uri.includes('tn=Order_42'));
});

test('buildUpiUri falls back cleanly to defaults when optional params are omitted', () => {
  const uri = buildUpiUri({
    amount: 149,
    orderId: 7,
  });

  assert.ok(uri.includes(`pa=${encodeURIComponent(DEFAULT_UPI_ID)}`));
  assert.ok(uri.includes(`pn=${encodeURIComponent(DEFAULT_MERCHANT_NAME)}`));
  assert.ok(uri.includes('am=149.00'));
  assert.ok(uri.includes('tn=Order_7'));
});

test('generateUpiQrDataUrl produces a valid base64 PNG data URL', async () => {
  const uri = buildUpiUri({ amount: 99, orderId: 10 });
  const dataUrl = await generateUpiQrDataUrl(uri);

  assert.ok(dataUrl.startsWith('data:image/png;base64,'));
  assert.ok(dataUrl.length > 500);
});

test('isValidUtr identifies 12-digit numeric and alphanumeric transaction IDs', () => {
  assert.equal(isValidUtr('428812345678'), true);
  assert.equal(isValidUtr('  428812345678  '), true);
  assert.equal(isValidUtr('T241014123456789'), true);

  assert.equal(isValidUtr(''), false);
  assert.equal(isValidUtr(null), false);
  assert.equal(isValidUtr('123'), false); // Too short
  assert.equal(isValidUtr('inv@lid!'), false); // Special chars
});

test('buildWhatsAppShareUrl constructs valid wa.me share link with order details', () => {
  const url = buildWhatsAppShareUrl({
    orderId: 101,
    fileName: 'esp32_case.stl',
    grandTotal: 348,
    deliveryPincode: '452001',
    paymentMode: 'Prepaid',
    utr: '428812345678',
    trackingUrl: 'https://snkb-3d.vercel.app/track/101',
  });

  assert.ok(url.startsWith('https://wa.me/?text='));
  const decoded = decodeURIComponent(url.replace('https://wa.me/?text=', ''));
  assert.ok(decoded.includes('Order #101'));
  assert.ok(decoded.includes('esp32_case.stl'));
  assert.ok(decoded.includes('₹348.00 INR'));
  assert.ok(decoded.includes('452001'));
  assert.ok(decoded.includes('Prepaid (UPI)'));
  assert.ok(decoded.includes('428812345678'));
  assert.ok(decoded.includes('https://snkb-3d.vercel.app/track/101'));
});
