const logger = require("../../utils/logger");
const express = require("express");
const router = express.Router();

const auth = require("../middleware/auth");
const controller = require("../controllers/strategyController");
const { getLivePositions } = require("../controllers/positionController");

const User = require("../models/User");

// =====================
// EXECUTE STRATEGY
// =====================
router.post("/execute", auth, controller.executeStrategy);

// =====================
// GET POSITIONS
// =====================
router.get("/positions", auth, controller.getRealPositions);
router.get("/real-positions", auth, controller.getRealPositions);
router.get("/live-engine-positions", auth, getLivePositions);
router.get("/paper-positions", auth, controller.getPaperPositions);

// =====================
// EXIT
// =====================
router.post("/exit-all", auth, controller.exitAll);
router.post("/exit-single", auth, controller.exitSingle);

// =====================
// PAYOFF GRAPH
// =====================
router.post("/payoff", auth, (req, res) => {
  try {
    const { positions } = req.body;
    const { generatePayoff } = require("../../services/payoffEngine");
    const result = generatePayoff(positions || []);

    res.json({
      success: true,
      data: result,
    });
  } catch (err) {
    logger.error("PAYOFF ERROR:", err.message);
    res.status(500).json({ success: false, data: [] });
  }
});

// =====================
// PREVIEW
// =====================
router.post("/preview", auth, async (req, res) => {
  try {
    const { instrument, direction, expiry, lots } = req.body;

    const result =
      await require("../../services/tradingService").executeStrategy({
        instrument,
        direction,
        expiry,
        lots,
        userId: req.user,
        preview: true,
      });

    res.json({ success: true, data: result });
  } catch (err) {
    logger.error(err);
    res.status(500).json({ msg: "Preview failed" });
  }
});

// =====================
// REAL EXPIRIES FROM ZERODHA
// =====================
router.get("/expiries", auth, controller.getExpiries);

// =====================
// PREVIEW STRADDLE
// =====================
router.post("/preview-straddle", auth, async (req, res) => {
  try {
    const { instrument, expiry, lots } = req.body;
    if (!instrument || !expiry) return res.status(400).json({ success: false });

    const user = await require("../models/User").findById(req.user);
    const token = user?.broker?.accessToken;
    if (!token)
      return res
        .status(400)
        .json({ success: false, message: "Broker not connected" });

    const getOptionChain = require("../../engine/optionChain");
    const zerodhaService = require("../../services/zerodhaService");
    const { STRADDLE } = require("../../config/constants");

    const chain = await getOptionChain(instrument, expiry, token);
    const spot = await zerodhaService.getSpotPrice(token, instrument);

    const step = instrument === "NIFTY" ? 50 : 100;
    const atmStrike = Math.round(spot / step) * step;
    const atmOption = chain.find((o) => o.strike === atmStrike);
    if (!atmOption)
      return res.status(400).json({ success: false, message: "ATM not found" });

    const lotSize = atmOption.lot_size || (instrument === "NIFTY" ? 65 : 30);
    const qty = lotSize * (lots || 1);
    const cePremium = atmOption.CE || 0;
    const pePremium = atmOption.PE || 0;
    const combined = cePremium + pePremium;
    const maxLossTotal =
      STRADDLE.MAX_LOSS_PER_LOT[instrument] * (lots || 1) * lotSize;

    const tiers = STRADDLE.ADJUSTMENT_TIERS[instrument];
    let adjustPts = tiers[tiers.length - 1].movePts;
    for (const tier of tiers) {
      if (combined >= tier.minPremium) {
        adjustPts = tier.movePts;
        break;
      }
    }

    res.json({
      success: true,
      data: {
        atmStrike,
        cePremium: Number(cePremium.toFixed(2)),
        pePremium: Number(pePremium.toFixed(2)),
        combined: Number(combined.toFixed(2)),
        adjustPts,
        maxLoss: Number(maxLossTotal.toFixed(2)),
        futures: Number(spot.toFixed(2)),
        lotSize,
        quantity: qty,
      },
    });
  } catch (err) {
    logger.error("Preview straddle error:", err.message);
    res.status(500).json({ success: false });
  }
});

