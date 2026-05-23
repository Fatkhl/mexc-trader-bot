const db = require('./db');
const notify = require('./notify');

class RiskManager {
  constructor(config = {}) {
    this.perTradeRisk = config.perTrade || 1;       // % of account
    this.maxDailyLoss = config.maxDaily || 5;        // % daily drawdown
    this.maxPositions = config.maxPositions || 3;
    this.maxLeverage = config.maxLeverage || 10;
    this.trailingStopEnabled = config.trailingStop || false;
    this.breakEvenPercent = config.breakEvenPercent || 1; // Move SL to entry after 1% profit

    // Correlated pairs (e.g., BTC moves = ETH moves)
    this.correlationGroups = [
      ['BTC_USDT', 'ETH_USDT'],
      ['SOL_USDT', 'AVAX_USDT', 'DOT_USDT'],
      ['LINK_USDT', 'UNI_USDT']
    ];
  }

  /**
   * Calculate position size based on risk per trade
   * @param {number} accountBalance - Account balance in USDT
   * @param {number} entryPrice - Entry price
   * @param {number} stopLoss - Stop loss price
   * @param {number} leverage - Leverage to use
   * @returns {number} Position size in contracts
   */
  calculatePositionSize(accountBalance, entryPrice, stopLoss, leverage) {
    if (!accountBalance || !entryPrice || !stopLoss) return 0;
    const riskAmount = accountBalance * (this.perTradeRisk / 100);
    const slDistance = Math.abs(entryPrice - stopLoss);
    if (slDistance === 0) return 0;

    // Size = risk amount / (SL distance * leverage)
    const size = riskAmount / (slDistance / entryPrice);
    const minSize = 0.001; // Minimum contract size
    return Math.max(minSize, Math.round(size * 1000) / 1000);
  }

  /**
   * Check if a new trade passes all risk checks
   */
  canOpenTrade(symbol, direction, accountBalance) {
    const openTrades = db.getOpenTrades();
    const checks = { passed: true, reasons: [] };

    // Check max positions
    if (openTrades.length >= this.maxPositions) {
      checks.passed = false;
      checks.reasons.push(`Max positions reached (${this.maxPositions})`);
      notify.notifyRiskAlert('Max Positions', `Cannot open ${symbol} ${direction}: ${openTrades.length}/${this.maxPositions} positions open`);
    }

    // Check daily loss limit
    const today = new Date().toISOString().split('T')[0];
    const dailyStats = db.getDailyStats(today);
    if (dailyStats && accountBalance > 0) {
      const dailyLossPercent = Math.abs(Math.min(0, dailyStats.pnl)) / accountBalance * 100;
      if (dailyLossPercent >= this.maxDailyLoss) {
        checks.passed = false;
        checks.reasons.push(`Daily loss limit reached (${dailyLossPercent.toFixed(1)}% / ${this.maxDailyLoss}%)`);
        notify.notifyRiskAlert('Daily Loss Limit', `Trading halted: ${dailyLossPercent.toFixed(1)}% daily drawdown`);
      }
    }

    // Check correlation (don't open multiple correlated positions)
    const group = this.correlationGroups.find(g => g.includes(symbol));
    if (group) {
      const correlatedOpen = openTrades.filter(t => group.includes(t.symbol));
      if (correlatedOpen.length > 0) {
        // Allow if same direction, warn if opposite
        const sameDirection = correlatedOpen.every(t => t.direction === direction);
        if (!sameDirection) {
          checks.passed = false;
          checks.reasons.push(`Correlated position conflict: ${correlatedOpen.map(t => t.symbol).join(', ')} already open`);
        }
      }
    }

    // Check if already in this symbol
    const sameSymbol = openTrades.find(t => t.symbol === symbol);
    if (sameSymbol) {
      checks.passed = false;
      checks.reasons.push(`Already have open position in ${symbol}`);
    }

    return checks;
  }

  /**
   * Validate leverage
   */
  validateLeverage(leverage) {
    return Math.min(Math.max(1, Math.round(leverage)), this.maxLeverage);
  }

  /**
   * Check if stop-loss is valid
   */
  validateStopLoss(entryPrice, stopLoss, direction) {
    if (!stopLoss) return false;
    if (direction === 'long' && stopLoss >= entryPrice) return false;
    if (direction === 'short' && stopLoss <= entryPrice) return false;
    const slPercent = Math.abs(entryPrice - stopLoss) / entryPrice * 100;
    return slPercent >= 0.1 && slPercent <= 10; // Between 0.1% and 10%
  }

  /**
   * Check trailing stop for open position
   */
  checkTrailingStop(position, currentPrice, atr) {
    if (!this.trailingStopEnabled) return null;

    const { entry_price, direction, stop_loss } = position;
    const profitPct = direction === 'long'
      ? (currentPrice - entry_price) / entry_price * 100
      : (entry_price - currentPrice) / entry_price * 100;

    // Move to breakeven after reaching breakEvenPercent
    if (profitPct >= this.breakEvenPercent) {
      if (direction === 'long' && stop_loss < entry_price) {
        return { action: 'move_stop', newStop: entry_price, reason: 'Move to breakeven' };
      }
      if (direction === 'short' && stop_loss > entry_price) {
        return { action: 'move_stop', newStop: entry_price, reason: 'Move to breakeven' };
      }
    }

    // Trail stop using ATR
    if (atr && profitPct >= this.breakEvenPercent * 2) {
      const trailDistance = atr * 1.5;
      if (direction === 'long') {
        const newStop = currentPrice - trailDistance;
        if (newStop > stop_loss) {
          return { action: 'move_stop', newStop, reason: 'Trailing stop adjustment' };
        }
      } else {
        const newStop = currentPrice + trailDistance;
        if (newStop < stop_loss) {
          return { action: 'move_stop', newStop, reason: 'Trailing stop adjustment' };
        }
      }
    }

    return null;
  }

  /**
   * Get current risk status
   */
  getRiskStatus(accountBalance) {
    const openTrades = db.getOpenTrades();
    const today = new Date().toISOString().split('T')[0];
    const dailyStats = db.getDailyStats(today);
    const dailyPnl = dailyStats ? dailyStats.pnl : 0;
    const dailyPnlPct = accountBalance > 0 ? (dailyPnl / accountBalance * 100) : 0;

    return {
      openPositions: openTrades.length,
      maxPositions: this.maxPositions,
      dailyPnl,
      dailyPnlPct,
      maxDailyLoss: this.maxDailyLoss,
      canTrade: openTrades.length < this.maxPositions && Math.abs(dailyPnlPct) < this.maxDailyLoss,
      perTradeRisk: this.perTradeRisk,
      maxLeverage: this.maxLeverage
    };
  }
}

module.exports = RiskManager;
