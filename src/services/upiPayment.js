'use strict';

const QRCode = require('qrcode');

const DEFAULT_UPI_ID = process.env.SNKB_UPI_ID || 'snkbstudio@ybl';
const DEFAULT_MERCHANT_NAME = process.env.SNKB_UPI_NAME || 'SHUBHAM BUNDELE';

/**
 * Builds a standard NPCI UPI payment intent URI.
 *
 * @param {object} params
 * @param {string} [params.upiId] - Payee VPA / UPI ID
 * @param {string} [params.merchantName] - Payee merchant / store name
 * @param {number|string} params.amount - Payable amount in INR
 * @param {number|string} params.orderId - Numeric order ID
 * @param {string} [params.note] - Optional custom transaction note
 * @returns {string} Standard upi://pay URI
 */
function buildUpiUri({ upiId, merchantName, amount, orderId, note }) {
  const pa = (upiId || DEFAULT_UPI_ID).trim();
  const pn = (merchantName || DEFAULT_MERCHANT_NAME).trim();
  const am = Number(amount || 0).toFixed(2);
  const tn = (note || `Order_${orderId || 'PENDING'}`).trim().replace(/[^a-zA-Z0-9_-]/g, '_');

  return `upi://pay?pa=${encodeURIComponent(pa)}&pn=${encodeURIComponent(pn)}&am=${encodeURIComponent(am)}&cu=INR&tn=${encodeURIComponent(tn)}`;
}

/**
 * Generates a base64 Data URL for a UPI payment QR code.
 *
 * @param {string} upiUri
 * @param {object} [options]
 * @returns {Promise<string>} Base64 data:image/png;base64,... string
 */
async function generateUpiQrDataUrl(upiUri, options = {}) {
  const opts = {
    errorCorrectionLevel: 'M',
    type: 'image/png',
    margin: 1,
    width: options.width || 240,
    color: {
      dark: '#000000',
      light: '#FFFFFF',
    },
    ...options,
  };

  return QRCode.toDataURL(upiUri, opts);
}

/**
 * Validates whether a string matches standard Indian 12-digit UTR format.
 *
 * @param {string} utr
 * @returns {boolean}
 */
function isValidUtr(utr) {
  if (!utr || typeof utr !== 'string') return false;
  const clean = utr.trim();
  // Standard UTR is 12 digits, but some banking apps produce 12-22 alphanumeric transaction references
  return /^[0-9]{12}$/.test(clean) || /^[a-zA-Z0-9]{10,22}$/.test(clean);
}

/**
 * Builds a 1-click WhatsApp share link with preformatted order confirmation telemetry.
 *
 * @param {object} params
 * @param {string|number} params.orderId
 * @param {string} [params.fileName]
 * @param {number|string} params.grandTotal
 * @param {string} [params.deliveryPincode]
 * @param {string} [params.paymentMode]
 * @param {string} [params.utr]
 * @param {string} [params.trackingUrl]
 * @returns {string} WhatsApp direct message URL
 */
function buildWhatsAppShareUrl({
  orderId,
  fileName,
  grandTotal,
  deliveryPincode,
  paymentMode,
  utr,
  trackingUrl,
}) {
  const formattedTotal = Number(grandTotal || 0).toFixed(2);
  const lines = [
    `*SNKB 3D Studio - Order #${orderId || 'NEW'}*`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `*Model:* ${fileName || 'Custom 3D Model'}`,
    `*Grand Total:* ₹${formattedTotal} INR`,
    deliveryPincode ? `*Delivery PIN:* ${deliveryPincode}` : `*Delivery:* Standard Pan-India`,
    `*Payment Mode:* ${paymentMode === 'COD' ? 'Cash on Delivery (COD)' : 'Prepaid (UPI)'}`,
  ];

  if (utr && String(utr).trim()) {
    lines.push(`*UPI UTR / Txn ID:* ${String(utr).trim()}`);
  }

  if (trackingUrl) {
    lines.push(``);
    lines.push(`*Track Live Manufacturing:*`);
    lines.push(trackingUrl);
  }

  lines.push(`━━━━━━━━━━━━━━━━━━━━`);
  lines.push(`_Precision FDM 3D Printing & Fast Pan-India Dispatch_`);

  const text = lines.join('\n');
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

module.exports = {
  DEFAULT_UPI_ID,
  DEFAULT_MERCHANT_NAME,
  buildUpiUri,
  generateUpiQrDataUrl,
  isValidUtr,
  buildWhatsAppShareUrl,
};
