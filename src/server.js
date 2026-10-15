'use strict';

const http = require('node:http');
const app = require('./app');

const PORT = Number(process.env.PORT) || 3000;

app.listen(PORT, () => {
  console.log(`SNKB 3D Printing quote API listening on http://localhost:${PORT}`);
});

// Also bind to 3001 as secondary listener so http://localhost:3001 works seamlessly
if (PORT === 3000) {
  const secondary = http.createServer(app);
  secondary.listen(3001, () => {
    console.log(`Secondary listener active on http://localhost:3001`);
  });
  secondary.on('error', () => {
    // Ignore if 3001 is already taken
  });
}

// Telegram routes
const telegramRouter = require('./routes/telegram');
app.use('/api/telegram', telegramRouter);

// VS Code update checker (optional, runs if configured)
const { startPolling } = require('./services/vscodeUpdateChecker');
if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
  console.log('[Telegram] VS Code update polling enabled');
  startPolling();
}
