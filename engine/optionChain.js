const logger = require("../utils/logger");
const zerodhaService = require("../services/zerodhaService");

let cachedInstruments = null;

// =====================
// LOAD INSTRUMENTS
// =====================
async function loadInstruments() {
  if (!cachedInstruments) {
    cachedInstruments = await zerodhaService.getInstruments();
  }
  return cachedInstruments;
}

// =====================
// FORMAT DATE
// =====================
function formatDate(date) {
  return new Date(date).toISOString().split("T")[0];
}

// =====================
// GET CLOSEST EXPIRY (FIXED)
// =====================
function getClosestExpiry(expiries, target) {
  if (!target) return expiries[0];

  const targetTime = new Date(target).getTime();

  let closest = expiries[0];
  let minDiff = Math.abs(new Date(closest).getTime() - targetTime);

  for (let e of expiries) {
    const diff = Math.abs(new Date(e).getTime() - targetTime);
    if (diff < minDiff) {
      minDiff = diff;
      closest = e;
    }
  }

  return closest;
}

// =====================
// MAIN FUNCTION
// =====================
async function getOptionChain(instrument, expiry, accessToken) {
  const instruments = await loadInstruments();

  let targetExpiry;

  if (typeof expiry === "string") {
    targetExpiry = expiry;
  } else if (expiry?.date) {
    targetExpiry = formatDate(expiry.date);
  }


  // =====================
  // GET ALL EXPIRIES
  // =====================
  const availableExpiries = [
    ...new Set(
      instruments
        .filter((i) => i.name === instrument && i.segment === "NFO-OPT")
        .map((i) => formatDate(i.expiry)),
    ),
  ].sort();

  // =====================
  // FIX: MATCH CLOSEST (NOT EXACT)
  // =====================
  const finalExpiry = getClosestExpiry(availableExpiries, targetExpiry);


  // =====================
  // FILTER OPTIONS
  // =====================
  const filtered = instruments.filter(
    (i) =>
      i.name === instrument &&
      i.segment === "NFO-OPT" &&
      formatDate(i.expiry) === finalExpiry,
  );

  if (!filtered.length) {
    throw new Error("No option chain data from Zerodha");
  }

  if (!accessToken) {
    throw new Error("Broker not connected");
  }

  // =====================
  // FIX: LIMIT SYMBOLS (IMPORTANT)
  // =====================
  //   .slice(0, 400) // prevent API overload
  //   .map((i) => `NFO:${i.tradingsymbol}`);

  // ── center the slice around spot so deep wings (±2500) are included ──
  // get spot to find ATM, then take strikes within a wide band around it
  let centerStrike = null;
  try {
    const spotPrice = await zerodhaService.getSpotPrice(accessToken, instrument);
    centerStrike = spotPrice;
  } catch (_) {}

  let sorted = [...filtered].sort((a, b) => a.strike - b.strike);

  if (centerStrike) {
    // band: ±3000 pts around spot covers deepest iron fly wings
    const band = instrument === "BANKNIFTY" ? 3500 : 2000;
    sorted = sorted.filter(
      (i) => Math.abs(i.strike - centerStrike) <= band,
    );
  }

  const symbols = sorted
    .slice(0, 400)
    .map((i) => `NFO:${i.tradingsymbol}`);

  let ltpData = {};

  try {
    ltpData = await zerodhaService.getLTP(accessToken, symbols);
  } catch (err) {
    if (
      !err.message.includes("ECONNRESET") &&
      !err.message.includes("ECONNABORTED")
    ) {
      logger.log("❌ LTP ERROR:", err.message);
    }
    throw new Error("Failed to fetch LTP");
  }

  // =====================
  // BUILD CHAIN
  // =====================
  const chainMap = {};

  filtered.forEach((i) => {
    const key = i.strike;

    if (!chainMap[key]) {
      chainMap[key] = {
        strike: i.strike,
        CE: null,
        PE: null,
        CE_symbol: null,
        PE_symbol: null,
        CE_token: null,
        PE_token: null,
      };
    }

    const ltp = ltpData[`NFO:${i.tradingsymbol}`]?.last_price || 0;

    if (i.instrument_type === "CE") {
      chainMap[key].CE = ltp;
      chainMap[key].CE_symbol = i.tradingsymbol;
      chainMap[key].CE_token = i.instrument_token;
      chainMap[key].lot_size = i.lot_size; // ← add lot size
    } else {
      chainMap[key].PE = ltp;
      chainMap[key].PE_symbol = i.tradingsymbol;
      chainMap[key].PE_token = i.instrument_token;
      chainMap[key].lot_size = i.lot_size; // ← add lot size
    }
  });

  return Object.values(chainMap);
}

module.exports = getOptionChain;