const logger = require("../utils/logger");
const debitSpreadEngine = require("./strategies/debitSpread");
const intradayStraddle  = require("./strategies/intradayStraddle");
const intradayStrangle  = require("./strategies/intradayStrangle");
const ironFly           = require("./strategies/ironFly");
const calendarSpread    = require("./strategies/calendarSpread");

function routeAdjustment(position, currentPrice, pnl, optionChain, tickMap) {
  if (!position) return;
  if (position.isClosed || position.forceExit) return;

  switch (position.strategyType || "DEBIT_SPREAD") {
    case "DEBIT_SPREAD":       return debitSpreadEngine(position, currentPrice, pnl, optionChain, tickMap);
    case "INTRADAY_STRADDLE":  return intradayStraddle(position, currentPrice, pnl, optionChain, tickMap);
    case "INTRADAY_STRANGLE":  return intradayStrangle(position, currentPrice, pnl, optionChain, tickMap);
    case "IRON_FLY":           return ironFly(position, currentPrice, pnl, optionChain, tickMap);
    case "CALENDAR_SPREAD":    return calendarSpread(position, currentPrice, pnl, optionChain, tickMap);
    default:
      logger.log(`⚠️ Unknown strategyType: ${position.strategyType}`);
  }
}

module.exports = routeAdjustment;