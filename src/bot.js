const TA = require('./analyzer');
const { STRATEGIES } = require('./strategies');
const RiskManager = require('./risk');
const MexcExchange = require('./exchange');
const db = require('./db');
const notify = require('./notify');

class TradingBot {
  constructor(config = {}) {
    this.config = {
      symbols: config.symbols || ['BTC_USDT', 'ETH_USDT', 'SOL_USDT'],
      timeframes: config.timeframes || ['15m', '1h', '4h'],
      strategies: config.strategies || ['trend_following', 'mean_reversion'],
      risk: config.risk || {},
      mode: config.mode || 'paper',
      intervalMs: config.intervalMs || 60000, // Run every 60s
      leverage: config.leverage || 5,
      ...config
    };

    this.exchange = new MexcExchange(config.apiKey, config.apiSecret);
    this.risk = new RiskManager(this.config.risk);
    this.activeStrategies = this.config.strategies
      .filter(s => STRATEGIES[s])
      .map(s => STRATEGIES[s]);

    this.running = false;
    this.loopTimer = null;
    this.accountBalance = 10000; // Default paper balance
    this.priceData = {};         // Cache of candle data
    this.lastAnalysis = {};      // Cache of last analysis per symbol
    this.wsClients = new Set();  // WebSocket clients for dashboard
    this.tradeCounter = 0;
  }

  async start() {
    if (this.running) return;
    this.running = true;
    console.log(`[Bot] Starting in ${this.config.mode.toUpperCase()} mode`);
    console.log(`[Bot] Symbols: ${this.config.symbols.join(', ')}`);
    console.log(`[Bot] Strategies: ${this.activeStrategies.map(s => s.name).join(', ')}`);

    notify.notifyBotStatus('started', this.config.mode);

    // Try to get real balance if API configured
    if (this.config.apiKey && this.config.mode === 'live') {
      try {
        const balance = await this.exchange.getBalance();
        if (balance?.availableBalance) {
          this.accountBalance = parseFloat(balance.availableBalance);
        }
      } catch (err) {
        console.warn('[Bot] Could not fetch balance:', err.message);
      }
    }

    // Connect WebSocket
    try {
      await this.exchange.connectWS();
      for (const symbol of this.config.symbols) {
        this.exchange.subscribeTicker(symbol, (data) => {
          this._broadcastToClients({ type: 'price', symbol, data });
        });
      }
    } catch (err) {
      console.warn('[Bot] WebSocket connection failed:', err.message);
    }

    // Main loop
    await this._runLoop();
    this.loopTimer = setInterval(() => this._runLoop(), this.config.intervalMs);
  }

  stop() {
    this.running = false;
    if (this.loopTimer) clearInterval(this.loopTimer);
    console.log('[Bot] Stopped');
    notify.notifyBotStatus('stopped', this.config.mode);
  }

  async _runLoop() {
    if (!this.running) return;
    try {
      console.log(`[Bot] Running analysis loop at ${new Date().toISOString()}`);

      // 1. Fetch candles for all symbols + timeframes
      await this._fetchAllData();

      // 2. Monitor open positions
      await this._manageOpenPositions();

      // 3. Run analysis and find signals
      for (const symbol of this.config.symbols) {
        await this._analyzeAndTrade(symbol);
      }

      // 4. Broadcast state to dashboard
      this._broadcastState();
    } catch (err) {
      console.error('[Bot] Loop error:', err.message);
    }
  }

  async _fetchAllData() {
    for (const symbol of this.config.symbols) {
      if (!this.priceData[symbol]) this.priceData[symbol] = {};

      for (const tf of this.config.timeframes) {
        try {
          const mexcInterval = MexcExchange.intervalToMexc(tf);
          const raw = await this.exchange.getKlines(symbol, mexcInterval, 250);
          const candles = MexcExchange.parseKlines(raw);
          if (candles.length > 0) {
            this.priceData[symbol][tf] = candles;
          }
        } catch (err) {
          console.error(`[Bot] Error fetching ${symbol} ${tf}:`, err.message);
        }
      }
    }
  }

