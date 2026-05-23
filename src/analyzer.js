/**
 * Technical Analysis Engine
 * All calculations use proper mathematical formulas
 */

class TechnicalAnalyzer {
  // ===== MOVING AVERAGES =====

  static ema(data, period) {
    if (data.length < period) return [];
    const k = 2 / (period + 1);
    const result = [];
    let sum = 0;
    for (let i = 0; i < period; i++) sum += data[i];
    result.push(sum / period);
    for (let i = period; i < data.length; i++) {
      result.push(data[i] * k + result[result.length - 1] * (1 - k));
    }
    return result;
  }

  static sma(data, period) {
    if (data.length < period) return [];
    const result = [];
    for (let i = period - 1; i < data.length; i++) {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += data[j];
      result.push(sum / period);
    }
    return result;
  }

  // ===== MACD =====

  static macd(closes, fast = 12, slow = 26, signal = 9) {
    const emaFast = this.ema(closes, fast);
    const emaSlow = this.ema(closes, slow);
    const offset = slow - fast;
    const macdLine = [];
    for (let i = 0; i < emaSlow.length; i++) {
      macdLine.push(emaFast[i + offset] - emaSlow[i]);
    }
    const signalLine = this.ema(macdLine, signal);
    const histOffset = signal - 1;
    const histogram = [];
    for (let i = 0; i < signalLine.length; i++) {
      histogram.push(macdLine[i + histOffset] - signalLine[i]);
    }
    return { macd: macdLine, signal: signalLine, histogram };
  }

  // ===== RSI =====

  static rsi(closes, period = 14) {
    if (closes.length < period + 1) return [];
    const gains = [];
    const losses = [];
    for (let i = 1; i < closes.length; i++) {
      const diff = closes[i] - closes[i - 1];
      gains.push(diff > 0 ? diff : 0);
      losses.push(diff < 0 ? -diff : 0);
    }
    const result = [];
    let avgGain = 0, avgLoss = 0;
    for (let i = 0; i < period; i++) {
      avgGain += gains[i];
      avgLoss += losses[i];
    }
    avgGain /= period;
    avgLoss /= period;
    result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
    for (let i = period; i < gains.length; i++) {
      avgGain = (avgGain * (period - 1) + gains[i]) / period;
      avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
      result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
    }
    return result;
  }

  // ===== STOCHASTIC RSI =====

  static stochRSI(closes, rsiPeriod = 14, stochPeriod = 14, kPeriod = 3, dPeriod = 3) {
    const rsiValues = this.rsi(closes, rsiPeriod);
    if (rsiValues.length < stochPeriod) return { k: [], d: [] };
    const stoch = [];
    for (let i = stochPeriod - 1; i < rsiValues.length; i++) {
      let min = Infinity, max = -Infinity;
      for (let j = i - stochPeriod + 1; j <= i; j++) {
        min = Math.min(min, rsiValues[j]);
        max = Math.max(max, rsiValues[j]);
      }
      stoch.push(max === min ? 50 : ((rsiValues[i] - min) / (max - min)) * 100);
    }
    const k = this.sma(stoch, kPeriod);
    const d = this.sma(k, dPeriod);
    return { k, d };
  }

  // ===== BOLLINGER BANDS =====

  static bollingerBands(closes, period = 20, stdDev = 2) {
    const middle = this.sma(closes, period);
    const upper = [];
    const lower = [];
    for (let i = period - 1; i < closes.length; i++) {
      let sumSq = 0;
      const avg = middle[i - period + 1];
      for (let j = i - period + 1; j <= i; j++) {
        sumSq += (closes[j] - avg) ** 2;
      }
      const std = Math.sqrt(sumSq / period);
      upper.push(avg + stdDev * std);
      lower.push(avg - stdDev * std);
    }
    return { upper, middle, lower };
  }

  // ===== ATR =====

