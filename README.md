# MEXC Futures Trading Bot

A professional-grade cryptocurrency futures trading bot with technical analysis, multiple strategies, and risk management. Built with Node.js.

## Features

- **5 Trading Strategies**: Trend Following, Mean Reversion, Breakout, Scalping, Smart Money (ICT)
- **Comprehensive TA Engine**: RSI, MACD, EMA/SMA, Bollinger Bands, ATR, ADX, CCI, Williams %R, MFI, OBV, VWAP, CMF, Keltner/Donchian Channels
- **Market Structure Analysis**: Support/Resistance detection, Fibonacci levels, Pivot Points, Swing High/Low detection
- **ICT Concepts**: Fair Value Gaps (FVG), Break of Structure (BOS), Change of Character (CHoCH)
- **Pattern Recognition**: Candlestick patterns (engulfing, doji, hammer, shooting star, morning/evening star)
- **Risk Management**: Position sizing, max daily loss, max positions, trailing stops, correlation checks
- **Paper & Live Trading**: Start with paper trading, switch to live when ready
- **Real-time Dashboard**: Web-based dashboard with TradingView charts
- **Telegram Notifications**: Trade alerts, daily summaries, risk warnings
- **SQLite Database**: All trades, signals, and stats persisted locally

## Quick Start

```bash
# Clone repository
git clone https://github.com/Fatkhl/mexc-trader-bot.git
cd mexc-trader-bot

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your MEXC API credentials

# Start the bot
npm start
```

The dashboard will be available at `http://localhost:3001`.

## Configuration

Edit `.env`:

```
MEXC_API_KEY=your_api_key
MEXC_API_SECRET=your_api_secret
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
PORT=3001
MODE=paper
```

## Architecture

```
src/
├── server.js       Main entry point + Express API + WebSocket
├── exchange.js     MEXC Contract V1 API client with rate limiting
├── analyzer.js     Technical analysis engine (20+ indicators)
├── strategies.js   5 trading strategies with configurable parameters
├── risk.js         Risk management engine
├── bot.js          Main bot loop: fetch → analyze → trade → manage
├── db.js           SQLite database for persistence
└── notify.js       Telegram notification system
```

## Strategies

| Strategy | Timeframes | Description |
|----------|-----------|-------------|
| Trend Following | 15m, 1h, 4h | EMA alignment + RSI + MACD + ADX confirmation |
| Mean Reversion | 15m, 1h | RSI extremes + Bollinger Band bounces |
| Breakout | 15m, 1h, 4h | S/R breakouts with volume confirmation |
| Scalping | 1m, 5m | Momentum crossovers with tight SL/TP |
| Smart Money | 15m, 1h, 4h | ICT concepts: FVG, BOS, order blocks |

## Risk Management

- Position sizing: Risk X% of account per trade (default 1%)
- Max concurrent positions (default 3)
- Max daily loss limit (default 5%)
- Correlation checks for related pairs
- Automatic stop-loss on every trade
- Trailing stop and break-even options

## API Endpoints

- `GET /api/status` — Bot status
- `POST /api/bot/start` — Start bot
- `POST /api/bot/stop` — Stop bot
- `PUT /api/bot/config` — Update configuration
- `GET /api/trades/open` — Open positions
- `GET /api/trades/history` — Trade history
- `GET /api/signals` — Recent signals
- `GET /api/stats` — Performance statistics
- `GET /api/analysis/:symbol` — TA analysis for symbol

## Disclaimer

⚠️ This bot is for educational purposes. Trading cryptocurrency futures involves significant risk. Always start with paper trading and never trade with money you cannot afford to lose.

## License

MIT
