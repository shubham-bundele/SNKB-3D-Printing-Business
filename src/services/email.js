'use strict';

/**
 * Transactional email service powered by Resend.
 *
 * Replaces Nodemailer for Vercel serverless deployment compatibility.
 * Sends customer order confirmations and automated status updates via the Resend API with rate-limit handling.
 *
 * Configuration:
 *   - RESEND_API_KEY      : Resend API key (required for outbound mail).
 *   - SNKB_EMAIL_ENABLED  : set to '0' to disable outbound email entirely (for hermetic tests).
 *   - RESEND_FROM_EMAIL   : sender address (default: 'onboarding@resend.dev' or custom domain).
 *   - SNKB_EMAIL_FROM_NAME: sender display name (default: 'SNKB 3D Studio').
 *   - SNKB_PUBLIC_BASE_URL: public origin for tracking links.
 */

const { Resend } = require('resend');

const EMAIL_ENABLED = process.env.SNKB_EMAIL_ENABLED !== '0';
const FROM_NAME = process.env.SNKB_EMAIL_FROM_NAME || 'SNKB 3D Studio';
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || process.env.SNKB_EMAIL_FROM || 'onboarding@resend.dev';
const SHOP_NAME = 'SNKB 3D Studio';

/** Lazily initialized Resend client */
let resendClient = null;

function getResendClient() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  if (!resendClient) {
    resendClient = new Resend(apiKey);
  }
  return resendClient;
}

/** Format a price as `₹X.XX INR`. */
function formatPrice(price) {
  const numeric = Number(price);
  const value = Number.isFinite(numeric) ? numeric : 0;
  return `₹${value.toFixed(2)} INR`;
}

/** Delay helper for rate-limit backoff */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Build the HTML confirmation message body.
 */
function buildHtml({ reference, priceText, trackerUrl }) {
  return `
<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:0;background-color:#0f0f10;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <div style="max-width:560px;margin:0 auto;background-color:#18181b;border:1px solid #27272a;border-radius:16px;overflow:hidden;">
      <!-- Header -->
      <div style="background:#18191c;border-bottom:3px solid #FF6500;padding:24px 28px;">
        <div style="font-size:22px;font-weight:800;color:#ffffff;">${SHOP_NAME}</div>
        <div style="font-size:12px;color:#FF6500;margin-top:4px;letter-spacing:0.05em;text-transform:uppercase;font-family:monospace;">
          SNKB 3D Studio • PLA+ Precision Print Run (India)
        </div>
      </div>

      <!-- Body -->
      <div style="padding:28px;">
        <div style="font-size:13px;color:#a1a1aa;">Order Confirmation</div>
        <h1 style="font-size:24px;color:#ffffff;margin:6px 0 16px;">Your 3D print order is confirmed 🎉</h1>

        <div style="background:#0e0e10;border:1px solid #27272a;border-radius:12px;padding:18px 20px;margin-bottom:20px;">
          <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:10px;">
            <span style="color:#a1a1aa;">Order Reference</span>
            <span style="color:#FF6500;font-weight:700;font-family:monospace;">${reference}</span>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:10px;">
            <span style="color:#a1a1aa;">Quoted Price</span>
            <span style="color:#00FF66;font-weight:700;font-family:monospace;">${priceText}</span>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:13px;">
            <span style="color:#a1a1aa;">Fulfillment</span>
            <span style="color:#e4e4e7;">Precision 3D Print Farm (Pan-India)</span>
          </div>
        </div>

        <p style="font-size:13px;color:#d4d4d8;line-height:1.6;margin:0 0 20px;">
          Your model has been queued for slicing. Track every stage — from
          <strong style="color:#fafafa;">Submitted</strong> → Slicing → Printing →
          <strong style="color:#fafafa;">Completed / Shipped</strong> — on your live tracking page.
        </p>

        <a href="${trackerUrl}"
           style="display:inline-block;background:#FF6500;color:#000000;text-decoration:none;font-weight:800;font-size:14px;padding:12px 24px;border-radius:6px;letter-spacing:0.02em;">
          Track My Order →
        </a>

        <p style="font-size:11px;color:#71717a;margin-top:24px;line-height:1.6;">
          If the button does not work, copy and paste this link into your browser:<br/>
          <span style="color:#a1a1aa;font-family:monospace;word-break:break-all;">${trackerUrl}</span>
        </p>
      </div>

      <div style="padding:16px 28px;background:#101012;border-top:1px solid #27272a;font-size:11px;color:#52525b;">
        ${SHOP_NAME} — local on-demand additive manufacturing.
      </div>
    </div>
  </body>
</html>
`;
}

