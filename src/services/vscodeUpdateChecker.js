'use strict';

/**
 * VS Code Update Checker.
 * Polls the VS Code update API and notifies via Telegram when a new version is available.
 *
 * VS Code publishes updates at:
 *   https://update.code.visualstudio.com/api/releases/stable
 *
 * Configuration (via environment variables):
 *   TELEGRAM_BOT_TOKEN  - Bot token from @BotFather
 *   TELEGRAM_CHAT_ID     - Chat/channel ID for notifications
 *   VSCODE_CHECK_INTERVAL_MS - Polling interval in ms (default: 3600000 = 1 hour)
 */

const { sendVSCodeUpdate, isConfigured } = require('./telegramBot');

const VSCODE_RELEASES_API = 'https://update.code.visualstudio.com/api/releases/stable';
const CHECK_INTERVAL_MS = Number(process.env.VSCODE_CHECK_INTERVAL_MS) || 3600000; // 1 hour
let lastKnownVersion = null;
let checkTimer = null;

/**
 * Fetch the latest stable VS Code release version.
 * @returns {Promise<string|null>}
 */
async function fetchLatestVSCodeVersion() {
  try {
    const res = await fetch(VSCODE_RELEASES_API, {
      headers: { 'Accept': 'application/json' },
    });

    if (!res.ok) {
      console.error(`[VS Code Update] API returned status ${res.status}`);
      return null;
    }

    const releases = await res.json();
    if (Array.isArray(releases) && releases.length > 0) {
      return releases[0].version || null;
    }
  } catch (err) {
    console.error('[VS Code Update] Fetch error:', err.message);
  }
  return null;
}

/**
 * Check for VS Code updates and notify via Telegram if a new version is found.
 * @returns {Promise<{checked: boolean, updated: boolean, version?: string, error?: string}>}
 */
async function checkForUpdates() {
  if (!isConfigured()) {
    return { checked: false, error: 'Telegram not configured' };
  }

  const version = await fetchLatestVSCodeVersion();
  if (!version) {
    return { checked: false, error: 'Could not fetch VS Code version' };
  }

  if (version === lastKnownVersion) {
    return { checked: true, updated: false, version };
  }

  // New version detected
  lastKnownVersion = version;
  const releaseNotesUrl = `https://code.visualstudio.com/updates/${version.split('.').slice(0, 2).join('.')}`;

  const result = await sendVSCodeUpdate(version, releaseNotesUrl);
  return {
    checked: true,
    updated: true,
    version,
    messageId: result.messageId,
    error: result.error,
  };
}

/**
 * Start periodic VS Code update checking.
 * @param {number} [intervalMs] - Override check interval
 * @returns {{stop: function, checkNow: function}}
 */
function startPolling(intervalMs) {
  const interval = intervalMs || CHECK_INTERVAL_MS;

  // Initial check after 5 seconds
  setTimeout(async () => {
    const result = await checkForUpdates();
    if (result.updated) {
      console.log(`[VS Code Update] New version ${result.version} detected and notified.`);
    }
  }, 5000);

  // Periodic checks
  checkTimer = setInterval(async () => {
    const result = await checkForUpdates();
    if (result.updated) {
      console.log(`[VS Code Update] New version ${result.version} detected and notified.`);
    }
  }, interval);

  return {
    stop: () => {
      if (checkTimer) {
        clearInterval(checkTimer);
        checkTimer = null;
      }
    },
    checkNow: checkForUpdates,
  };
}

module.exports = {
  fetchLatestVSCodeVersion,
  checkForUpdates,
  startPolling,
  isConfigured,
};
