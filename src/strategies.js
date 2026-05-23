const TA = require('./analyzer');

/**
 * Base Strategy class
 */
class Strategy {
  constructor(name, timeframes) {
    this.name = name;
    this.timeframes = timeframes;
    this.enabled = true;
  }

  analyze(candles, indicators) {
    throw new Error('Must implement analyze()');
  }

  managePosition(position, candles) {
    return { shouldExit: false };
  }
}

/**
 * Strategy 1: Trend Following
 * Enter in direction of strong trend with EMA alignment, RSI confirmation, and MACD
 */
class TrendFollowing extends Strategy {
  constructor() {
    super('Trend Following', ['15m', '1h', '4h']);
    this.atrMultiplierSL = 2;
    this.atrMultiplierTP = 3;
  }

  analyze(candles, analysis) {
    if (!analysis || !analysis.indicators) return { shouldEnter: false };
    const { indicators: ind, trend, trendStrength } = analysis;
    const last = candles[closes(candles).length - 1];

    // Check EMA alignment
    const emaAlignedBull = ind.ema.ema9 > ind.ema.ema21 && ind.ema.ema21 > ind.ema.ema50;
    const emaAlignedBear = ind.ema.ema9 < ind.ema.ema21 && ind.ema.ema21 < ind.ema.ema50;
    const adxStrong = ind.adx > 25;

    // Long conditions
    if (emaAlignedBull && ind.rsi > 50 && ind.macd.histogram > 0 && adxStrong) {
      const confidence = Math.min(100, Math.round(
        (trendStrength * 0.4) +
        ((ind.rsi - 50) * 0.5) +
        (ind.macd.histogram > 0 ? 15 : 0)
      ));
      const entry = ind.ema.ema9;
      const stopLoss = entry - ind.atr * this.atrMultiplierSL;
      const takeProfit = entry + ind.atr * this.atrMultiplierTP;
      return {
        shouldEnter: true, direction: 'long', confidence,
        entry, stopLoss, takeProfit,
        reason: `EMA aligned bullish, RSI ${ind.rsi.toFixed(1)}, ADX ${ind.adx.toFixed(1)}`
      };
    }

    // Short conditions
    if (emaAlignedBear && ind.rsi < 50 && ind.macd.histogram < 0 && adxStrong) {
      const confidence = Math.min(100, Math.round(
        (trendStrength * 0.4) +
        ((50 - ind.rsi) * 0.5) +
        (ind.macd.histogram < 0 ? 15 : 0)
      ));
      const entry = ind.ema.ema9;
      const stopLoss = entry + ind.atr * this.atrMultiplierSL;
      const takeProfit = entry - ind.atr * this.atrMultiplierTP;
      return {
        shouldEnter: true, direction: 'short', confidence,
        entry, stopLoss, takeProfit,
        reason: `EMA aligned bearish, RSI ${ind.rsi.toFixed(1)}, ADX ${ind.adx.toFixed(1)}`
      };
    }

    return { shouldEnter: false };
  }

  managePosition(position, analysis) {
    if (!analysis || !analysis.indicators) return { shouldExit: false };
    const { indicators: ind, trend } = analysis;

    // Exit on trend reversal
    if (position.direction === 'long' && ind.ema.ema9 < ind.ema.ema21 && ind.macd.histogram < 0) {
      return { shouldExit: true, reason: 'Trend reversal (EMA cross + MACD bearish)' };
    }
    if (position.direction === 'short' && ind.ema.ema9 > ind.ema.ema21 && ind.macd.histogram > 0) {
      return { shouldExit: true, reason: 'Trend reversal (EMA cross + MACD bullish)' };
    }

    return { shouldExit: false };
  }
}

/**
 * Strategy 2: Mean Reversion
 * Trade extremes that revert to the mean
 */
class MeanReversion extends Strategy {
  constructor() {
    super('Mean Reversion', ['15m', '1h']);
    this.rsiOversold = 30;
    this.rsiOverbought = 70;
  }

  analyze(candles, analysis) {
    if (!analysis || !analysis.indicators) return { shouldEnter: false };
    const { indicators: ind } = analysis;
    const closesArr = closes(candles);
    const last = closesArr[closesArr.length - 1];

    // Long: RSI oversold + price below lower BB
    if (ind.rsi < this.rsiOversold && last < ind.bb.lower) {
      const confidence = Math.min(100, Math.round(
        ((this.rsiOversold - ind.rsi) * 2) +
        ((ind.bb.lower - last) / ind.atr * 20) +
        30
      ));
      const entry = last;
      const stopLoss = entry - ind.atr * 1.5;
      const takeProfit = ind.bb.middle;
      return {
        shouldEnter: true, direction: 'long', confidence,
        entry, stopLoss, takeProfit,
        reason: `RSI oversold ${ind.rsi.toFixed(1)}, price below lower BB`
      };
    }

    // Short: RSI overbought + price above upper BB
    if (ind.rsi > this.rsiOverbought && last > ind.bb.upper) {
      const confidence = Math.min(100, Math.round(
        ((ind.rsi - this.rsiOverbought) * 2) +
        ((last - ind.bb.upper) / ind.atr * 20) +
        30
      ));
      const entry = last;
      const stopLoss = entry + ind.atr * 1.5;
      const takeProfit = ind.bb.middle;
      return {
        shouldEnter: true, direction: 'short', confidence,
        entry, stopLoss, takeProfit,
        reason: `RSI overbought ${ind.rsi.toFixed(1)}, price above upper BB`
      };
    }

    return { shouldEnter: false };
  }

