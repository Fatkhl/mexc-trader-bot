const Database = require('better-sqlite3');
const path = require('path');

let db;

function init() {
  db = new Database(path.join(__dirname, '..', 'data.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      direction TEXT NOT NULL,
      entry_price REAL NOT NULL,
      exit_price REAL,
      size REAL NOT NULL,
      leverage INTEGER DEFAULT 1,
      stop_loss REAL,
      take_profit REAL,
      pnl REAL DEFAULT 0,
      pnl_percent REAL DEFAULT 0,
      strategy TEXT,
      entry_time TEXT NOT NULL,
      exit_time TEXT,
      status TEXT DEFAULT 'open',
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS signals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      type TEXT NOT NULL,
      strategy TEXT,
      strength INTEGER DEFAULT 0,
      detail TEXT,
      price REAL,
      executed INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS daily_stats (
      date TEXT PRIMARY KEY,
      trades INTEGER DEFAULT 0,
      wins INTEGER DEFAULT 0,
      losses INTEGER DEFAULT 0,
      pnl REAL DEFAULT 0,
      win_rate REAL DEFAULT 0,
      best_trade REAL DEFAULT 0,
      worst_trade REAL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
    CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol);
    CREATE INDEX IF NOT EXISTS idx_signals_symbol ON signals(symbol);
    CREATE INDEX IF NOT EXISTS idx_signals_created ON signals(created_at);
  `);

  console.log('[DB] Database initialized');
  return db;
}

function getDb() {
  if (!db) init();
  return db;
}

// Trade operations
function insertTrade(trade) {
  const stmt = getDb().prepare(`
    INSERT INTO trades (symbol, direction, entry_price, size, leverage, stop_loss, take_profit, strategy, entry_time, status)
    VALUES (@symbol, @direction, @entry_price, @size, @leverage, @stop_loss, @take_profit, @strategy, @entry_time, 'open')
  `);
  const result = stmt.run(trade);
  return result.lastInsertRowid;
}

function closeTrade(id, exitPrice, pnl, pnlPercent) {
  const stmt = getDb().prepare(`
    UPDATE trades SET exit_price = ?, pnl = ?, pnl_percent = ?, exit_time = ?, status = 'closed'
    WHERE id = ?
  `);
  return stmt.run(exitPrice, pnl, pnlPercent, new Date().toISOString(), id);
}

function getOpenTrades() {
  return getDb().prepare('SELECT * FROM trades WHERE status = ?').all('open');
}

function getTradeHistory(limit = 100, offset = 0, symbol = null) {
  let query = 'SELECT * FROM trades WHERE status = ?';
  const params = ['closed'];
  if (symbol) {
    query += ' AND symbol = ?';
    params.push(symbol);
  }
  query += ' ORDER BY exit_time DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);
  return getDb().prepare(query).all(...params);
}

function getTradeById(id) {
  return getDb().prepare('SELECT * FROM trades WHERE id = ?').get(id);
}

// Signal operations
function insertSignal(signal) {
  const stmt = getDb().prepare(`
    INSERT INTO signals (symbol, type, strategy, strength, detail, price, created_at)
    VALUES (@symbol, @type, @strategy, @strength, @detail, @price, @created_at)
  `);
  return stmt.run({
    ...signal,
    created_at: new Date().toISOString()
  });
}

function getRecentSignals(limit = 50) {
  return getDb().prepare('SELECT * FROM signals ORDER BY created_at DESC LIMIT ?').all(limit);
}

// Config operations
function getConfig(key, defaultValue = null) {
  const row = getDb().prepare('SELECT value FROM config WHERE key = ?').get(key);
  if (!row) return defaultValue;
  try { return JSON.parse(row.value); } catch { return row.value; }
}

function setConfig(key, value) {
  const stmt = getDb().prepare(`
    INSERT OR REPLACE INTO config (key, value, updated_at) VALUES (?, ?, ?)
  `);
  return stmt.run(key, JSON.stringify(value), new Date().toISOString());
}

// Daily stats
function updateDailyStats(date, trade, isWin) {
  const existing = getDb().prepare('SELECT * FROM daily_stats WHERE date = ?').get(date);
  if (existing) {
    const trades = existing.trades + 1;
    const wins = existing.wins + (isWin ? 1 : 0);
    const losses = existing.losses + (isWin ? 0 : 1);
    const pnl = existing.pnl + (trade.pnl || 0);
    const winRate = trades > 0 ? (wins / trades) * 100 : 0;
    const bestTrade = Math.max(existing.best_trade, trade.pnl || 0);
    const worstTrade = Math.min(existing.worst_trade, trade.pnl || 0);
    getDb().prepare(`
      UPDATE daily_stats SET trades=?, wins=?, losses=?, pnl=?, win_rate=?, best_trade=?, worst_trade=? WHERE date=?
    `).run(trades, wins, losses, pnl, winRate, bestTrade, worstTrade, date);
  } else {
    const isWinVal = isWin ? 1 : 0;
    getDb().prepare(`
      INSERT INTO daily_stats (date, trades, wins, losses, pnl, win_rate, best_trade, worst_trade) VALUES (?,?,?,?,?,?,?,?)
    `).run(date, 1, isWinVal, isWinVal ? 0 : 1, trade.pnl || 0, isWin ? 100 : 0, trade.pnl || 0, trade.pnl || 0);
  }
}

function getDailyStats(date) {
  return getDb().prepare('SELECT * FROM daily_stats WHERE date = ?').get(date);
}

function getStatsSummary(days = 30) {
  const rows = getDb().prepare('SELECT * FROM daily_stats ORDER BY date DESC LIMIT ?').all(days);
  const totalTrades = rows.reduce((s, r) => s + r.trades, 0);
  const totalWins = rows.reduce((s, r) => s + r.wins, 0);
  const totalPnl = rows.reduce((s, r) => s + r.pnl, 0);
  return {
    totalTrades,
    totalWins,
    totalLosses: totalTrades - totalWins,
    totalPnl,
    winRate: totalTrades > 0 ? (totalWins / totalTrades) * 100 : 0,
    bestDay: rows.reduce((s, r) => Math.max(s, r.pnl), -Infinity),
    worstDay: rows.reduce((s, r) => Math.min(s, r.pnl), Infinity),
    days: rows
  };
}

module.exports = {
  init, getDb, insertTrade, closeTrade, getOpenTrades, getTradeHistory, getTradeById,
  insertSignal, getRecentSignals, getConfig, setConfig, updateDailyStats, getDailyStats, getStatsSummary
};