/**
 * Send customer order confirmation via Resend.
 */
async function sendOrderConfirmation(customerEmail, orderId, price, trackerUrl, retryCount = 0) {
  if (!EMAIL_ENABLED) {
    return { success: false, skipped: true, messageId: null, previewUrl: null };
  }

  const resend = getResendClient();
  if (!resend) {
    console.log('[resend] RESEND_API_KEY not configured — skipping confirmation email.');
    return {
      success: false,
      skipped: true,
      messageId: null,
      previewUrl: null,
      error: 'RESEND_API_KEY not set',
    };
  }

  const reference = `SNKB-ORD-${orderId}`;
  const priceText = formatPrice(price);
  const tracking = trackerUrl || `https://snkb3d.example/track/${orderId}`;
  const recipient = String(customerEmail || '').trim();

  try {
    const payload = {
      from: `${FROM_NAME} <${FROM_EMAIL}>`,
      to: [recipient],
      subject: `✓ Order ${reference} confirmed — your 3D print is queued`,
      text: `Order ${reference} confirmed.\nQuoted price: ${priceText}\nTrack progress: ${tracking}`,
      html: buildHtml({ reference, priceText, trackerUrl: tracking }),
    };

    const { data, error } = await resend.emails.send(payload);

    if (error) {
      const isRateLimit =
        error.statusCode === 429 ||
        error.name === 'rate_limit_exceeded' ||
        (error.message && error.message.toLowerCase().includes('rate limit'));

      if (isRateLimit && retryCount < 2) {
        console.warn(`[resend] Rate limit hit for order ${orderId}, backing off (retry ${retryCount + 1}/2)...`);
        await delay(1200 * (retryCount + 1));
        return sendOrderConfirmation(customerEmail, orderId, price, trackerUrl, retryCount + 1);
      }

      console.error(`[resend] Email send error for order ${orderId}:`, error.message);
      return {
        success: false,
        messageId: null,
        previewUrl: null,
        error: error.message,
      };
    }

    const messageId = data?.id || null;
    console.log(`[resend] Order ${orderId} confirmation sent via Resend (id: ${messageId}).`);

    return {
      success: true,
      messageId,
      previewUrl: null,
    };
  } catch (err) {
    console.error(`[resend] Unexpected exception for order ${orderId}:`, err.message);
    return {
      success: false,
      messageId: null,
      previewUrl: null,
      error: err.message,
    };
  }
}

/**
 * Build HTML for order status change notifications (Printing / Shipped).
 */
