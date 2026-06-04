// =====================================================================
// ADJUSTMENT ENGINE — backward compatibility shim
// Logic has moved to:
// engine/strategyRouter.js          router
// engine/strategies/debitSpread.js  Debit Spread logic
// Any existing require("../engine/adjustmentEngine") still works.
// =====================================================================

const routeAdjustment = require("./strategyRouter");

module.exports = routeAdjustment;