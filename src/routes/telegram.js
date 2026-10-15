'use strict';

const express = require('express');

const router = express.Router();

/**
 * POST /api/telegram/notifications - Send a test notification to the configured Telegram channel.
 */
router.post('/notifications', async (req, res) => {
  const { sendMessage } = require('../services/telegramBot');

  try {
    const { title = 'Test Notification', body = 'This is a test message from the admin API' } = req.body;

    const result = await sendMessage(`${title}\n\n${body}`);
    if (!result.success) {
      console.error('[Telegram] Notification failed:', result.error);
      return res.status(400).json({
        success: false,
        error: result.error || 'Failed to send notification',
      });
    }

    return res.json({
      success: true,
      messageId: result.messageId,
    });
  } catch (err) {
    console.error('[Telegram] Server error:', err);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

/**
 * GET /api/telegram/status - Check if Telegram is properly configured.
 */
router.get('/status', (req, res) => {
  const { isConfigured } = require('../services/telegramBot');

  res.json({
    success: true,
    configured: isConfigured(),
    message: isConfigured()
      ? 'Telegram bot is configured and ready to send notifications.'
      : 'Telegram bot is not configured. Please set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID environment variables.',
  });
});

/**
 * POST /api/telegram/vscode-update - Manually trigger a VS Code update check.
 */
router.post('/vscode-update', async (req, res) => {
  const { checkForUpdates } = require('../services/vscodeUpdateChecker');

  try {
    const result = await checkForUpdates();
    if (!result.checked) {
      return res.status(400).json({
        success: false,
        error: result.error || 'Failed to check for updates',
      });
    }

    return res.json({
      success: true,
      checked: result.checked,
      updated: result.updated || false,
      version: result.version,
      message: result.updated
        ? `VS Code version ${result.version} was available and notification sent.`
        : result.error
        ? `Error: ${result.error}`
        : 'No new VS Code updates available.',
    });
  } catch (err) {
    console.error('[VS Code Update] Server error:', err);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

module.exports = router;
