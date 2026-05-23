const axios = require('axios');

let botToken = null;
let chatId = null;

function configure(token, chat) {
  botToken = token;
  chatId = chat;
}

async function send(message) {
  if (!botToken || !chatId) {
    console.log('[Notify] Telegram not configured, skipping:', message.substring(0, 80));
    return;
  }
  try {
    await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      chat_id: chatId,
      text: message,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    });
  } catch (err) {
    console.error('[Notify] Telegram error:', err.message);
  }
}

function notifyTradeOpen(trade) {
  const emoji = trade.direction === 'long' ? '🟢' : '🔴';
  const msg = `${emoji} <b>TRADE OPENED</b>
━━━━━━━━━━━━━━━━━━━━
📊 <b>Symbol:</b> ${trade.symbol}
📈 <b>Direction:</b> ${trade.direction.toUpperCase()}
💰 <b>Entry:</b> ${trade.entry_price}
📏 <b>Size:</b> ${trade.size}
⚡ <b>Leverage:</b> ${trade.leverage}x
🛡 <b>Stop Loss:</b> ${trade.stop_loss || 'None'}
🎯 <b>Take Profit:</b> ${trade.take_profit || 'None'}
📋 <b>Strategy:</b> ${trade.strategy}
━━━━━━━━━━━━━━━━━━━━`;
  return send(msg);
}

function notifyTradeClose(trade) {
  const emoji = trade.pnl >= 0 ? '✅' : '❌';
  const msg = `${emoji} <b>TRADE CLOSED</b>
━━━━━━━━━━━━━━━━━━━━
📊 <b>Symbol:</b> ${trade.symbol}
📈 <b>Direction:</b> ${trade.direction.toUpperCase()}
💰 <b>Entry:</b> ${trade.entry_price}
💰 <b>Exit:</b> ${trade.exit_price}
💵 <b>PnL:</b> ${trade.pnl >= 0 ? '+' : ''}${trade.pnl.toFixed(2)} USDT (${trade.pnl_percent >= 0 ? '+' : ''}${trade.pnl_percent.toFixed(2)}%)
📋 <b>Strategy:</b> ${trade.strategy}
━━━━━━━━━━━━━━━━━━━━`;
  return send(msg);
}

function notifyDailySummary(stats) {
  const msg = `📊 <b>DAILY SUMMARY</b>
━━━━━━━━━━━━━━━━━━━━
📅 <b>Date:</b> ${stats.date}
📈 <b>Trades:</b> ${stats.trades}
✅ <b>Wins:</b> ${stats.wins}
❌ <b>Losses:</b> ${stats.losses}
🎯 <b>Win Rate:</b> ${stats.win_rate.toFixed(1)}%
💵 <b>Total PnL:</b> ${stats.pnl >= 0 ? '+' : ''}${stats.pnl.toFixed(2)} USDT
🏆 <b>Best Trade:</b> +${stats.best_trade.toFixed(2)} USDT
💔 <b>Worst Trade:</b> ${stats.worst_trade.toFixed(2)} USDT
━━━━━━━━━━━━━━━━━━━━`;
  return send(msg);
}

function notifyRiskAlert(type, detail) {
  const msg = `⚠️ <b>RISK ALERT</b>
━━━━━━━━━━━━━━━━━━━━
🔔 <b>Type:</b> ${type}
📝 <b>Detail:</b> ${detail}
━━━━━━━━━━━━━━━━━━━━`;
  return send(msg);
}

function notifyStrongSignal(signal) {
  const msg = `💡 <b>STRONG SIGNAL DETECTED</b>
━━━━━━━━━━━━━━━━━━━━
📊 <b>Symbol:</b> ${signal.symbol}
📈 <b>Type:</b> ${signal.type.toUpperCase()}
📋 <b>Strategy:</b> ${signal.strategy}
💪 <b>Strength:</b> ${signal.strength}/100
📝 <b>Detail:</b> ${signal.detail}
💰 <b>Price:</b> ${signal.price}
⚠️ <i>Signal not traded due to risk limits</i>
━━━━━━━━━━━━━━━━━━━━`;
  return send(msg);
}

function notifyBotStatus(status, mode) {
  const emoji = status === 'started' ? '🚀' : '🛑';
  const msg = `${emoji} <b>BOT ${status.toUpperCase()}</b>
━━━━━━━━━━━━━━━━━━━━
📋 <b>Mode:</b> ${mode.toUpperCase()}
🕐 <b>Time:</b> ${new Date().toISOString()}
━━━━━━━━━━━━━━━━━━━━`;
  return send(msg);
}

module.exports = {
  configure, send, notifyTradeOpen, notifyTradeClose, notifyDailySummary,
  notifyRiskAlert, notifyStrongSignal, notifyBotStatus
};
