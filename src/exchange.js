const axios = require('axios');
const crypto = require('crypto');
const WebSocket = require('ws');

const BASE_URL = 'https://contract.mexc.com';
const WS_URL = 'wss://contract.mexc.com/edge';

class MexcExchange {
  constructor(apiKey = '', apiSecret = '') {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.client = axios.create({ baseURL: BASE_URL, timeout: 15000 });
    this.requestQueue = [];
    this.processing = false;
    this.rateLimitMs = 55; // ~18 req/s to stay under 20/s
    this.ws = null;
    this.wsCallbacks = {};
    this.priceCache = {};
    this.lastRequestTime = 0;
  }

  // Rate-limited request
  async request(method, endpoint, data = null, signed = false) {
    return new Promise((resolve, reject) => {
      this.requestQueue.push({ method, endpoint, data, signed, resolve, reject });
      this._processQueue();
    });
  }

  async _processQueue() {
    if (this.processing || this.requestQueue.length === 0) return;
    this.processing = true;

    while (this.requestQueue.length > 0) {
      const now = Date.now();
      const wait = Math.max(0, this.rateLimitMs - (now - this.lastRequestTime));
      if (wait > 0) await this._sleep(wait);

      const req = this.requestQueue.shift();
      this.lastRequestTime = Date.now();

      try {
        const result = await this._executeRequest(req.method, req.endpoint, req.data, req.signed);
        req.resolve(result);
      } catch (err) {
        if (err.response?.status === 429) {
          console.warn('[Exchange] Rate limited, re-queuing...');
          this.requestQueue.unshift(req);
          await this._sleep(1000);
        } else if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT') {
          console.warn('[Exchange] Network error, retrying...');
          this.requestQueue.unshift(req);
          await this._sleep(2000);
        } else {
          req.reject(err);
        }
      }
    }
    this.processing = false;
  }

  async _executeRequest(method, endpoint, data, signed) {
    const headers = { 'Content-Type': 'application/json' };
    const params = {};

    if (signed && this.apiKey) {
      const timestamp = Date.now().toString();
      let signStr = '';
      if (method === 'GET') {
        signStr = timestamp + endpoint;
        if (data) {
          const qs = new URLSearchParams(data).toString();
          signStr += '?' + qs;
          Object.assign(params, data);
        }
      } else {
        signStr = timestamp + (data ? JSON.stringify(data) : '');
      }
      const signature = crypto.createHmac('sha256', this.apiSecret).update(signStr).digest('hex');
      headers['ApiKey'] = this.apiKey;
      headers['Request-Time'] = timestamp;
      headers['Signature'] = signature;
    }

    const config = { method, url: endpoint, headers, params: method === 'GET' ? params : undefined, data: method !== 'GET' ? data : undefined };
    const resp = await this.client(config);
    if (resp.data?.success === false) throw new Error(resp.data.message || 'API error');
    return resp.data?.data ?? resp.data;
  }

  // Public endpoints
  async getTickers() {
    return this.request('GET', '/api/v1/contract/ticker');
  }

  async getTicker(symbol) {
    const tickers = await this.getTickers();
    return tickers?.find(t => t.symbol === symbol) || null;
  }

  async getKlines(symbol, interval = 'Min60', limit = 200) {
    return this.request('GET', `/api/v1/contract/kline/${symbol}`, { interval, limit });
  }

  async getDepth(symbol, limit = 20) {
    return this.request('GET', `/api/v1/contract/depth/${symbol}`, { limit });
  }

  // Signed endpoints
  async getBalance() {
    return this.request('GET', '/api/v1/contract/asset', null, true);
  }

  async getPositions() {
    return this.request('GET', '/api/v1/contract/position', null, true);
  }

  async setLeverage(symbol, leverage, openType = 2) {
    return this.request('POST', '/api/v1/contract/position/change_leverage', {
      symbol, leverage, openType
    }, true);
  }

  async setAutoAddMargin(symbol, autoAdd = 1, openType = 2) {
    return this.request('POST', '/api/v1/contract/position/set_auto_add_margin', {
      symbol, autoAdd, openType
    }, true);
  }

  async placeOrder(order) {
    const payload = {
      symbol: order.symbol,
      price: order.price || 0,
      vol: order.size,
      side: order.side, // 1=open, 2=close
      type: order.type, // 1=limit, 2=post_only, 3=immediate_or_cancel, 4=fill_or_kill, 5=market
      openType: order.openType || 2, // 1=isolated, 2=cross
      leverage: order.leverage || 1,
      stopLossPrice: order.stopLoss || undefined,
      takeProfitPrice: order.takeProfit || undefined,
      positionId: order.positionId || undefined,
      externalOid: order.clientId || `bot_${Date.now()}`
    };
    return this.request('POST', '/api/v1/contract/order', payload, true);
  }

  async cancelOrder(orderId) {
    return this.request('DELETE', `/api/v1/contract/order/${orderId}`, null, true);
  }

  async getOrder(orderId) {
    return this.request('GET', `/api/v1/contract/order/${orderId}`, null, true);
  }

  // WebSocket for real-time data
  connectWS() {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(WS_URL);
        this.ws.on('open', () => {
          console.log('[Exchange] WebSocket connected');
          resolve();
        });
        this.ws.on('message', (raw) => {
          try {
            const msg = JSON.parse(raw.toString());
            this._handleWSMessage(msg);
          } catch {}
        });
        this.ws.on('close', () => {
          console.log('[Exchange] WebSocket disconnected, reconnecting in 5s...');
          setTimeout(() => this.connectWS(), 5000);
        });
        this.ws.on('error', (err) => {
          console.error('[Exchange] WebSocket error:', err.message);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  subscribeTicker(symbol, callback) {
    const channel = `ticker_${symbol}`;
    this.wsCallbacks[channel] = callback;
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ method: 'sub.ticker', param: { symbol } }));
    }
  }

  subscribeKline(symbol, interval, callback) {
    const channel = `kline_${symbol}_${interval}`;
    this.wsCallbacks[channel] = callback;
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ method: 'sub.kline', param: { symbol, interval } }));
    }
  }

  subscribeDepth(symbol, callback) {
    const channel = `depth_${symbol}`;
    this.wsCallbacks[channel] = callback;
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ method: 'sub.depth', param: { symbol } }));
    }
  }

  _handleWSMessage(msg) {
    const channel = msg.channel;
    if (channel && this.wsCallbacks[channel]) {
      this.wsCallbacks[channel](msg.data);
    }
    // Update price cache
    if (channel?.startsWith('ticker_')) {
      const symbol = channel.replace('ticker_', '');
      if (msg.data?.lastPrice) {
        this.priceCache[symbol] = parseFloat(msg.data.lastPrice);
      }
    }
  }

  getLastPrice(symbol) {
    return this.priceCache[symbol] || null;
  }

  // Convert MEXC kline interval format
  static intervalToMexc(interval) {
    const map = {
      '1m': 'Min1', '5m': 'Min5', '15m': 'Min15', '30m': 'Min30',
      '1h': 'Min60', '4h': 'Hour4', '1d': 'Day1', '1w': 'Week1'
    };
    return map[interval] || interval;
  }

  // Parse MEXC kline response to standard OHLCV
  static parseKlines(data) {
    if (!data || !Array.isArray(data)) return [];
    return data.map(k => ({
      time: k.time || k[0],
      open: parseFloat(k.open || k[1]),
      high: parseFloat(k.high || k[2]),
      low: parseFloat(k.low || k[3]),
      close: parseFloat(k.close || k[4]),
      volume: parseFloat(k.vol || k[5])
    })).sort((a, b) => a.time - b.time);
  }

  _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
}

module.exports = MexcExchange;