function buildStatusHtml({ reference, status, courierTrackingUrl, trackerUrl }) {
  const isPrinting = status === 'Printing';
  const statusBadge = isPrinting
    ? `<span style="background:#FF6500;color:#000000;font-weight:800;font-size:12px;padding:4px 10px;border-radius:4px;font-family:monospace;letter-spacing:0.05em;">PRINTING NOW</span>`
    : `<span style="background:#00FF66;color:#000000;font-weight:800;font-size:12px;padding:4px 10px;border-radius:4px;font-family:monospace;letter-spacing:0.05em;">SHIPPED / IN TRANSIT</span>`;

  const headline = isPrinting
    ? `Your 3D print is now actively printing ⚡`
    : `Your order has shipped via Express Courier 📦`;

  const description = isPrinting
    ? `Great news! Your 3D model has cleared toolpath slicing, bed leveling, and nozzle calibration. It is now actively manufacturing on our high-precision Bambu Lab FDM print farm.`
    : `Your 3D printed parts have passed dimensional QA, have been cleaned, and are safely packed with shock-absorbing cushioning. Your package is on its way to your delivery address!`;

  return `
<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:0;background-color:#0f0f10;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <div style="max-width:560px;margin:0 auto;background-color:#18181b;border:1px solid #27272a;border-radius:16px;overflow:hidden;">
      <!-- Header -->
      <div style="background:#18191c;border-bottom:3px solid #FF6500;padding:24px 28px;">
        <div style="font-size:22px;font-weight:800;color:#ffffff;">${SHOP_NAME}</div>
        <div style="font-size:12px;color:#FF6500;margin-top:4px;letter-spacing:0.05em;text-transform:uppercase;font-family:monospace;">
          SNKB 3D Studio • Production Telemetry Update
        </div>
      </div>

      <!-- Body -->
      <div style="padding:28px;">
        <div style="margin-bottom:12px;">${statusBadge}</div>
        <h1 style="font-size:22px;color:#ffffff;margin:6px 0 16px;">${headline}</h1>

        <div style="background:#0e0e10;border:1px solid #27272a;border-radius:12px;padding:18px 20px;margin-bottom:20px;">
          <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:10px;">
            <span style="color:#a1a1aa;">Order Reference</span>
            <span style="color:#FF6500;font-weight:700;font-family:monospace;">${reference}</span>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:10px;">
            <span style="color:#a1a1aa;">Manufacturing Stage</span>
            <span style="color:#ffffff;font-weight:700;">${status}</span>
          </div>
          ${courierTrackingUrl ? `
          <div style="display:flex;justify-content:space-between;font-size:13px;padding-top:8px;border-top:1px solid #27272a;">
            <span style="color:#a1a1aa;">Courier Tracking</span>
            <a href="${courierTrackingUrl}" style="color:#00FF66;text-decoration:none;font-weight:700;font-family:monospace;word-break:break-all;">Track Courier Package ↗</a>
          </div>
          ` : ''}
        </div>

        <p style="font-size:13px;color:#d4d4d8;line-height:1.6;margin:0 0 20px;">
          ${description}
        </p>

        ${courierTrackingUrl ? `
        <div style="margin-bottom:20px;">
          <a href="${courierTrackingUrl}"
             style="display:inline-block;background:#00FF66;color:#000000;text-decoration:none;font-weight:800;font-size:13px;padding:11px 22px;border-radius:6px;letter-spacing:0.02em;margin-right:10px;margin-bottom:10px;">
            Track with Courier →
          </a>
          <a href="${trackerUrl}"
             style="display:inline-block;background:#27272a;color:#ffffff;text-decoration:none;font-weight:700;font-size:13px;padding:11px 22px;border-radius:6px;letter-spacing:0.02em;border:1px solid #3f3f46;">
            Studio Tracking →
          </a>
        </div>
        ` : `
        <a href="${trackerUrl}"
           style="display:inline-block;background:#FF6500;color:#000000;text-decoration:none;font-weight:800;font-size:14px;padding:12px 24px;border-radius:6px;letter-spacing:0.02em;">
          Track Live Progress →
        </a>
        `}

        <p style="font-size:11px;color:#71717a;margin-top:24px;line-height:1.6;">
          Live studio tracker:<br/>
          <span style="color:#a1a1aa;font-family:monospace;word-break:break-all;">${trackerUrl}</span>
        </p>
      </div>

      <div style="padding:16px 28px;background:#101012;border-top:1px solid #27272a;font-size:11px;color:#52525b;">
        ${SHOP_NAME} — local on-demand additive manufacturing.
      </div>
    </div>
  </body>
</html>
`;
}