  async _analyzeAndTrade(symbol) {
    // Use the highest timeframe for primary analysis
    const primaryTf = this.config.timeframes[this.config.timeframes.length - 1]; // e.g., '4h'
    const candles = this.priceData[symbol]?.[primaryTf];
    if (!candles || candles.length < 50) return;

    // Run full TA analysis
    const analysis = TA.analyze(candles);
    this.lastAnalysis[symbol] = { ...analysis, timestamp: Date.now() };

    // Run each strategy
    for (const strategy of this.activeStrategies) {
      if (!strategy.enabled) continue;

      // Check strategy's preferred timeframes
      const stf = strategy.timeframes.find(t => this.config.timeframes.includes(t));
      const stfCandles = this.priceData[symbol]?.[stf] || candles;
      const stfAnalysis = TA.analyze(stfCandles);

      const signal = strategy.analyze(stfCandles, stfAnalysis);
      if (!signal.shouldEnter) continue;

      // Log signal
      db.insertSignal({
        symbol, type: signal.direction, strategy: strategy.name,
        strength: signal.confidence,
        detail: signal.reason || '', price: signal.entry
      });

      // Broadcast signal
      this._broadcastToClients({
        type: 'signal', data: {
          symbol, type: signal.direction, strategy: strategy.name,
          strength: signal.confidence, detail: signal.reason,
          price: signal.entry, timestamp: Date.now()
        }
      });

      // Check risk management
      const riskCheck = this.risk.canOpenTrade(symbol, signal.direction, this.accountBalance);
      if (!riskCheck.passed) {
        console.log(`[Bot] Signal rejected for ${symbol}: ${riskCheck.reasons.join(', ')}`);
        if (signal.confidence >= 70) {
          notify.notifyStrongSignal({
            symbol, type: signal.direction, strategy: strategy.name,
            strength: signal.confidence, detail: signal.reason, price: signal.entry
          });
        }
        continue;
      }

      // Validate stop loss
      if (!this.risk.validateStopLoss(signal.entry, signal.stopLoss, signal.direction)) {
        console.log(`[Bot] Invalid stop-loss for ${symbol}`);
        continue;
      }

      // Execute trade
      await this._executeTrade(symbol, signal, strategy.name);
    }
  }

  async _executeTrade(symbol, signal, strategyName) {
    const leverage = this.risk.validateLeverage(this.config.leverage);
    const size = this.risk.calculatePositionSize(
      this.accountBalance, signal.entry, signal.stopLoss, leverage
    );

    if (size <= 0) {
      console.log(`[Bot] Position size too small for ${symbol}`);
      return;
    }

    const trade = {
      symbol,
      direction: signal.direction,
      entry_price: signal.entry,
      size,
      leverage,
      stop_loss: signal.stopLoss,
      take_profit: signal.takeProfit,
      strategy: strategyName,
      entry_time: new Date().toISOString()
    };

    if (this.config.mode === 'paper') {
      // Paper trading: record trade directly
      const tradeId = db.insertTrade(trade);
      this.tradeCounter++;
      console.log(`[Bot] 📝 PAPER TRADE #${tradeId}: ${signal.direction.toUpperCase()} ${symbol} @ ${signal.entry} | SL: ${signal.stopLoss} | TP: ${signal.takeProfit} | Size: ${size}`);
      notify.notifyTradeOpen({ ...trade, id: tradeId });
      this._broadcastToClients({ type: 'trade_open', data: { ...trade, id: tradeId } });
    } else {
      // Live trading
      try {
        await this.exchange.setLeverage(symbol, leverage);
        const order = await this.exchange.placeOrder({
          symbol,
          side: signal.direction === 'long' ? 1 : 2,
          type: 5, // Market order
          size: Math.round(size),
          leverage,
          openType: 2, // Cross margin
          stopLoss: signal.stopLoss,
          takeProfit: signal.takeProfit
        });
        if (order?.orderId) {
          trade.orderId = order.orderId;
          const tradeId = db.insertTrade(trade);
          console.log(`[Bot] ✅ LIVE TRADE #${tradeId}: ${signal.direction.toUpperCase()} ${symbol} | Order: ${order.orderId}`);
          notify.notifyTradeOpen({ ...trade, id: tradeId });
          this._broadcastToClients({ type: 'trade_open', data: { ...trade, id: tradeId } });
        }
      } catch (err) {
        console.error(`[Bot] Order failed for ${symbol}:`, err.message);
        notify.notifyRiskAlert('Order Failed', `${symbol} ${signal.direction}: ${err.message}`);
      }
    }
  }

