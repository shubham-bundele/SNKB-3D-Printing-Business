'use strict';

/**
 * Telegram Bot Service for SNKB 3D Printing Business.
 * Sends update notifications to a Telegram channel via the Bot API.
 *
 * Configuration (via environment variables):
 *   TELEGRAM_BOT_TOKEN  - Bot token from @BotFather
 *   TELEGRAM_CHAT_ID     - Chat/channel ID where updates should be posted
 */

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
const TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

/**
 * Send a message to a Telegram chat.
 * @param {string} text - Message text (HTML supported)
 * @param {object} [opts] - Optional parameters
 * @param {string} [opts.parse_mode] - 'HTML' | 'MarkdownV2' | 'Markdown'
 * @returns {Promise<{success: boolean, messageId?: number, error?: string}>}
 */
async function sendMessage(text, opts = {}) {
  if (!TELEGRAM_BOT_TOKEN) {
    return { success: false, error: 'TELEGRAM_BOT_TOKEN not configured' };
  }
  if (!TELEGRAM_CHAT_ID) {
    return { success: false, error: 'TELEGRAM_CHAT_ID not configured' };
  }

  const payload = {
    chat_id: TELEGRAM_CHAT_ID,
    text: text,
    parse_mode: opts.parse_mode || 'HTML',
    disable_web_page_preview: opts.disable_web_page_preview !== false,
  };

  if (opts.reply_to_message_id) {
    payload.reply_to_message_id = opts.reply_to_message_id;
  }

  try {
    const res = await fetch(TELEGRAM_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errBody = await res.text();
      return { success: false, error: `Telegram API ${res.status}: ${errBody}` };
    }

    const data = await res.json();
    if (!data.ok) {
      return { success: false, error: data.description || 'Telegram API error' };
    }

    return { success: true, messageId: data.result?.message_id };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Send a VS Code update notification.
 * @param {string} version - VS Code version (e.g., '1.99.0')
 * @param {string} releaseNotesUrl - URL to release notes
 * @returns {Promise<{success: boolean, messageId?: number, error?: string}>}
 */
async function sendVSCodeUpdate(version, releaseNotesUrl) {
  const message = `🖥️ <b>VS Code Update Available</b>\n\n` +
    `Version: <b>${version}</b>\n\n` +
    `Check the release notes: ${releaseNotesUrl || 'https://code.visualstudio.com/updates'}`;

  return sendMessage(message);
}

/**
 * Send a generic notification to Telegram.
 * @param {string} title - Notification title
 * @param {string} body - Notification body
 * @returns {Promise<{success: boolean, messageId?: number, error?: string}>}
 */
async function sendNotification(title, body) {
  const message = `🔔 <b>${title}</b>\n\n${body}`;
  return sendMessage(message);
}

/**
 * Check if Telegram is configured.
 * @returns {boolean}
 */
function isConfigured() {
  return Boolean(TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID);
}

module.exports = {
  sendMessage,
  sendVSCodeUpdate,
  sendNotification,
  isConfigured,
};
