// ──────────────────────────────────────────────────────────────
// strategyControllerBridge.js
// Lives in:  services/strategyControllerBridge.js
// Why this file exists:
//   websocketService.js can't require strategyController directly
//   because strategyController requires tradingService which requires
// websocketService  circular dependency crash.
//   This tiny bridge holds the shared tickMap so both sides can
// ──────────────────────────────────────────────────────────────

const lastTickMap = {}; // { [instrument_token]: last_price }

function updateTickMap(ticks) {
  if (!Array.isArray(ticks)) return;
  ticks.forEach((t) => {
    if (t.instrument_token && t.last_price) {
      lastTickMap[t.instrument_token] = t.last_price;
    }
  });
}

function getTickMap() {
  return lastTickMap;
}

module.exports = { updateTickMap, getTickMap };
