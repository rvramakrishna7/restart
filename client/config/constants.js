const LOT_SIZES = {
  NIFTY:     65,
  BANKNIFTY: 30,
};

const FUTURE_TOKENS = {
  NIFTY:     256265,
  BANKNIFTY: 260105,
};

const STRIKE_STEP = {
  NIFTY:     50,   // ATM entry rounding
  BANKNIFTY: 100,  // ATM entry rounding
};

const ADJUSTMENT_STRIKE_STEP = {
  NIFTY:     100,  // new leg strike rounding (directional)
  BANKNIFTY: 100,  // new leg strike rounding (directional)
};

const STRADDLE = {
  MAX_LOSS_PER_LOT: {
    NIFTY:     25,
    BANKNIFTY: 50,
  },
  ADJUSTMENT_TIERS: {
    NIFTY: [
      { minPremium: 350, movePts: 100 },
      { minPremium: 250, movePts: 75  },
      { minPremium: 150, movePts: 50  },
      { minPremium: 0,   movePts: 25  },
    ],
    BANKNIFTY: [
      { minPremium: 1200, movePts: 300 },
      { minPremium: 800,  movePts: 200 },
      { minPremium: 600,  movePts: 150 },
      { minPremium: 0,    movePts: 100 },
    ],
  },
};

const STRANGLE = {
  RISE_TRIGGER_PCT:  0.50,
  DECAY_TRIGGER_PCT: 0.40,
  MAX_LOSS_PER_LOT: { NIFTY: 25, BANKNIFTY: 50 },
};

const IRON_FLY = {
  MIN_COMBINED_PREMIUM: {
    NIFTY:     { weekly: 500,  monthly: 900  },
    BANKNIFTY: { weekly: 1200, monthly: 1200 },
  },
  WING_MIN_DISTANCE:    50,
  WING_MAX_DISTANCE:    200,
  ENTRY_HOUR:           15,
  ENTRY_MINUTE:         20,
  ENTRY_WINDOW_MINUTES: 15,
  MAX_LOSS_PER_LOT:     { NIFTY: null, BANKNIFTY: null },
};

const CALENDAR = {
  ALLOWED_INSTRUMENTS: ["NIFTY"],
  NORMAL_VIX_MAX:      20,
  INVERSE_VIX_MIN:     20,
  WEEKLY_GAP:          250,
  MONTHLY_GAP:         500,
  ADJUSTMENT_PCT:      0.25,
  MAX_LOSS_PER_LOT:    null,
};

module.exports = { LOT_SIZES, FUTURE_TOKENS, STRIKE_STEP, ADJUSTMENT_STRIKE_STEP, STRADDLE, STRANGLE, IRON_FLY, CALENDAR };