  async _manageOpenPositions() {
    const openTrades = db.getOpenTrades();
    for (const position of openTrades) {
      const tf = this.config.timeframes[0]; // Use shortest TF for position management
      const candles = this.priceData[position.symbol]?.[tf];
      if (!candles || candles.length < 20) continue;

      const analysis = TA.analyze(candles);
      const closes = candles.map(c => c.close);
      const currentPrice = closes[closes.length - 1];

      // Check stop-loss hit
      if (position.direction === 'long' && currentPrice <= position.stop_loss) {
        await this._closePosition(position, currentPrice, 'Stop-loss hit');
        continue;
      }
      if (position.direction === 'short' && currentPrice >= position.stop_loss) {
        await this._closePosition(position, currentPrice, 'Stop-loss hit');
        continue;
      }

      // Check take-profit hit
      if (position.take_profit) {
        if (position.direction === 'long' && currentPrice >= position.take_profit) {
          await this._closePosition(position, currentPrice, 'Take-profit hit');
          continue;
        }
        if (position.direction === 'short' && currentPrice <= position.take_profit) {
          await this._closePosition(position, currentPrice, 'Take-profit hit');
          continue;
        }
      }

      // Check trailing stop
      const atr = analysis.indicators?.atr;
      const trailAction = this.risk.checkTrailingStop(position, currentPrice, atr);
      if (trailAction?.action === 'move_stop') {
        // Update stop loss in DB (for paper trading)
        if (this.config.mode === 'paper') {
          const stmt = db.getDb().prepare('UPDATE trades SET stop_loss = ? WHERE id = ?');
          stmt.run(trailAction.newStop, position.id);
          position.stop_loss = trailAction.newStop;
          console.log(`[Bot] Moved SL for #${position.id} to ${trailAction.newStop.toFixed(2)}: ${trailAction.reason}`);
        }
      }

      // Check strategy exit signals
      for (const strategy of this.activeStrategies) {
        if (strategy.name !== position.strategy) continue;
        const exitSignal = strategy.managePosition(position, analysis);
        if (exitSignal.shouldExit) {
          await this._closePosition(position, currentPrice, exitSignal.reason);
          break;
        }
      }
    }
  }

  async _closePosition(position, exitPrice, reason) {
    const pnl = position.direction === 'long'
      ? (exitPrice - position.entry_price) * position.size * position.leverage
      : (position.entry_price - exitPrice) * position.size * position.leverage;
    const pnlPercent = position.direction === 'long'
      ? ((exitPrice - position.entry_price) / position.entry_price * 100 * position.leverage)
      : ((position.entry_price - exitPrice) / position.entry_price * 100 * position.leverage);

    if (this.config.mode === 'paper') {
      db.closeTrade(position.id, exitPrice, pnl, pnlPercent);
      const today = new Date().toISOString().split('T')[0];
      db.updateDailyStats(today, { pnl }, pnl >= 0);
      this.accountBalance += pnl;
    } else {
      try {
        // Close via API
        await this.exchange.placeOrder({
          symbol: position.symbol,
          side: position.direction === 'long' ? 2 : 1, // Opposite side to close
          type: 5,
          size: Math.round(position.size),
          positionId: position.id
        });
        db.closeTrade(position.id, exitPrice, pnl, pnlPercent);
      } catch (err) {
        console.error(`[Bot] Failed to close position #${position.id}:`, err.message);
        return;
      }
    }

    const closedTrade = { ...position, exit_price: exitPrice, pnl, pnl_percent: pnlPercent };
    console.log(`[Bot] 💰 CLOSED #${position.id}: ${position.direction.toUpperCase()} ${position.symbol} @ ${exitPrice} | PnL: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} USDT (${pnlPercent.toFixed(2)}%) | ${reason}`);
    notify.notifyTradeClose(closedTrade);
    this._broadcastToClients({ type: 'trade_close', data: closedTrade });
  }

  _broadcastState() {
    const state = {
      type: 'state',
      mode: this.config.mode,
      balance: this.accountBalance,
      openTrades: db.getOpenTrades(),
      recentSignals: db.getRecentSignals(20),
      analysis: this.lastAnalysis,
      risk: this.risk.getRiskStatus(this.accountBalance),
      stats: db.getStatsSummary(30),
      strategies: this.activeStrategies.map(s => ({ name: s.name, enabled: s.enabled, timeframes: s.timeframes })),
      timestamp: Date.now()
    };
    this._broadcastToClients(state);
  }

  _broadcastToClients(data) {
    const msg = JSON.stringify(data);
    for (const ws of this.wsClients) {
      if (ws.readyState === 1) {
        try { ws.send(msg); } catch {}
      }
    }
  }

  addWSClient(ws) {
    this.wsClients.add(ws);
    // Send current state immediately
    this._broadcastState();
    ws.on('close', () => this.wsClients.delete(ws));
  }

  getStatus() {
    return {
      running: this.running,
      mode: this.config.mode,
      balance: this.accountBalance,
      symbols: this.config.symbols,
      strategies: this.activeStrategies.map(s => s.name),
      openPositions: db.getOpenTrades().length,
      totalTrades: this.tradeCounter
    };
  }

  updateConfig(newConfig) {
    if (newConfig.symbols) this.config.symbols = newConfig.symbols;
    if (newConfig.timeframes) this.config.timeframes = newConfig.timeframes;
    if (newConfig.strategies) {
      this.activeStrategies = newConfig.strategies
        .filter(s => STRATEGIES[s])
        .map(s => STRATEGIES[s]);
    }
    if (newConfig.risk) Object.assign(this.risk, newConfig.risk);
    if (newConfig.mode) this.config.mode = newConfig.mode;
    if (newConfig.leverage) this.config.leverage = newConfig.leverage;
    console.log('[Bot] Config updated');
  }
}

module.exports = TradingBot;