  managePosition(position, analysis) {
    if (!analysis || !analysis.indicators) return { shouldExit: false };
    const { indicators: ind } = analysis;

    // Exit when RSI returns to neutral
    if (position.direction === 'long' && ind.rsi > 55) {
      return { shouldExit: true, reason: 'RSI returned to neutral (mean reversion complete)' };
    }
    if (position.direction === 'short' && ind.rsi < 45) {
      return { shouldExit: true, reason: 'RSI returned to neutral (mean reversion complete)' };
    }

    return { shouldExit: false };
  }
}

/**
 * Strategy 3: Breakout
 * Trade breakouts of key levels with volume confirmation
 */
class Breakout extends Strategy {
  constructor() {
    super('Breakout', ['15m', '1h', '4h']);
  }

  analyze(candles, analysis) {
    if (!analysis || !analysis.indicators) return { shouldEnter: false };
    const { indicators: ind, support, resistance } = analysis;
    const closesArr = closes(candles);
    const last = closesArr[closesArr.length - 1];
    const prev = closesArr[closesArr.length - 2];
    const volumes = candles.map(c => c.volume);
    const avgVol = volumes.slice(-20).reduce((s, v) => s + v, 0) / 20;
    const currentVol = volumes[volumes.length - 1];
    const volumeConfirm = currentVol > avgVol * 1.5;

    // Long breakout: price breaks above resistance
    for (const r of resistance) {
      if (prev <= r && last > r && volumeConfirm) {
        const confidence = Math.min(100, Math.round(60 + (currentVol / avgVol) * 10));
        return {
          shouldEnter: true, direction: 'long', confidence,
          entry: last, stopLoss: r - ind.atr, takeProfit: last + ind.atr * 3,
          reason: `Breakout above resistance ${r.toFixed(2)} with ${(currentVol/avgVol).toFixed(1)}x volume`
        };
      }
    }

    // Short breakout: price breaks below support
    for (const s of support) {
      if (prev >= s && last < s && volumeConfirm) {
        const confidence = Math.min(100, Math.round(60 + (currentVol / avgVol) * 10));
        return {
          shouldEnter: true, direction: 'short', confidence,
          entry: last, stopLoss: s + ind.atr, takeProfit: last - ind.atr * 3,
          reason: `Breakdown below support ${s.toFixed(2)} with ${(currentVol/avgVol).toFixed(1)}x volume`
        };
      }
    }

    return { shouldEnter: false };
  }

  managePosition(position, analysis) {
    if (!analysis || !analysis.indicators) return { shouldExit: false };
    const { indicators: ind } = analysis;
    const lastPrice = analysis.indicators.ema.ema9; // approx current price

    // Move to breakeven after 1 ATR profit
    if (position.direction === 'long' && !position.breakevenMoved) {
      if (lastPrice >= position.entry_price + ind.atr) {
        return { shouldExit: false, moveBreakeven: true };
      }
    }
    if (position.direction === 'short' && !position.breakevenMoved) {
      if (lastPrice <= position.entry_price - ind.atr) {
        return { shouldExit: false, moveBreakeven: true };
      }
    }

    return { shouldExit: false };
  }
}

/**
 * Strategy 4: Scalping
 * Quick entries/exits on momentum crossovers
 */
class Scalping extends Strategy {
  constructor() {
    super('Scalping', ['1m', '5m']);
    this.slPercent = 0.2;
    this.tpPercent = 0.4;
  }

  analyze(candles, analysis) {
    if (!analysis || !analysis.indicators) return { shouldEnter: false };
    const { indicators: ind } = analysis;
    const closesArr = closes(candles);
    const last = closesArr[closesArr.length - 1];

    // Quick momentum trade: StochRSI cross + RSI direction
    const stochK = ind.stochRSI;
    if (stochK < 20 && ind.rsi < 40 && ind.macd.histogram > 0) {
      const entry = last;
      return {
        shouldEnter: true, direction: 'long', confidence: 65,
        entry, stopLoss: entry * (1 - this.slPercent / 100),
        takeProfit: entry * (1 + this.tpPercent / 100),
        reason: `Scalp long: StochRSI ${stochK.toFixed(0)}, momentum turning`
      };
    }
    if (stochK > 80 && ind.rsi > 60 && ind.macd.histogram < 0) {
      const entry = last;
      return {
        shouldEnter: true, direction: 'short', confidence: 65,
        entry, stopLoss: entry * (1 + this.slPercent / 100),
        takeProfit: entry * (1 - this.tpPercent / 100),
        reason: `Scalp short: StochRSI ${stochK.toFixed(0)}, momentum turning`
      };
    }

    return { shouldEnter: false };
  }