/**
 * Send automated order status update email (Printing or Shipped) via Resend.
 *
 * @param {object} params
 * @param {string} params.customerEmail recipient address
 * @param {number|string} params.orderId order ID
 * @param {string} params.status 'Printing' | 'Shipped'
 * @param {string} [params.courierTrackingUrl] optional courier tracking URL
 * @param {string} [params.trackerUrl] public tracking URL
 * @param {number} [retryCount=0] internal retry counter
 */
async function sendStatusUpdateEmail({ customerEmail, orderId, status, courierTrackingUrl, trackerUrl }, retryCount = 0) {
  if (!EMAIL_ENABLED) {
    return { success: false, skipped: true, messageId: null, error: 'SNKB_EMAIL_ENABLED=0' };
  }

  if (status !== 'Printing' && status !== 'Shipped') {
    return { success: false, skipped: true, messageId: null, error: `No automated email configured for status "${status}"` };
  }

  const resend = getResendClient();
  if (!resend) {
    console.log(`[resend] RESEND_API_KEY not configured — skipping ${status} status email.`);
    return {
      success: false,
      skipped: true,
      messageId: null,
      error: 'RESEND_API_KEY not set',
    };
  }

  const reference = `SNKB-ORD-${orderId}`;
  const tracking = trackerUrl || `https://snkb3d.example/track/${orderId}`;
  const recipient = String(customerEmail || '').trim();
  if (!recipient || !recipient.includes('@')) {
    return { success: false, skipped: true, error: 'Invalid customer email address' };
  }

  const subject = status === 'Printing'
    ? `⚡ Order ${reference} is now Printing — SNKB 3D Studio`
    : `📦 Order ${reference} has Shipped via Express Courier — SNKB 3D Studio`;

  const textLines = [
    `Order ${reference} Status Update: ${status}`,
    status === 'Printing'
      ? 'Your 3D model is now actively printing on our Bambu Lab FDM print farm.'
      : 'Your 3D print order has passed QA and shipped via express courier.',
  ];
  if (courierTrackingUrl) {
    textLines.push(`Courier Tracking URL: ${courierTrackingUrl}`);
  }
  textLines.push(`Track Live Progress: ${tracking}`);

  try {
    const payload = {
      from: `${FROM_NAME} <${FROM_EMAIL}>`,
      to: [recipient],
      subject,
      text: textLines.join('\n\n'),
      html: buildStatusHtml({ reference, status, courierTrackingUrl, trackerUrl: tracking }),
    };

    const { data, error } = await resend.emails.send(payload);

    if (error) {
      const isRateLimit =
        error.statusCode === 429 ||
        error.name === 'rate_limit_exceeded' ||
        (error.message && error.message.toLowerCase().includes('rate limit'));

      if (isRateLimit && retryCount < 2) {
        console.warn(`[resend] Rate limit hit for order ${orderId} (${status}), retrying (${retryCount + 1}/2)...`);
        await delay(1200 * (retryCount + 1));
        return sendStatusUpdateEmail({ customerEmail, orderId, status, courierTrackingUrl, trackerUrl }, retryCount + 1);
      }

      console.error(`[resend] Status email error for order ${orderId} (${status}):`, error.message);
      return {
        success: false,
        messageId: null,
        error: error.message,
      };
    }

    const messageId = data?.id || null;
    console.log(`[resend] Order ${orderId} status email (${status}) sent via Resend (id: ${messageId}).`);

    return {
      success: true,
      messageId,
    };
  } catch (err) {
    console.error(`[resend] Status email exception for order ${orderId} (${status}):`, err.message);
    return {
      success: false,
      messageId: null,
      error: err.message,
    };
  }
}

module.exports = {
  EMAIL_ENABLED,
  sendOrderConfirmation,
  sendStatusUpdateEmail,
  _resetForTests: () => {
    resendClient = null;
  },
};