// =====================
// EXECUTE STRADDLE
// =====================
router.post("/execute-straddle", auth, async (req, res) => {
  try {
    const { instrument, expiry, lots, mode } = req.body;

    if (!instrument || !expiry) {
      return res
        .status(400)
        .json({ success: false, message: "instrument and expiry required" });
    }

    const { executeStraddle } = require("../../services/tradingService");

    const result = await executeStraddle({
      instrument,
      expiry,
      lots: lots || 1,
      userId: req.user,
      mode: mode || "paper",
    });

    res.json({ success: true, data: result });
  } catch (err) {
    logger.error("STRADDLE ERROR:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// =====================
// PREVIEW STRANGLE
// =====================
router.post("/preview-strangle", auth, async (req, res) => {
  try {
    const { instrument, expiry, lots } = req.body;
    if (!instrument || !expiry) return res.status(400).json({ success: false });

    const user = await require("../models/User").findById(req.user);
    const token = user?.broker?.accessToken;
    if (!token)
      return res
        .status(400)
        .json({ success: false, message: "Broker not connected" });

    const getOptionChain = require("../../engine/optionChain");
    const zerodhaService = require("../../services/zerodhaService");
    const { STRANGLE } = require("../../config/constants");

    const chain = await getOptionChain(instrument, expiry, token);
    const spot = await zerodhaService.getSpotPrice(token, instrument);

    const isBnf = instrument === "BANKNIFTY";
    const minDist = isBnf ? 600 : 200;
    const strikeStep = isBnf ? 100 : 50;
    const ceMinStrike = Math.floor((spot + minDist) / strikeStep) * strikeStep;
    const peMaxStrike = Math.ceil((spot - minDist) / strikeStep) * strikeStep;

    // ── three-tier premium preference ──
    const premiumTiers = isBnf ? [200, 150, 100] : [100, 75, 50];

    function findBestPair(minPrem) {
      const ceList = chain
        .filter((o) => o.strike >= ceMinStrike && o.CE >= minPrem && o.CE_token)
        .sort((a, b) => a.strike - b.strike);
      const peList = chain
        .filter((o) => o.strike <= peMaxStrike && o.PE >= minPrem && o.PE_token)
        .sort((a, b) => b.strike - a.strike);
      if (!ceList.length || !peList.length) return null;
      let best = null,
        bestDiff = Infinity;
      for (const ce of ceList) {
        for (const pe of peList) {
          const diff = Math.abs(ce.CE - pe.PE);
          if (diff < bestDiff) {
            bestDiff = diff;
            best = { ce, pe };
          }
        }
      }
      return best;
    }

    let bestPair = null;
    for (const tier of premiumTiers) {
      bestPair = findBestPair(tier);
      if (bestPair) break;
    }

    if (!bestPair) return res.json({ success: true, data: null }); // triggers "Discipline > Opportunity" in UI

    const bestCE = bestPair.ce;
    const bestPE = bestPair.pe;

    const lotSize = bestCE.lot_size || (isBnf ? 30 : 65);
    const qty = lotSize * (lots || 1);
    const cePremium = Number((bestCE.CE || 0).toFixed(2));
    const pePremium = Number((bestPE.PE || 0).toFixed(2));
    const combined = Number((cePremium + pePremium).toFixed(2));
    const maxLossTotal =
      STRANGLE.MAX_LOSS_PER_LOT[instrument] * (lots || 1) * lotSize;

    res.json({
      success: true,
      data: {
        ceStrike: bestCE.strike,
        peStrike: bestPE.strike,
        cePremium,
        pePremium,
        combined,
        minDist,
        maxLoss: Number(maxLossTotal.toFixed(2)),
        futures: Number(spot.toFixed(2)),
        lotSize,
        quantity: qty,
      },
    });
  } catch (err) {
    logger.error("Preview strangle error:", err.message);
    res.status(500).json({ success: false });
  }
});

// =====================
// EXECUTE STRANGLE
// =====================
router.post("/execute-strangle", auth, async (req, res) => {
  try {
    const { instrument, expiry, lots, mode } = req.body;

    if (!instrument || !expiry) {
      return res
        .status(400)
        .json({ success: false, message: "instrument and expiry required" });
    }

    const { executeStrangle } = require("../../services/tradingService");

    const result = await executeStrangle({
      instrument,
      expiry,
      lots: lots || 1,
      userId: req.user,
      mode: mode || "paper",
    });

    res.json({ success: true, data: result });
  } catch (err) {
    logger.error("STRANGLE ERROR:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});


// =====================
// PREVIEW IRON FLY
// =====================
router.post("/preview-iron-fly", auth, async (req, res) => {
  try {
    const { instrument, expiry, lots } = req.body;
    if (!instrument || !expiry) return res.status(400).json({ success: false });

    const user = await require("../models/User").findById(req.user);
    const token = user?.broker?.accessToken;
    if (!token) return res.status(400).json({ success: false, message: "Broker not connected" });

    const getOptionChain  = require("../../engine/optionChain");
    const zerodhaService  = require("../../services/zerodhaService");
    const { IRON_FLY }    = require("../../config/constants");

    const chain = await getOptionChain(instrument, expiry, token);
    const spot  = await zerodhaService.getSpotPrice(token, instrument);

    const isBnf     = instrument === "BANKNIFTY";
    const step      = isBnf ? 100 : 50;
    const atmStrike = Math.round(spot / step) * step;
    const atmOption = chain.find((o) => o.strike === atmStrike);
    if (!atmOption) return res.status(400).json({ success: false, message: "ATM not found" });

    const lotSize      = atmOption.lot_size || (isBnf ? 30 : 65);
    const qty          = lotSize * (lots || 1);
    const ceSellPrem   = atmOption.CE || 0;
    const peSellPrem   = atmOption.PE || 0;
    const combined     = ceSellPrem + peSellPrem;

    // ── check minimum combined premium ──
    // ── check minimum combined premium ──
    const daysToExp   = Math.ceil((new Date(expiry) - new Date()) / (1000 * 60 * 60 * 24));
    const isWeekly    = !isBnf && daysToExp <= 8;
    const minCombined = isBnf
      ? IRON_FLY.MIN_COMBINED_PREMIUM.BANKNIFTY.monthly
      : isWeekly
        ? IRON_FLY.MIN_COMBINED_PREMIUM.NIFTY.weekly
        : IRON_FLY.MIN_COMBINED_PREMIUM.NIFTY.monthly;

    if (combined < minCombined) {
      return res.json({ success: true, data: null }); // Discipline > Opportunity
    }

    // ── wing distance: FULL combined premium away from ATM, rounded to strike step ──
    const wingStep      = isBnf ? 100 : 50;
    const wingDist      = Math.round(combined / wingStep) * wingStep;
    const ceBuyStrike   = atmStrike + wingDist;
    const peBuyStrike   = atmStrike - wingDist;

    const ceBuyOption   = chain.find((o) => o.strike === ceBuyStrike);
    const peBuyOption   = chain.find((o) => o.strike === peBuyStrike);

    const ceBuyPrem     = ceBuyOption?.CE  || 0;
    const peBuyPrem     = peBuyOption?.PE  || 0;
    const netPremium    = Number((combined - ceBuyPrem - peBuyPrem).toFixed(2));
    const upperBE       = atmStrike + netPremium;
    const lowerBE       = atmStrike - netPremium;
    const maxProfit     = Number((netPremium * qty).toFixed(2));
    const maxLossTotal  = 2000 * (lots || 1);

    res.json({
      success: true,
      data: {
        atmStrike,
        ceSellPrem:  Number(ceSellPrem.toFixed(2)),
        peSellPrem:  Number(peSellPrem.toFixed(2)),
        combined:    Number(combined.toFixed(2)),
        ceBuyStrike,
        peBuyStrike,
        ceBuyPrem:   Number(ceBuyPrem.toFixed(2)),
        peBuyPrem:   Number(peBuyPrem.toFixed(2)),
        netPremium,
        upperBE:     Number(upperBE.toFixed(0)),
        lowerBE:     Number(lowerBE.toFixed(0)),
        maxProfit,
        maxLoss:     maxLossTotal,
        futures:     Number(spot.toFixed(2)),
        lotSize,
        quantity:    qty,
      },
    });
  } catch (err) {
    logger.error("Preview iron fly error:", err.message);
    res.status(500).json({ success: false });
  }
});

// =====================
// EXECUTE IRON FLY
// =====================
router.post("/execute-iron-fly", auth, async (req, res) => {
  try {
    const { instrument, expiry, lots, mode } = req.body;

    if (!instrument || !expiry) {
      return res.status(400).json({ success: false, message: "instrument and expiry required" });
    }

    const { executeIronFly } = require("../../services/tradingService");

    const result = await executeIronFly({
      instrument,
      expiry,
      lots:   lots || 1,
      userId: req.user,
      mode:   mode || "paper",
    });

    res.json({ success: true, data: result });
  } catch (err) {
    logger.error("IRON FLY ERROR:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;