  managePosition(position, analysis) {
    // Scalping positions are managed via tight SL/TP
    return { shouldExit: false };
  }
}

/**
 * Strategy 5: Smart Money (ICT Concepts)
 * Trade in direction of higher TF trend, enter at FVGs/order blocks
 */
class SmartMoney extends Strategy {
  constructor() {
    super('Smart Money', ['15m', '1h', '4h']);
  }

  analyze(candles, analysis) {
    if (!analysis || !analysis.indicators || !analysis.structure) return { shouldEnter: false };
    const { indicators: ind, structure, support, resistance } = analysis;
    const closesArr = closes(candles);
    const last = closesArr[closesArr.length - 1];

    // Trade in direction of structure trend
    if (structure.trend === 'neutral') return { shouldEnter: false };

    // Look for recent FVGs as entry zones
    const recentFVGs = (structure.fvg || []).filter(f => f.index >= candles.length - 10);

    for (const fvg of recentFVGs) {
      // Bullish: price entering bullish FVG in uptrend
      if (fvg.type === 'bullish_fvg' && structure.trend === 'bullish' &&
          last >= fvg.low && last <= fvg.high) {
        const confidence = 70 + (ind.rsi > 40 && ind.rsi < 60 ? 10 : 0);
        return {
          shouldEnter: true, direction: 'long', confidence: Math.min(100, confidence),
          entry: last,
          stopLoss: fvg.low - ind.atr,
          takeProfit: resistance.length > 0 ? resistance[0] : last + ind.atr * 4,
          reason: `Smart Money: entering bullish FVG at ${fvg.low.toFixed(2)}-${fvg.high.toFixed(2)} in uptrend`
        };
      }

      // Bearish: price entering bearish FVG in downtrend
      if (fvg.type === 'bearish_fvg' && structure.trend === 'bearish' &&
          last <= fvg.high && last >= fvg.low) {
        const confidence = 70 + (ind.rsi > 40 && ind.rsi < 60 ? 10 : 0);
        return {
          shouldEnter: true, direction: 'short', confidence: Math.min(100, confidence),
          entry: last,
          stopLoss: fvg.high + ind.atr,
          takeProfit: support.length > 0 ? support[0] : last - ind.atr * 4,
          reason: `Smart Money: entering bearish FVG at ${fvg.low.toFixed(2)}-${fvg.high.toFixed(2)} in downtrend`
        };
      }
    }

    // BOS entry: strong break of structure with pullback
    const recentBOS = (structure.bos || []).filter(b => b.index >= candles.length - 15);
    for (const bos of recentBOS) {
      if (bos.type === 'bullish_bos' && structure.trend === 'bullish') {
        // Check if price pulled back near the broken level
        if (Math.abs(last - bos.price) / bos.price < 0.005) {
          return {
            shouldEnter: true, direction: 'long', confidence: 65,
            entry: last,
            stopLoss: bos.price - ind.atr * 1.5,
            takeProfit: last + ind.atr * 4,
            reason: `Smart Money: bullish BOS pullback to ${bos.price.toFixed(2)}`
          };
        }
      }
      if (bos.type === 'bearish_bos' && structure.trend === 'bearish') {
        if (Math.abs(last - bos.price) / bos.price < 0.005) {
          return {
            shouldEnter: true, direction: 'short', confidence: 65,
            entry: last,
            stopLoss: bos.price + ind.atr * 1.5,
            takeProfit: last - ind.atr * 4,
            reason: `Smart Money: bearish BOS pullback to ${bos.price.toFixed(2)}`
          };
        }
      }
    }

    return { shouldEnter: false };
  }

  managePosition(position, analysis) {
    if (!analysis || !analysis.structure) return { shouldExit: false };
    const { structure } = analysis;

    // Exit on CHoCH (change of character)
    const recentCHoCH = (structure.choch || []).filter(c => c.index >= (analysis.indicators ? 0 : 0));
    for (const choch of recentCHoCH) {
      if (choch.type === 'bearish_choch' && position.direction === 'long') {
        return { shouldExit: true, reason: 'Change of character to bearish' };
      }
      if (choch.type === 'bullish_choch' && position.direction === 'short') {
        return { shouldExit: true, reason: 'Change of character to bullish' };
      }
    }

    return { shouldExit: false };
  }
}

// Helper
function closes(candles) { return candles.map(c => c.close); }

// Strategy registry
const STRATEGIES = {
  trend_following: new TrendFollowing(),
  mean_reversion: new MeanReversion(),
  breakout: new Breakout(),
  scalping: new Scalping(),
  smart_money: new SmartMoney()
};

module.exports = { TrendFollowing, MeanReversion, Breakout, Scalping, SmartMoney, STRATEGIES };
