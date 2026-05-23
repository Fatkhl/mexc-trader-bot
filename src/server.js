require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const db = require('./db');
const TradingBot = require('./bot');
const notify = require('./notify');

// Initialize
db.init();
notify.configure(process.env.TELEGRAM_BOT_TOKEN, process.env.TELEGRAM_CHAT_ID);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'dashboard')));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

// Create bot — auto-discover zero-fee pairs, optimized for $10 scalping
const bot = new TradingBot({
  symbols: [], // Empty = auto-discover zero-fee pairs
  timeframes: ['5m', '15m', '1h'],
  strategies: ['trend_following', 'mean_reversion', 'scalping', 'breakout'],
  risk: { perTrade: 3, maxDaily: 10, maxPositions: 2, maxLeverage: 10 },
  mode: process.env.MODE || 'paper',
  apiKey: process.env.MEXC_API_KEY,
  apiSecret: process.env.MEXC_API_SECRET,
  balance: parseFloat(process.env.BALANCE || '10'),
  autoDiscoverPairs: true,
  maxPairs: 10,
  leverage: 10
});

// WebSocket handler
wss.on('connection', (ws) => {
  console.log('[Server] Dashboard client connected');
  bot.addWSClient(ws);
});

// ===== API ROUTES =====

// Bot control
app.get('/api/status', (req, res) => res.json(bot.getStatus()));

app.post('/api/bot/start', async (req, res) => {
  try {
    await bot.start();
    res.json({ success: true, message: 'Bot started' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/bot/stop', (req, res) => {
  bot.stop();
  res.json({ success: true, message: 'Bot stopped' });
});

app.put('/api/bot/config', (req, res) => {
  try {
    bot.updateConfig(req.body);
    res.json({ success: true, config: bot.config });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Trades
app.get('/api/trades/open', (req, res) => {
  res.json(db.getOpenTrades());
});

app.get('/api/trades/history', (req, res) => {
  const { limit = 100, offset = 0, symbol } = req.query;
  res.json(db.getTradeHistory(parseInt(limit), parseInt(offset), symbol));
});

// Signals
app.get('/api/signals', (req, res) => {
  const { limit = 50 } = req.query;
  res.json(db.getRecentSignals(parseInt(limit)));
});

// Stats
app.get('/api/stats', (req, res) => {
  const { days = 30 } = req.query;
  res.json(db.getStatsSummary(parseInt(days)));
});

app.get('/api/stats/:date', (req, res) => {
  res.json(db.getDailyStats(req.params.date));
});

// Analysis
app.get('/api/analysis/:symbol', (req, res) => {
  const analysis = bot.lastAnalysis[req.params.symbol];
  if (!analysis) return res.status(404).json({ error: 'No analysis available' });
  res.json(analysis);
});

// Risk status
app.get('/api/risk', (req, res) => {
  res.json(bot.risk.getRiskStatus(bot.accountBalance));
});

// Zero-fee pairs
app.get('/api/pairs', (req, res) => {
  res.json({
    activeSymbols: bot.activeSymbols,
    zeroFeePairs: bot.zeroFeePairs,
    autoDiscover: bot.config.autoDiscoverPairs
  });
});

// Balance
app.get('/api/balance', (req, res) => {
  res.json({ balance: bot.accountBalance, mode: bot.config.mode });
});

// Daily stats
app.get('/api/daily', (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  res.json(db.getDailyStats(today) || { date: today, trades: 0, pnl: 0, win_rate: 0 });
});

// Dashboard
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'dashboard', 'index.html'));
});

// Start server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`\n🚀 MEXC Trading Bot Dashboard running at http://localhost:${PORT}`);
  console.log(`📊 Mode: ${(process.env.MODE || 'paper').toUpperCase()}`);
  console.log(`🔗 WebSocket: ws://localhost:${PORT}/ws\n`);
});

// Auto-start bot
(async () => {
  try {
    await bot.start();
  } catch (err) {
    console.error('[Server] Failed to auto-start bot:', err.message);
  }
})();

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[Server] Shutting down...');
  bot.stop();
  server.close();
  process.exit(0);
});
process.on('SIGTERM', () => {
  bot.stop();
  server.close();
  process.exit(0);
});