  static atr(highs, lows, closes, period = 14) {
    if (closes.length < 2) return [];
    const tr = [highs[0] - lows[0]];
    for (let i = 1; i < closes.length; i++) {
      tr.push(Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1])
      ));
    }
    const result = [];
    let sum = 0;
    for (let i = 0; i < period; i++) sum += tr[i];
    result.push(sum / period);
    for (let i = period; i < tr.length; i++) {
      result.push((result[result.length - 1] * (period - 1) + tr[i]) / period);
    }
    return result;
  }

  // ===== ADX =====

  static adx(highs, lows, closes, period = 14) {
    if (closes.length < period * 2) return { adx: [], plusDI: [], minusDI: [] };
    const tr = [], plusDM = [], minusDM = [];
    for (let i = 1; i < closes.length; i++) {
      tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i-1]), Math.abs(lows[i] - closes[i-1])));
      const upMove = highs[i] - highs[i-1];
      const downMove = lows[i-1] - lows[i];
      plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
      minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
    }
    // Wilder's smoothing
    const smooth = (arr, p) => {
      const r = [];
      let s = 0;
      for (let i = 0; i < p; i++) s += arr[i];
      r.push(s);
      for (let i = p; i < arr.length; i++) r.push(r[r.length-1] - r[r.length-1]/p + arr[i]);
      return r.map(v => v / p); // First value is already divided by period above, normalize
    };
    // Proper Wilder's smoothing
    const wilderSmooth = (arr, p) => {
      const r = [];
      let sum = 0;
      for (let i = 0; i < p; i++) sum += arr[i];
      r.push(sum);
      for (let i = p; i < arr.length; i++) r.push(r[r.length-1] - r[r.length-1]/p + arr[i]);
      return r;
    };
    const smoothTR = wilderSmooth(tr, period);
    const smoothPlusDM = wilderSmooth(plusDM, period);
    const smoothMinusDM = wilderSmooth(minusDM, period);
    const plusDI = [], minusDI = [], dx = [];
    for (let i = 0; i < smoothTR.length; i++) {
      const pdi = smoothTR[i] !== 0 ? (smoothPlusDM[i] / smoothTR[i]) * 100 : 0;
      const mdi = smoothTR[i] !== 0 ? (smoothMinusDM[i] / smoothTR[i]) * 100 : 0;
      plusDI.push(pdi);
      minusDI.push(mdi);
      dx.push((pdi + mdi) !== 0 ? (Math.abs(pdi - mdi) / (pdi + mdi)) * 100 : 0);
    }
    const adxValues = [];
    if (dx.length >= period) {
      let sum = 0;
      for (let i = 0; i < period; i++) sum += dx[i];
      adxValues.push(sum / period);
      for (let i = period; i < dx.length; i++) {
        adxValues.push((adxValues[adxValues.length-1] * (period-1) + dx[i]) / period);
      }
    }
    return { adx: adxValues, plusDI, minusDI };
  }

  // ===== CCI =====

  static cci(highs, lows, closes, period = 20) {
    const tp = [];
    for (let i = 0; i < closes.length; i++) tp.push((highs[i] + lows[i] + closes[i]) / 3);
    const smaTP = this.sma(tp, period);
    const result = [];
    for (let i = period - 1; i < tp.length; i++) {
      const avg = smaTP[i - period + 1];
      let meanDev = 0;
      for (let j = i - period + 1; j <= i; j++) meanDev += Math.abs(tp[j] - avg);
      meanDev /= period;
      result.push(meanDev === 0 ? 0 : (tp[i] - avg) / (0.015 * meanDev));
    }
    return result;
  }

  // ===== WILLIAMS %R =====

  static williamsR(highs, lows, closes, period = 14) {
    const result = [];
    for (let i = period - 1; i < closes.length; i++) {
      let hh = -Infinity, ll = Infinity;
      for (let j = i - period + 1; j <= i; j++) {
        hh = Math.max(hh, highs[j]);
        ll = Math.min(ll, lows[j]);
      }
      result.push(hh === ll ? -50 : ((hh - closes[i]) / (hh - ll)) * -100);
    }
    return result;
  }

  // ===== MFI =====

  static mfi(highs, lows, closes, volumes, period = 14) {
    const tp = [];
    for (let i = 0; i < closes.length; i++) tp.push((highs[i] + lows[i] + closes[i]) / 3);
    const mfv = tp.map((t, i) => t * volumes[i]);
    const result = [];
    for (let i = period; i < closes.length; i++) {
      let posFlow = 0, negFlow = 0;
      for (let j = i - period + 1; j <= i; j++) {
        if (tp[j] > tp[j-1]) posFlow += mfv[j];
        else if (tp[j] < tp[j-1]) negFlow += mfv[j];
      }
      result.push(negFlow === 0 ? 100 : 100 - 100 / (1 + posFlow / negFlow));
    }
    return result;
  }

  // ===== OBV =====

  static obv(closes, volumes) {
    const result = [0];
    for (let i = 1; i < closes.length; i++) {
      if (closes[i] > closes[i-1]) result.push(result[i-1] + volumes[i]);
      else if (closes[i] < closes[i-1]) result.push(result[i-1] - volumes[i]);
      else result.push(result[i-1]);
    }
    return result;
  }

  // ===== VWAP =====

  static vwap(highs, lows, closes, volumes) {
    const result = [];
    let cumVol = 0, cumTPVol = 0;
    for (let i = 0; i < closes.length; i++) {
      const tp = (highs[i] + lows[i] + closes[i]) / 3;
      cumTPVol += tp * volumes[i];
      cumVol += volumes[i];
      result.push(cumVol > 0 ? cumTPVol / cumVol : tp);
    }
    return result;
  }

  // ===== CHAIKIN MONEY FLOW =====

  static cmf(highs, lows, closes, volumes, period = 20) {
    const result = [];
    for (let i = period - 1; i < closes.length; i++) {
      let mfvSum = 0, volSum = 0;
      for (let j = i - period + 1; j <= i; j++) {
        const hl = highs[j] - lows[j];
        const mfm = hl === 0 ? 0 : ((closes[j] - lows[j]) - (highs[j] - closes[j])) / hl;
        mfvSum += mfm * volumes[j];
        volSum += volumes[j];
      }
      result.push(volSum === 0 ? 0 : mfvSum / volSum);
    }
    return result;
  }

  // ===== KELTNER CHANNELS =====

  static keltnerChannels(highs, lows, closes, emaPeriod = 20, atrPeriod = 10, multiplier = 2) {
    const emaMid = this.ema(closes, emaPeriod);
    const atrValues = this.atr(highs, lows, closes, atrPeriod);
    const offset = emaPeriod - 1;
    const upper = [], middle = [], lower = [];
    for (let i = 0; i < atrValues.length; i++) {
      const mid = emaMid[i + offset] ?? emaMid[emaMid.length - 1];
      if (mid === undefined) continue;
      middle.push(mid);
      upper.push(mid + multiplier * atrValues[i]);
      lower.push(mid - multiplier * atrValues[i]);
    }
    return { upper, middle, lower };
  }

  // ===== DONCHIAN CHANNELS =====

  static donchianChannels(highs, lows, period = 20) {
    const upper = [], lower = [], middle = [];
    for (let i = period - 1; i < highs.length; i++) {
      let hh = -Infinity, ll = Infinity;
      for (let j = i - period + 1; j <= i; j++) {
        hh = Math.max(hh, highs[j]);
        ll = Math.min(ll, lows[j]);
      }
      upper.push(hh);
      lower.push(ll);
      middle.push((hh + ll) / 2);
    }
    return { upper, middle, lower };
  }

  // ===== SUPPORT/RESISTANCE =====

  static findSwingPoints(highs, lows, lookback = 5) {
    const swingHighs = [];
    const swingLows = [];
    for (let i = lookback; i < highs.length - lookback; i++) {
      let isHigh = true, isLow = true;
      for (let j = 1; j <= lookback; j++) {
        if (highs[i] <= highs[i-j] || highs[i] <= highs[i+j]) isHigh = false;
        if (lows[i] >= lows[i-j] || lows[i] >= lows[i+j]) isLow = false;
      }
      if (isHigh) swingHighs.push({ index: i, price: highs[i] });
      if (isLow) swingLows.push({ index: i, price: lows[i] });
    }
    return { swingHighs, swingLows };
  }

  static findSupportResistance(highs, lows, closes, lookback = 5) {
    const { swingHighs, swingLows } = this.findSwingPoints(highs, lows, lookback);
    const support = swingLows.map(s => s.price).sort((a, b) => b - a).slice(0, 5);
    const resistance = swingHighs.map(s => s.price).sort((a, b) => a - b).slice(0, 5);
    return { support, resistance };
  }

  // ===== FIBONACCI =====

  static fibonacciLevels(high, low) {
    const diff = high - low;
    return {
      '0': high,
      '0.236': high - diff * 0.236,
      '0.382': high - diff * 0.382,
      '0.5': high - diff * 0.5,
      '0.618': high - diff * 0.618,
      '0.786': high - diff * 0.786,
      '1': low
    };
  }

  // ===== PIVOT POINTS =====

  static pivotPoints(high, low, close) {
    const p = (high + low + close) / 3;
    return {
      R3: high + 2 * (p - low),
      R2: p + (high - low),
      R1: 2 * p - low,
      P: p,
      S1: 2 * p - high,
      S2: p - (high - low),
      S3: low - 2 * (high - p)
    };
  }

  // ===== CANDLESTICK PATTERNS =====

  static detectCandlePatterns(candles) {
    const patterns = [];
    if (candles.length < 5) return patterns;
    const len = candles.length;
    const c = candles;

    for (let i = 2; i < len; i++) {
      const body = Math.abs(c[i].close - c[i].open);
      const range = c[i].high - c[i].low;
      const upperWick = c[i].high - Math.max(c[i].close, c[i].open);
      const lowerWick = Math.min(c[i].close, c[i].open) - c[i].low;

      // Doji
      if (range > 0 && body / range < 0.1) {
        patterns.push({ type: 'doji', index: i, signal: 'neutral', strength: 40 });
      }

      // Hammer (bullish)
      if (lowerWick > body * 2 && upperWick < body * 0.5 && body > 0) {
        patterns.push({ type: 'hammer', index: i, signal: 'bullish', strength: 65 });
      }

      // Shooting star (bearish)
      if (upperWick > body * 2 && lowerWick < body * 0.5 && body > 0) {
        patterns.push({ type: 'shooting_star', index: i, signal: 'bearish', strength: 65 });
      }

      // Bullish engulfing
      if (i >= 1 && c[i-1].close < c[i-1].open && c[i].close > c[i].open &&
          c[i].open <= c[i-1].close && c[i].close >= c[i-1].open) {
        patterns.push({ type: 'bullish_engulfing', index: i, signal: 'bullish', strength: 75 });
      }

      // Bearish engulfing
      if (i >= 1 && c[i-1].close > c[i-1].open && c[i].close < c[i].open &&
          c[i].open >= c[i-1].close && c[i].close <= c[i-1].open) {
        patterns.push({ type: 'bearish_engulfing', index: i, signal: 'bearish', strength: 75 });
      }

      // Morning star (bullish)
      if (i >= 2) {
        const first = c[i-2], second = c[i-1], third = c[i];
        const firstBody = Math.abs(first.close - first.open);
        const secondBody = Math.abs(second.close - second.open);
        const thirdBody = Math.abs(third.close - third.open);
        if (first.close < first.open && secondBody < firstBody * 0.3 &&
            third.close > third.open && thirdBody > firstBody * 0.5) {
          patterns.push({ type: 'morning_star', index: i, signal: 'bullish', strength: 80 });
        }
      }

      // Evening star (bearish)
      if (i >= 2) {
        const first = c[i-2], second = c[i-1], third = c[i];
        const firstBody = Math.abs(first.close - first.open);
        const secondBody = Math.abs(second.close - second.open);
        const thirdBody = Math.abs(third.close - third.open);
        if (first.close > first.open && secondBody < firstBody * 0.3 &&
            third.close < third.open && thirdBody > firstBody * 0.5) {
          patterns.push({ type: 'evening_star', index: i, signal: 'bearish', strength: 80 });
        }
      }
    }
    return patterns;
  }

  // ===== MARKET STRUCTURE (ICT Concepts) =====

  static detectMarketStructure(highs, lows, closes, lookback = 10) {
    const { swingHighs, swingLows } = this.findSwingPoints(highs, lows, Math.min(lookback, 5));
    const structure = { bos: [], choch: [], fvg: [], trend: 'neutral' };

    // Detect Break of Structure (BOS)
    for (let i = 1; i < swingHighs.length; i++) {
      if (swingHighs[i].price > swingHighs[i-1].price) {
        structure.bos.push({ index: swingHighs[i].index, type: 'bullish_bos', price: swingHighs[i].price });
      }
      if (swingHighs[i].price < swingHighs[i-1].price) {
        structure.bos.push({ index: swingHighs[i].index, type: 'bearish_bos', price: swingHighs[i].price });
      }
    }
    for (let i = 1; i < swingLows.length; i++) {
      if (swingLows[i].price < swingLows[i-1].price) {
        structure.bos.push({ index: swingLows[i].index, type: 'bearish_bos', price: swingLows[i].price });
      }
      if (swingLows[i].price > swingLows[i-1].price) {
        structure.bos.push({ index: swingLows[i].index, type: 'bullish_bos', price: swingLows[i].price });
      }
    }

    // Detect Change of Character (CHoCH)
    for (let i = 1; i < swingHighs.length; i++) {
      if (i >= 2 && swingHighs[i-2].price < swingHighs[i-1].price && swingHighs[i].price < swingHighs[i-1].price) {
        structure.choch.push({ index: swingHighs[i].index, type: 'bearish_choch', price: swingHighs[i].price });
      }
    }
    for (let i = 1; i < swingLows.length; i++) {
      if (i >= 2 && swingLows[i-2].price > swingLows[i-1].price && swingLows[i].price > swingLows[i-1].price) {
        structure.choch.push({ index: swingLows[i].index, type: 'bullish_choch', price: swingLows[i].price });
      }
    }

    // Detect Fair Value Gaps (FVG)
    for (let i = 2; i < closes.length; i++) {
      // Bullish FVG: candle[i-2].high < candle[i].low (gap up)
      if (highs[i-2] < lows[i]) {
        structure.fvg.push({ index: i, type: 'bullish_fvg', high: lows[i], low: highs[i-2] });
      }
      // Bearish FVG: candle[i-2].low > candle[i].high (gap down)
      if (lows[i-2] > highs[i]) {
        structure.fvg.push({ index: i, type: 'bearish_fvg', high: lows[i-2], low: highs[i] });
      }
    }

    // Determine overall trend
    if (swingHighs.length >= 2 && swingLows.length >= 2) {
      const lastSH = swingHighs[swingHighs.length-1];
      const prevSH = swingHighs[swingHighs.length-2];
      const lastSL = swingLows[swingLows.length-1];
      const prevSL = swingLows[swingLows.length-2];
      if (lastSH.price > prevSH.price && lastSL.price > prevSL.price) structure.trend = 'bullish';
      else if (lastSH.price < prevSH.price && lastSL.price < prevSL.price) structure.trend = 'bearish';
    }

    return structure;
  }

  // ===== FULL ANALYSIS =====

  static analyze(candles) {
    if (!candles || candles.length < 50) {
      return { trend: 'neutral', trendStrength: 0, momentum: 'neutral', volatility: 'normal',
        signals: [], support: [], resistance: [], score: 0, recommendation: 'hold' };
    }

    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const volumes = candles.map(c => c.volume);
    const last = closes[closes.length - 1];
    const signals = [];
    let score = 0;

    // --- Trend ---
    const ema9 = this.ema(closes, 9);
    const ema21 = this.ema(closes, 21);
    const ema50 = this.ema(closes, 50);
    const sma200 = this.sma(closes, 200);
    const macdResult = this.macd(closes);
    const adxResult = this.adx(highs, lows, closes);

    const lastEma9 = ema9[ema9.length - 1];
    const lastEma21 = ema21[ema21.length - 1];
    const lastEma50 = ema50.length > 0 ? ema50[ema50.length - 1] : last;
    const lastSma200 = sma200.length > 0 ? sma200[sma200.length - 1] : last;
    const lastMACD = macdResult.macd[macdResult.macd.length - 1];
    const lastSignal = macdResult.signal[macdResult.signal.length - 1];
    const lastHist = macdResult.histogram[macdResult.histogram.length - 1];
    const prevHist = macdResult.histogram[macdResult.histogram.length - 2];
    const lastADX = adxResult.adx.length > 0 ? adxResult.adx[adxResult.adx.length - 1] : 0;

    let trend = 'neutral';
    let trendStrength = Math.min(100, Math.round(lastADX * 2));

    if (lastEma9 > lastEma21 && lastEma21 > lastEma50) {
      trend = 'bullish'; score += 20;
      if (last > lastSma200) score += 10;
    } else if (lastEma9 < lastEma21 && lastEma21 < lastEma50) {
      trend = 'bearish'; score -= 20;
      if (last < lastSma200) score -= 10;
    }

    // MACD signal
    if (lastMACD > lastSignal && prevHist < 0 && lastHist > 0) {
      signals.push({ type: 'buy', source: 'MACD', strength: 70, detail: 'MACD bullish crossover' });
      score += 15;
    } else if (lastMACD < lastSignal && prevHist > 0 && lastHist < 0) {
      signals.push({ type: 'sell', source: 'MACD', strength: 70, detail: 'MACD bearish crossover' });
      score -= 15;
    }

    // ADX trend strength
    if (lastADX > 25) {
      signals.push({ type: trend === 'bullish' ? 'buy' : 'sell', source: 'ADX', strength: 50, detail: `Strong trend (ADX: ${lastADX.toFixed(1)})` });
      score += trend === 'bullish' ? 5 : -5;
    }

    // --- Momentum ---
    const rsiValues = this.rsi(closes);
    const lastRSI = rsiValues[rsiValues.length - 1];
    const stochRSI = this.stochRSI(closes);
    const cciValues = this.cci(highs, lows, closes);
    const wrValues = this.williamsR(highs, lows, closes);
    const mfiValues = this.mfi(highs, lows, closes, volumes);

    const lastStochK = stochRSI.k.length > 0 ? stochRSI.k[stochRSI.k.length - 1] : 50;
    const lastCCI = cciValues.length > 0 ? cciValues[cciValues.length - 1] : 0;
    const lastWR = wrValues.length > 0 ? wrValues[wrValues.length - 1] : -50;
    const lastMFI = mfiValues.length > 0 ? mfiValues[mfiValues.length - 1] : 50;

    let momentum = 'neutral';
    const overboughtScore = (lastRSI > 70 ? 1 : 0) + (lastStochK > 80 ? 1 : 0) + (lastCCI > 100 ? 1 : 0) + (lastWR > -20 ? 1 : 0);
    const oversoldScore = (lastRSI < 30 ? 1 : 0) + (lastStochK < 20 ? 1 : 0) + (lastCCI < -100 ? 1 : 0) + (lastWR < -80 ? 1 : 0);

    if (overboughtScore >= 2) { momentum = 'overbought'; score -= 15; }
    if (oversoldScore >= 2) { momentum = 'oversold'; score += 15; }

    // RSI signals
    if (lastRSI < 30) {
      signals.push({ type: 'buy', source: 'RSI', strength: 80, detail: `RSI oversold at ${lastRSI.toFixed(1)}` });
      score += 15;
    } else if (lastRSI > 70) {
      signals.push({ type: 'sell', source: 'RSI', strength: 80, detail: `RSI overbought at ${lastRSI.toFixed(1)}` });
      score -= 15;
    }

    // MFI
    if (lastMFI < 20) {
      signals.push({ type: 'buy', source: 'MFI', strength: 60, detail: `MFI oversold at ${lastMFI.toFixed(1)}` });
      score += 8;
    } else if (lastMFI > 80) {
      signals.push({ type: 'sell', source: 'MFI', strength: 60, detail: `MFI overbought at ${lastMFI.toFixed(1)}` });
      score -= 8;
    }

    // --- Volatility ---
    const bb = this.bollingerBands(closes);
    const atrValues = this.atr(highs, lows, closes);
    const lastUpper = bb.upper[bb.upper.length - 1];
    const lastMiddle = bb.middle[bb.middle.length - 1];
    const lastLower = bb.lower[bb.lower.length - 1];
    const lastATR = atrValues[atrValues.length - 1];
    const avgATR = atrValues.reduce((s, v) => s + v, 0) / atrValues.length;

    let volatility = 'normal';
    if (lastATR > avgATR * 1.5) volatility = 'high';
    else if (lastATR < avgATR * 0.6) volatility = 'low';

    // Bollinger signals
    if (last < lastLower) {
      signals.push({ type: 'buy', source: 'BB', strength: 65, detail: 'Price below lower Bollinger Band' });
      score += 10;
    } else if (last > lastUpper) {
      signals.push({ type: 'sell', source: 'BB', strength: 65, detail: 'Price above upper Bollinger Band' });
      score -= 10;
    }

    // --- Volume ---
    const obvValues = this.obv(closes, volumes);
    const cmfValues = this.cmf(highs, lows, closes, volumes);
    const lastCMF = cmfValues.length > 0 ? cmfValues[cmfValues.length - 1] : 0;
    const obvEma = this.ema(obvValues, 20);
    const lastOBV = obvValues[obvValues.length - 1];
    const lastOBVEma = obvEma.length > 0 ? obvEma[obvEma.length - 1] : lastOBV;

    if (lastCMF > 0.1) { score += 5; }
    else if (lastCMF < -0.1) { score -= 5; }
    if (lastOBV > lastOBVEma) { score += 5; }
    else if (lastOBV < lastOBVEma) { score -= 5; }

    // --- Support/Resistance ---
    const { support, resistance } = this.findSupportResistance(highs, lows, closes);

    // --- Candlestick patterns ---
    const patterns = this.detectCandlePatterns(candles);
    const recentPatterns = patterns.filter(p => p.index >= candles.length - 3);
    for (const p of recentPatterns) {
      if (p.signal === 'bullish') { score += Math.round(p.strength / 5); signals.push({ type: 'buy', source: 'Pattern', strength: p.strength, detail: p.type.replace(/_/g, ' ') }); }
      if (p.signal === 'bearish') { score -= Math.round(p.strength / 5); signals.push({ type: 'sell', source: 'Pattern', strength: p.strength, detail: p.type.replace(/_/g, ' ') }); }
    }

    // --- Market Structure ---
    const structure = this.detectMarketStructure(highs, lows, closes);
    if (structure.trend === 'bullish') score += 5;
    if (structure.trend === 'bearish') score -= 5;

    const recentFVG = structure.fvg.filter(f => f.index >= candles.length - 10);
    for (const f of recentFVG) {
      signals.push({
        type: f.type === 'bullish_fvg' ? 'buy' : 'sell', source: 'FVG',
        strength: 55, detail: `${f.type.replace(/_/g, ' ')} at ${f.low.toFixed(2)}-${f.high.toFixed(2)}`
      });
    }

    // Clamp score
    score = Math.max(-100, Math.min(100, score));

    // Recommendation
    let recommendation = 'hold';
    if (score >= 60) recommendation = 'strong_buy';
    else if (score >= 25) recommendation = 'buy';
    else if (score <= -60) recommendation = 'strong_sell';
    else if (score <= -25) recommendation = 'sell';

    return {
      trend, trendStrength, momentum, volatility, signals, support, resistance, score, recommendation,
      indicators: {
        ema: { ema9: lastEma9, ema21: lastEma21, ema50: lastEma50, sma200: lastSma200 },
        macd: { macd: lastMACD, signal: lastSignal, histogram: lastHist },
        rsi: lastRSI, stochRSI: lastStochK, cci: lastCCI, williamsR: lastWR, mfi: lastMFI,
        adx: lastADX,
        bb: { upper: lastUpper, middle: lastMiddle, lower: lastLower },
        atr: lastATR,
        cmf: lastCMF,
        obv: lastOBV,
        vwap: this.vwap(highs, lows, closes, volumes).pop()
      },
      structure, patterns: recentPatterns
    };
  }
}

module.exports = TechnicalAnalyzer;
