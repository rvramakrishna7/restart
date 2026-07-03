const logger = require("../../utils/logger");
const { sendAlert } = require("../../services/notify");
const money = (n) =>
  "₹" +
  Number(n || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
const signed = (n) => (n >= 0 ? "+" : "") + money(n);
// =====================================================================
// DEBIT SPREAD ADJUSTMENT ENGINE
// Bull Call Spread / Bear Put Spread
// =====================================================================

function checkDebitSpread(position, currentPremium, pnl, optionChain, tickMap) {
  if (!tickMap) tickMap = {};
  if (!position) return;

  // ── re-entry lock: if this position is already being processed, skip ──
  if (position._processing) return;
  position._processing = true;

  try {
    _checkDebitSpread(position, currentPremium, pnl, optionChain, tickMap);
  } finally {
    position._processing = false;
  }
}

function _checkDebitSpread(
  position,
  currentPremium,
  pnl,
  optionChain,
  tickMap,
) {
  if (!tickMap) tickMap = {};
  if (!position) return;

  // ── GUARD: only adjust when we have a live WebSocket tick price ──
  // currentPremium = pos.currentBuyPrice set in handleTicks from real WS ticks
  // if it's missing or zero, no tick received yet — skip
  if (!currentPremium || currentPremium <= 0) return;

  // ── GUARD: skip if price hasn't moved from entry (tick not yet received) ──
  // on first option chain fetch, currentBuyPrice may not be set yet
  // positionManager sets currentBuyPrice ONLY from WS ticks, never from entry
  if (!position.currentBuyPrice || position.currentBuyPrice <= 0) {
    logger.log("⏳ Waiting for first live WS tick before adjustments");
    return;
  }

  // ── RISK FREE CHECK: if realized profit already covers max loss, stop all monitoring ──
  if (
    position.realizedProfitFromShifts >= position.originalMaxLoss &&
    position.originalMaxLoss > 0
  ) {
    logger.log(
      "🏆 RISK FREE — realized profit covers max loss → monitoring stopped",
    );
    return;
  }

  // log only every 30 seconds to avoid flooding terminal
  const now = Date.now();
  if (!position._lastLogTime || now - position._lastLogTime > 30000) {
    position._lastLogTime = now;
    logger.log(
      "📊 ENGINE TICK | buyPrice:",
      position.currentBuyPrice,
      "| entry:",
      position.entryPremium,
      "| shiftCount:",
      position.shiftCount,
      "| realized:",
      position.realizedProfitFromShifts.toFixed(2),
      "| maxLoss:",
      position.originalMaxLoss.toFixed(2),
    );

    // ── which side is monitoring ──
    if (!position.lossAdjusted && !position.isStrangle) {
      const threshold = (position.entryPremium * 0.9).toFixed(2);
      if (position.currentBuyPrice > position.entryPremium) {
        logger.log(
          "✅ PROFIT SIDE MONITORING | buyPrice:",
          position.currentBuyPrice,
          "| entry:",
          position.entryPremium,
          "| spot:",
          tickMap[position.index === "NIFTY" ? 256265 : 260105] || "N/A",
          "| buyStrike:",
          position.buyStrike,
          "| isITM:",
          position.index === "NIFTY"
            ? tickMap[256265] > position.buyStrike
            : tickMap[260105] < position.buyStrike,
        );
      } else {
        logger.log(
          "👀 LOSS SIDE MONITORING | buyPrice:",
          position.currentBuyPrice,
          "| threshold:",
          threshold,
          "| triggered:",
          position.currentBuyPrice <= position.entryPremium * 0.9,
        );
      }
    }
    // ── strangle monitoring log ──
    if (position.isStrangle && position.CE_sell && position.PE_sell) {
      const ceThreshold = (position.basePremium * 1.15).toFixed(2);
      const peThreshold = (position.basePremium * 1.15).toFixed(2);
      const ceLtp = position.CE_sell.currentPrice || 0;
      const peLtp = position.PE_sell.currentPrice || 0;
      logger.log(
        "🔀 STRANGLE MONITORING | basePremium:",
        position.basePremium,
        "| CE strike:",
        position.CE_sell.strike,
        "| CE entry:",
        position.CE_sell.premium,
        "| CE ltp:",
        ceLtp,
        "| CE threshold:",
        ceThreshold,
        "| CE triggered:",
        ceLtp >= position.basePremium * 1.15,
        "| PE strike:",
        position.PE_sell.strike,
        "| PE entry:",
        position.PE_sell.premium,
        "| PE ltp:",
        peLtp,
        "| PE threshold:",
        peThreshold,
        "| PE triggered:",
        peLtp >= position.basePremium * 1.15,
      );
    }
  }

  const tolerance = position.index === "BANKNIFTY" ? 10 : 5;
  const conversionTolerance = position.index === "BANKNIFTY" ? 20 : 15;

  // =============================
  // FINAL RISK EXIT
  // =============================
  const maxLoss = position.maxLossPerLot * position.quantity;

  if (Math.abs(pnl) >= maxLoss && pnl < 0) {
    position.forceExit = true;
    logger.log("❌ MAX LOSS HIT → EXIT ALL");
    return;
  }

  // =============================
  // LOSS SIDE (50% RULE)
  // =============================
  if (!position.lossAdjusted) {
    const currentBuyPremium = currentPremium;

    if (currentBuyPremium <= position.entryPremium * 0.5) {
      logger.log("⚠️ LOSS SIDE TRIGGERED (50%)");

      position.lossAdjusted = true;
      // position.isStrangle = true;

      // ── use current live sell leg LTP not original entry price ──
      const sellPremium = position.currentSellPrice || position.sellPremium;

      let oppositeLeg = null;
      let closestDiff = Infinity;

      for (let option of optionChain) {
        if (option.strike === position.sellStrike) continue; // ── skip existing sell leg strike ──
        const premium = position.type === "BULL_CALL" ? option.PE : option.CE;
        const diff = Math.abs(premium - sellPremium);

        if (diff < closestDiff && diff <= conversionTolerance) {
          closestDiff = diff;
          oppositeLeg = {
            strike: option.strike,
            premium,
            token: Number(
              position.type === "BULL_CALL" ? option.PE_token : option.CE_token,
            ),
          };
        }
      }

      if (!oppositeLeg) {
        logger.log(
          "⚠️ LOSS CONVERSION FAILED — no opposite leg found within tolerance | sellPremium:",
          sellPremium,
        );
        position.lossAdjusted = false; // reset so it retries next tick
        return;
      }

      // exit buy leg — save exit price so UI can freeze the LTP
      position.isStrangle = true;
      position.closedBuyPrice = currentBuyPremium;

      position.buyQty = 0;
      position.buyClosed = true;
      position.closedBuyAt = new Date().toISOString();

      // convert to strangle
      // CE_sell/PE_sell from MongoDB are Mongoose subdocuments — convert to plain object
      if (position.type === "BULL_CALL") {
        position.PE_sell = {
          ...oppositeLeg,
          openedAt: new Date().toISOString(),
        };
        position.CE_sell = {
          strike: position.sellStrike,
          premium: position.currentSellPrice || position.sellPremium,
          token: Number(position.sellToken),
          openedAt: new Date().toISOString(),
        };
      } else {
        position.CE_sell = {
          ...oppositeLeg,
          openedAt: new Date().toISOString(),
        };
        position.PE_sell = {
          strike: position.sellStrike,
          premium: position.currentSellPrice || position.sellPremium,
          token: Number(position.sellToken),
          openedAt: new Date().toISOString(),
        };
      }

      // ── set basePremium to current market CE premium not entry sell premium ──
      // this prevents strangle CE adjustment firing immediately after conversion
      const currentCE = optionChain.find(
        (o) => o.strike === position.sellStrike,
      );
      position.basePremium = currentCE
        ? position.type === "BULL_CALL"
          ? currentCE.CE
          : currentCE.PE
        : position.currentSellPrice ||
          position.sellPremium ||
          oppositeLeg.premium;

      logger.log("✅ Converted to Strangle (Loss Recovery)");
      logger.log("POSITION STATE:", {
        type: position.type,
        buyStrike: position.buyStrike,
        sellStrike: position.sellStrike,
        CE_sell: position.CE_sell,
        PE_sell: position.PE_sell,
        basePremium: position.basePremium,
        shiftCount: position.shiftCount,
      });

      position.history.push({
        type: "LOSS_CONVERSION",
        message: "Converted to Strangle",
        time: new Date().toISOString(),
      });
      try {
        const buyLegLoss =
          (currentBuyPremium - position.entryPremium) *
          (position.quantity || 0);
        sendAlert(
          `🔁 DEBIT SPREAD → STRANGLE | ${position.index}\n` +
            `Reason: buy leg hit 50% loss (entry ${money(position.entryPremium)} → ${money(currentBuyPremium)})\n` +
            `Closed BUY ${position.buyStrike} @ ${money(currentBuyPremium)} (${signed(buyLegLoss)})\n` +
            `Strangle legs: CE ${position.CE_sell?.strike} @ ${money(position.CE_sell?.premium)} / PE ${position.PE_sell?.strike} @ ${money(position.PE_sell?.premium)}`,
        );
      } catch (e) {}
      return;
    }
  }

  // =============================
  // PROFIT SIDE SHIFTING
  // =============================
  if (!position.isStrangle) {
    if (!position.shiftCount) position.shiftCount = 0;

    const buyStrike = position.buyStrike;

    // Using live WS tick price (currentPremium) as the current buy premium
    // NOT option chain LTP which can be stale on first fetch
    // currentPremium = position.currentBuyPrice set directly from Zerodha WS ticks
    const currentBuyPremium = currentPremium;

    // still need option chain entry to get OTM strike premiums for diff calculation
    const currentOption = optionChain.find((o) => o.strike === buyStrike);
    if (!currentOption) {
      logger.log(
        "⏳ PROFIT SIDE: buyStrike",
        buyStrike,
        "not found in option chain — skipping",
      );
      return;
    }

    // ── PROFIT SHIFT DIRECTION ──
    // BULL_CALL: buy CE goes ITM as market rises  OTM is ABOVE  check +100, +50
    // BEAR_PUT:  buy PE goes ITM as market falls  OTM is BELOW  check -100, -50
    // diff = currentBuyPremium - otmPremium (always positive when ITM enough to shift)
    // Prefer 100-point shift; only try 50-point if 100 not triggered
    const isBull = position.type === "BULL_CALL";
    const otm100 = isBull ? buyStrike + 100 : buyStrike - 100;
    const otm50 = isBull ? buyStrike + 50 : buyStrike - 50;

    // ── SPOT PRICE CHECK: only shift if underlying has actually crossed buy strike ──
    // NIFTY token: 256265, BANKNIFTY token: 260105
    const spotToken = position.index === "NIFTY" ? 256265 : 260105;
    const spotPrice = tickMap[spotToken];
    if (!spotPrice) {
      logger.log("⏳ Spot price not available yet — skipping shift check");
      return;
    }
    const isITM = isBull ? spotPrice > buyStrike : spotPrice < buyStrike;
    if (!isITM) {
      return;
    }
    logger.log(
      "✅ SPOT CHECK PASSED | spot:",
      spotPrice,
      "| buyStrike:",
      buyStrike,
      "| ITM confirmed",
    );

    // ── NIFTY ──
    if (position.index === "NIFTY") {
      let shiftDone = false;

      // Step 1: try 100-point shift first
      const next100 = optionChain.find((o) => o.strike === otm100);
      if (next100) {
        const otmToken100 = isBull ? next100.CE_token : next100.PE_token;
        // ── CRITICAL: use live WS tick for OTM premium if available ──
        // if OTM token not yet in tickMap (not subscribed), skip this check
        const otmTickPrice100 =
          tickMap[Number(otmToken100)] || (isBull ? next100.CE : next100.PE);
        if (!otmTickPrice100) {
          logger.log("⏳ OTM100 not available | token:", Number(otmToken100));
        } else {
          logger.log(
            "✅ OTM100 price | token:",
            Number(otmToken100),
            "| price:",
            otmTickPrice100,
            "| source:",
            tickMap[Number(otmToken100)] ? "WS" : "chain",
          );
          const diff = currentBuyPremium - otmTickPrice100;
          logger.log(
            "🔍 PRICES: currentBuy=",
            currentBuyPremium,
            "otmTick=",
            otmTickPrice100,
            "entry=",
            position.entryPremium,
          );
          logger.log("CHECKING PROFIT SHIFT:", {
            index: "NIFTY",
            shiftType: "100",
            diff,
            shiftCount: position.shiftCount,
            buyStrike,
            otm100,
          });

          if (diff >= 65 && position.shiftCount < 2) {
            logger.log("🚀 100 SHIFT (NIFTY)", buyStrike, "→", otm100);
            const realizedNow =
              (currentBuyPremium -
                (position.currentLegEntryPrice || position.entryPremium)) *
              position.quantity;
            position.realizedProfitFromShifts =
              (position.realizedProfitFromShifts || 0) + realizedNow;
            logger.log(
              "💰 Realized from this shift:",
              realizedNow.toFixed(2),
              "| Total realized:",
              position.realizedProfitFromShifts.toFixed(2),
            );
            position.history.push({
              type: "SHIFT_100",
              message: `Buy shifted ${buyStrike} → ${otm100} | realized: ${realizedNow.toFixed(0)}`,
              time: new Date().toISOString(),
            });
            try {
              sendAlert(
                `🔄 DEBIT SPREAD SHIFT | ${position.index} | ${position.type}\n` +
                  `Reason: buy leg ITM, profit shift (spot ${spotPrice} crossed ${buyStrike})\n` +
                  `Shifted BUY: ${buyStrike} → ${otm100}\n` +
                  `Old leg exit @ ${money(currentBuyPremium)} | new leg @ ${money(otmTickPrice100)}\n` +
                  `Realized this shift: ${signed(realizedNow)} | Total realized: ${signed(position.realizedProfitFromShifts)}`,
              );
            } catch (e) {}
            // ── save old buy leg as closed row for UI ──
            if (!position.closedBuyLegs) position.closedBuyLegs = [];
            position.closedBuyLegs.push({
              symbol: position.buySymbol || `${position.index} ${buyStrike}`,
              strike: buyStrike,
              entryPremium:
                position.currentLegEntryPrice || position.entryPremium,
              exitPremium: currentBuyPremium,
              token: position.buyToken,
              closedAt: new Date().toISOString(),
            });
            position.closedBuyPrice = currentBuyPremium; // ✅ exit price of old leg
            position.buyStrike = otm100;
            position.buyToken = Number(
              isBull ? next100.CE_token : next100.PE_token,
            );
            position.buySymbol = isBull ? next100.CE_symbol : next100.PE_symbol; // ✅ new leg symbol
            position.currentLegEntryPrice = otmTickPrice100;
            // position.currentBuyPrice = otmTickPrice100;
            position.buyAvgPrice = otmTickPrice100; // ✅ new leg entry for UI
            position.shiftCount += 1;
            shiftDone = true;
            return;
          }
        } // end otmTickPrice100 check
      }

      // Step 2: try 50-point shift only if 100 didn't fire
      if (!shiftDone) {
        const next50 = optionChain.find((o) => o.strike === otm50);
        if (next50) {
          const otmToken50 = isBull ? next50.CE_token : next50.PE_token;
          const otmTickPrice50 =
            tickMap[Number(otmToken50)] || (isBull ? next50.CE : next50.PE);
          if (!otmTickPrice50) {
            // skip
          } else {
            const nextPremium = otmTickPrice50;
            const diff = currentBuyPremium - nextPremium;

            logger.log("CHECKING PROFIT SHIFT:", {
              index: "NIFTY",
              shiftType: "50",
              diff,
              shiftCount: position.shiftCount,
              buyStrike,
              otm50,
            });

            if (diff >= 35 && position.shiftCount < 4) {
              logger.log("🚀 50 SHIFT (NIFTY)", buyStrike, "→", otm50);
              const realizedNow =
                (currentBuyPremium -
                  (position.currentLegEntryPrice || position.entryPremium)) *
                position.quantity;
              position.realizedProfitFromShifts =
                (position.realizedProfitFromShifts || 0) + realizedNow;
              logger.log(
                "💰 Realized from this shift:",
                realizedNow.toFixed(2),
                "| Total realized:",
                position.realizedProfitFromShifts.toFixed(2),
              );
              position.history.push({
                type: "SHIFT_50",
                message: `Buy shifted ${buyStrike} → ${otm50} | realized: ${realizedNow.toFixed(0)}`,
                time: new Date().toISOString(),
              });
              try {
                sendAlert(
                  `🔄 DEBIT SPREAD SHIFT | ${position.index} | ${position.type}\n` +
                    `Reason: buy leg ITM, profit shift (spot ${spotPrice} crossed ${buyStrike})\n` +
                    `Shifted BUY: ${buyStrike} → ${otm50}\n` +
                    `Old leg exit @ ${money(currentBuyPremium)} | new leg @ ${money(otmTickPrice50)}\n` +
                    `Realized this shift: ${signed(realizedNow)} | Total realized: ${signed(position.realizedProfitFromShifts)}`,
                );
              } catch (e) {}
              // ── save old buy leg as closed row for UI ──
              if (!position.closedBuyLegs) position.closedBuyLegs = [];
              position.closedBuyLegs.push({
                symbol: position.buySymbol || `${position.index} ${buyStrike}`,
                strike: buyStrike,
                entryPremium:
                  position.currentLegEntryPrice || position.entryPremium,
                exitPremium: currentBuyPremium,
                token: position.buyToken,
                closedAt: new Date().toISOString(),
              });
              position.closedBuyPrice = currentBuyPremium; //  exit price of old leg
              position.buyStrike = otm50;
              position.buyToken = Number(
                isBull ? next50.CE_token : next50.PE_token,
              );
              position.buySymbol = isBull ? next50.CE_symbol : next50.PE_symbol; // new leg symbol
              position.currentLegEntryPrice = otmTickPrice50;

              position.buyAvgPrice = otmTickPrice50; //  new leg entry for UI
              position.shiftCount += 1;
              return;
            }
          }
        }
      }
    }

    // ── BANKNIFTY: 100-point shift only ──
    if (position.index === "BANKNIFTY") {
      const next100 = optionChain.find((o) => o.strike === otm100);
      if (next100) {
        const otmTokenBnf = isBull ? next100.CE_token : next100.PE_token;
        const otmTickPriceBnf =
          tickMap[Number(otmTokenBnf)] || (isBull ? next100.CE : next100.PE);
        if (!otmTickPriceBnf) {
          // skip
        } else {
          const nextPremium = otmTickPriceBnf;
          const diff = currentBuyPremium - nextPremium;

          logger.log("CHECKING PROFIT SHIFT:", {
            index: "BANKNIFTY",
            shiftType: "100",
            diff,
            shiftCount: position.shiftCount,
            buyStrike,
            otm100,
          });

          if (diff >= 65 && position.shiftCount < 2) {
            logger.log("🚀 100 SHIFT (BANKNIFTY)", buyStrike, "→", otm100);
            const realizedNow =
              (currentBuyPremium -
                (position.currentLegEntryPrice || position.entryPremium)) *
              position.quantity;
            position.realizedProfitFromShifts =
              (position.realizedProfitFromShifts || 0) + realizedNow;
            logger.log(
              "💰 Realized from this shift:",
              realizedNow.toFixed(2),
              "| Total realized:",
              position.realizedProfitFromShifts.toFixed(2),
            );
            position.history.push({
              type: "SHIFT_100",
              message: `Buy shifted ${buyStrike} → ${otm100} | realized: ${realizedNow.toFixed(0)}`,
              time: new Date().toISOString(),
            });
            try {
              sendAlert(
                `🔄 DEBIT SPREAD SHIFT | ${position.index} | ${position.type}\n` +
                  `Reason: buy leg ITM, profit shift (spot ${spotPrice} crossed ${buyStrike})\n` +
                  `Shifted BUY: ${buyStrike} → ${otm100}\n` +
                  `Old leg exit @ ${money(currentBuyPremium)} | new leg @ ${money(otmTickPriceBnf)}\n` +
                  `Realized this shift: ${signed(realizedNow)} | Total realized: ${signed(position.realizedProfitFromShifts)}`,
              );
            } catch (e) {}
            // ── save old buy leg as closed row for UI ──
            if (!position.closedBuyLegs) position.closedBuyLegs = [];
            position.closedBuyLegs.push({
              symbol: position.buySymbol || `${position.index} ${buyStrike}`,
              strike: buyStrike,
              entryPremium:
                position.currentLegEntryPrice || position.entryPremium,
              exitPremium: currentBuyPremium,
              token: position.buyToken,
              closedAt: new Date().toISOString(),
            });
            position.closedBuyPrice = currentBuyPremium; // ✅ exit price of old leg
            position.buyStrike = otm100;
            position.buyToken = Number(
              isBull ? next100.CE_token : next100.PE_token,
            );
            position.buySymbol = isBull ? next100.CE_symbol : next100.PE_symbol; // ✅ new leg symbol
            position.currentLegEntryPrice = otmTickPriceBnf;
            // position.currentBuyPrice = otmTickPriceBnf;
            position.buyAvgPrice = otmTickPriceBnf; // ✅ new leg entry for UI
            position.shiftCount += 1;
            return;
          }
        } // end otmTickPriceBnf check
      }
    }

    return;
  }

  // =============================
  // STRANGLE LOOP
  // =============================
  const ce = optionChain.find((o) => o.strike === position.CE_sell?.strike);
  const pe = optionChain.find((o) => o.strike === position.PE_sell?.strike);

  if (!ce || !pe) return;
  // ── cooldown: skip strangle check if adjustment fired within last 10 seconds ──
  if (
    position._strangleAdjustedAt &&
    Date.now() - position._strangleAdjustedAt < 10000
  )
    return;
  const cePremium = ce.CE;
  const pePremium = pe.PE;

  // Rule 2: both decayed 25% — monitor only
  if (
    cePremium <= position.basePremium * 0.75 &&
    pePremium <= position.basePremium * 0.75
  ) {
    return;
  }

  // Rule 1/3: CE up 50% — adjust PE
  if (cePremium >= position.basePremium * 1.15) {
    logger.log(
      "⚡ CE Adjustment | CE:",
      cePremium,
      "| basePremium:",
      position.basePremium,
      "| threshold:",
      (position.basePremium * 1.05).toFixed(2),
    );

    // ── save old PE leg as closed before replacing ──
    // ── CE rose — close CE leg, find new CE matching PE premium ──
    if (position.CE_sell && position.CE_sell.strike) {
      const exitPremium = cePremium;
      const realizedPnl =
        (position.CE_sell.premium - exitPremium) * (position.quantity || 0);
      if (!position.closedStrangleLegs) position.closedStrangleLegs = [];
      position.closedStrangleLegs.push({
        strike: position.CE_sell.strike,
        type: "CE",
        entryPremium: position.CE_sell.premium,
        exitPremium,
        pnl: Number(realizedPnl.toFixed(2)),
        openedAt: position.CE_sell.openedAt || null,
        closedAt: new Date().toISOString(),
      });
      logger.log(
        "📋 Closed CE leg | strike:",
        position.CE_sell.strike,
        "| entry:",
        position.CE_sell.premium,
        "| exit:",
        exitPremium,
        "| pnl:",
        realizedPnl.toFixed(2),
      );
    }

    position.basePremium = pePremium; // ← new CE leg matches PE premium, so basePremium = PE premium (new leg entry)
    position.history.push({
      type: "CE_ADJUST",
      message: "CE rose — closed CE, new CE shorted matching PE premium",
      time: new Date().toISOString(),
    });
    // find new CE strike matching current PE premium
    const target = pePremium;
    // ── guard: don't re-short same strike at same premium ──
    if (position.CE_sell?.premium === pePremium && position.CE_sell?.strike)
      return;
    for (let option of optionChain) {
      if (Math.abs(option.CE - target) <= tolerance) {
        position.CE_sell = {
          strike: option.strike,
          premium: option.CE,
          token: Number(option.CE_token),
          openedAt: new Date().toISOString(),
        };
        logger.log(
          "✅ New CE leg | strike:",
          option.strike,
          "| premium:",
          option.CE,
        );
        break;
      }
    }
    position._strangleAdjustedAt = Date.now();
    try {
      sendAlert(
        `🔄 STRANGLE CE ADJUST | ${position.index}\n` +
          `Reason: CE rose to ${money(cePremium)} (threshold ${money(position.basePremium * 1.15)})\n` +
          `New CE ${position.CE_sell?.strike} @ ${money(position.CE_sell?.premium)} | Net realized: ${signed(position.realizedProfitFromShifts || 0)}`,
      );
    } catch (e) {}
    return;
  }

  // Rule 1/3: PE up 50% — adjust CE
  if (pePremium >= position.basePremium * 1.15) {
    logger.log(
      "⚡ PE Adjustment | PE:",
      pePremium,
      "| basePremium:",
      position.basePremium,
      "| threshold:",
      (position.basePremium * 1.05).toFixed(2),
    );

    // ── save old CE leg as closed before replacing ──
    // ── PE rose — close PE leg, find new PE matching CE premium ──
    if (position.PE_sell && position.PE_sell.strike) {
      const exitPremium = pePremium;
      const realizedPnl =
        (position.PE_sell.premium - exitPremium) * (position.quantity || 0);
      if (!position.closedStrangleLegs) position.closedStrangleLegs = [];
      position.closedStrangleLegs.push({
        strike: position.PE_sell.strike,
        type: "PE",
        entryPremium: position.PE_sell.premium,
        exitPremium,
        pnl: Number(realizedPnl.toFixed(2)),
        openedAt: position.PE_sell.openedAt || null,
        closedAt: new Date().toISOString(),
      });
      logger.log(
        "📋 Closed PE leg | strike:",
        position.PE_sell.strike,
        "| entry:",
        position.PE_sell.premium,
        "| exit:",
        exitPremium,
        "| pnl:",
        realizedPnl.toFixed(2),
      );
    }

    position.basePremium = cePremium; // ← new PE leg matches CE premium, so basePremium = CE premium (new leg entry)
    position.history.push({
      type: "PE_ADJUST",
      message: "PE rose — closed PE, new PE shorted matching CE premium",
      time: new Date().toISOString(),
    });

    // find new PE strike matching current CE premium
    const target = cePremium;
    // ── guard: don't re-short same strike at same premium ──
    if (position.PE_sell?.premium === cePremium && position.PE_sell?.strike)
      return;
    for (let option of optionChain) {
      if (Math.abs(option.PE - target) <= tolerance) {
        position.PE_sell = {
          strike: option.strike,
          premium: option.PE,
          token: Number(option.PE_token),
          openedAt: new Date().toISOString(),
        };
        logger.log(
          "✅ New PE leg | strike:",
          option.strike,
          "| premium:",
          option.PE,
        );
        break;
      }
    }
    position._strangleAdjustedAt = Date.now();
    try {
      sendAlert(
        `🔄 STRANGLE PE ADJUST | ${position.index}\n` +
          `Reason: PE rose to ${money(pePremium)} (threshold ${money(position.basePremium * 1.15)})\n` +
          `New PE ${position.PE_sell?.strike} @ ${money(position.PE_sell?.premium)} | Net realized: ${signed(position.realizedProfitFromShifts || 0)}`,
      );
    } catch (e) {}
    return;
  }
}

module.exports = checkDebitSpread;
