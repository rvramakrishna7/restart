const generatePayoff = (positions = []) => {
  if (!positions.length) {
    return {
      chart: [],
      metrics: {},
    };
  }

  const strikes = [];

  positions.forEach((p) => {
    const match = p.symbol.match(/(\d{5})(?=CE|PE)/);

    if (match) {
      strikes.push(Number(match[1]));
    }
  });

  if (!strikes.length) {
    return {
      chart: [],
      metrics: {},
    };
  }

  const minStrike = Math.min(...strikes);
  const maxStrike = Math.max(...strikes);

  const rangeStart = minStrike - 2000;
  const rangeEnd = maxStrike + 2000;

  const chart = [];

  let maxProfit = -Infinity;
  let maxLoss = Infinity;

  const breakevens = [];

  for (let spot = rangeStart; spot <= rangeEnd; spot += 50) {
    let expiryPnl = 0;
    let t0Pnl = 0;

    positions.forEach((p) => {
      // ── skip closed legs from chart — their realized pnl added separately ──
      if (p.status === "CLOSED") return;

      const match = p.symbol.match(/(\d{5})(?=CE|PE)/);

      if (!match) return;

      const strike = Number(match[1]);

const optionType = p.symbol.includes("CE")
  ? "CE"
  : "PE";

      const premium = Number(p.avgPrice || 0);

      const qty = Math.abs(Number(p.qty || 0));

      const isBuy = Number(p.qty) > 0;

      let intrinsic = 0;

      if (optionType === "CE") {
        intrinsic = Math.max(spot - strike, 0);
      } else {
        intrinsic = Math.max(strike - spot, 0);
      }

      // EXPIRY CURVE
      let pnl = isBuy
        ? (intrinsic - premium) * qty
        : (premium - intrinsic) * qty;

      expiryPnl += pnl;

      // T+0 SIMULATION
      const distance = Math.abs(spot - strike);

      const decayFactor = Math.exp(-distance / 1200);

      const simulated = pnl * (0.25 + decayFactor * 0.75);

      t0Pnl += simulated;
    });

    chart.push({
      spot,
      pnl: Number(expiryPnl.toFixed(2)),
      t0: Number(t0Pnl.toFixed(2)),
    });

    maxProfit = Math.max(maxProfit, expiryPnl);
    maxLoss = Math.min(maxLoss, expiryPnl);
  }

  // BREAKEVENS
  for (let i = 1; i < chart.length; i++) {
    const prev = chart[i - 1];
    const curr = chart[i];

    if ((prev.pnl < 0 && curr.pnl > 0) || (prev.pnl > 0 && curr.pnl < 0)) {
      breakevens.push(curr.spot);
    }
  }

  // ── STRADDLE / STRANGLE: cap max loss at defined threshold ──
  // For short straddle/strangle, payoff chart shows unlimited loss which is wrong.
  // We cap it at our defined risk: 25pts × lots × lotSize (NIFTY) or 50pts × lots × lotSize (BANKNIFTY)
  const isStraddle = positions.some(
    (p) => p.strategyType === "INTRADAY_STRADDLE" || p.strategyType === "INTRADAY_STRANGLE"
  );
  if (isStraddle) {
    const samplePos = positions[0];
    const isBnf     = (samplePos?.symbol || "").includes("BANKNIFTY");
    const maxLossPts = isBnf ? 50 : 25;
    const lots      = Math.abs(samplePos?.lots || 1);
    const lotSize   = isBnf ? 30 : 65;
    const cappedLoss = -(maxLossPts * lots * lotSize);
    maxLoss = cappedLoss;
    // also cap chart data so graph doesn't show wild swings
    chart.forEach((point) => {
      if (point.pnl < cappedLoss) point.pnl = cappedLoss;
      if (point.t0  < cappedLoss) point.t0  = cappedLoss;
    });
  }

  // ── adjust maxProfit for already realized P&L from closed legs ──
  // closed legs (BUYSELL, SELLBUY) have fixed realized pnl that must be included
  const realizedPnl = positions
    .filter((p) => p.status === "CLOSED")
    .reduce((sum, p) => sum + Number(p.pnl || 0), 0);
  maxProfit = Number((maxProfit + realizedPnl).toFixed(2));
  maxLoss   = Number((maxLoss   + realizedPnl).toFixed(2));

  const rr = maxLoss !== 0 ? Math.abs(maxProfit / maxLoss).toFixed(2) : 0;
  const step = positions?.[0]?.symbol?.includes("BANKNIFTY") ? 100 : 50;

  const lowerBreakeven =
    breakevens.length > 0 ? Math.round(breakevens[0] / step) * step : null;

  const upperBreakeven =
    breakevens.length > 1 ? Math.round(breakevens[1] / step) * step : null;
  const profitablePoints = chart.filter((x) => x.pnl > 0).length;

  const pop = ((profitablePoints / chart.length) * 100).toFixed(2);

  return {
    chart,

    metrics: {
      maxProfit: Number(maxProfit.toFixed(2)),
      maxLoss: Number(maxLoss.toFixed(2)),
      rr,
      pop,
      breakevens,

      lowerBreakeven,
      upperBreakeven,

      requiredMargin:
        positions?.[0]?.margin ||
        positions?.[0]?.requiredMargin ||
        positions?.[0]?.spread?.margin ||
        0,
    },
  };
};

module.exports = {
  generatePayoff,
};