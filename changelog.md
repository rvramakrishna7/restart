# CHANGELOG — Restart Options Trading Engine
Last updated: 19 May 2026
Stack: Node.js + Express backend, React frontend, MongoDB Atlas, Zerodha Kite API

---

## WORKING & CONFIRMED ✅

### Infrastructure & Security
- All secrets (Zerodha API key/secret, MongoDB URI, JWT secret) moved out of source code into `.env`
- `config/env.js` created — single import point for all env vars, crashes with clear message if any missing
- `.env.example` created — template committed, actual `.env` gitignored
- `dotenv` added to `package.json` dependencies
- `config/constants.js` created — all strategy constants (lot sizes, tiers, thresholds) in one place

### Architecture — Strategy Router
- `engine/strategyRouter.js` created — routes each position to correct engine by `strategyType`
- `managers/positionManager.js` updated — calls `routeAdjustment()` instead of `checkAdjustments()` directly
- `engine/adjustmentEngine.js` kept as backward-compatibility shim (points to strategyRouter)
- `api/models/Position.js` — `strategyType` field added with enum validation
- Double-firing bug fixed — removed duplicate `registerListener` block from `strategyController.executeStrategy`

### File Structure Cleanup
- `strategy/` folder (dead code) — deleted
- `strategy.js` (root, orphan) — still exists, safe to delete manually
- `structure.txt` — gitignored
- `engine/positionManagerInstance.js` — moved to `managers/positionManagerInstance.js`
- All 4 import paths updated after move (server.js, tradingService, positionController, strategyController)
- `engine/strategies/debitSpread.js` — debit spread logic extracted here
- `engine/positionFactory.js` — position object builders moved here from deleted `strategy/strategySelector.js`
- `services/tradingService.js` import updated to use `engine/positionFactory`

---

## DEBIT SPREAD (DEBIT_SPREAD) ✅ PAPER TESTED — ALL RULES WORKING

### Entry
- Bull Call Spread (BULLISH) and Bear Put Spread (BEARISH) — paper mode working
- `entryPremium` now uses actual paper fill price (`buyAvgPrice`) not option chain price ✅
- `currentLegEntryPrice` also uses actual fill price ✅
- OTM tokens (100pt and 50pt) subscribed to WebSocket at entry for profit shift monitoring

### Loss Side (50% Rule)
- **LIVE threshold:** `entryPremium × 0.5` (change `0.9` back to `0.5` before going live)
- **TEST threshold:** `entryPremium × 0.9` (currently active)
- On trigger: buy leg closed, `closedBuyPrice` frozen, `buyQty = 0`
- Finds opposite leg matching **current live sell LTP** (`currentSellPrice || sellPremium`) ✅
- **Skip existing sell strike** when searching for opposite leg — prevents duplicate strike ✅
- `CE_sell.premium` and `PE_sell.premium` store live sell price at conversion time (not original entry) ✅
- `basePremium` set to current live market price of sell leg at conversion time ✅
- `openedAt` timestamp set on both CE_sell and PE_sell at conversion ✅
- Both legs persist correctly to MongoDB after schema fix ✅

### Profit Side Shifting (NIFTY)
- **LIVE 100pt shift:** `diff >= 65`, max 2 shifts (change `20` back to `65`)
- **LIVE 50pt shift:** `diff >= 35`, max 4 shifts (change `10` back to `35`)
- **TEST 100pt shift:** `diff >= 20` (currently active)
- **TEST 50pt shift:** `diff >= 10` (currently active)
- Spot price check — shift only fires when spot has crossed buy strike ✅
- Old buy leg pushed to `closedBuyLegs[]` with `closedAt` timestamp ✅
- New buy leg token subscribed, `buyAvgPrice`/`buySymbol`/`buyToken` all updated ✅
- `realizedProfitFromShifts` calculated and persisted correctly ✅
- Max 2 shifts (100pt) or 4 shifts (50pt) for NIFTY

### Profit Side Shifting (BANKNIFTY)
- 100pt shift only, max 2 shifts
- **LIVE:** `diff >= 65`, **TEST:** `diff >= 20`

### Strangle Loop (after loss conversion)
- Both decayed 25% below `basePremium` → monitor only, no adjustment
- CE rises 15% (test) / 50% (live) above `basePremium` → close CE, open new CE matching current PE premium
- PE rises 15% (test) / 50% (live) above `basePremium` → close PE, open new PE matching current CE premium
- `basePremium` updated to other leg's current premium after each adjustment ✅
- Closed strangle legs stored in `closedStrangleLegs[]` with `closedAt`, entry, exit, pnl ✅
- `openedAt` set on new CE/PE legs after each adjustment ✅
- Same-strike guard — won't re-short same strike at same premium ✅
- Re-entry lock (`_processing` flag) prevents duplicate adjustments within same tick ✅

### Risk Free Check
- If `realizedProfitFromShifts >= originalMaxLoss` → stop all monitoring ✅

### Max Loss Exit
- If `pnl <= -(maxLossPerLot × quantity)` → `forceExit = true` ✅

### UI (getPaperPositions)
- All legs built into `allLegs[]` array with `_ts` timestamps ✅
- Sorted chronologically by `_ts` before assigning `legOrder` — correct order 1,2,3,4,5 ✅
- Closed buy legs (profit shifts), active buy/sell legs, active strangle legs, closed strangle legs — all in correct order ✅
- Active CE strangle leg skipped if same strike as original sell leg ✅
- Duplicate old PE/closed strangle blocks removed ✅

### MongoDB Persistence
- All fields saved every tick: `basePremium`, `CE_sell`, `PE_sell`, `isStrangle`, `lossAdjusted`, `buySymbol`, `sellSymbol`, `closedBuyLegs`, `closedStrangleLegs`, `realizedProfitFromShifts`, `currentLegEntryPrice`, `closedBuyPrice`, `closedSellPrice` ✅
- All fields restored on `loadPositionsFromDB` ✅

### Position Schema Fixes (api/models/Position.js)
These fields were missing from schema causing MongoDB to silently drop them — now added:
- `closedBuyLegs: [Mixed]` ✅
- `closedBuyPrice: Number` ✅
- `closedSellPrice: Number` ✅
- `buyAvgPrice: Number` ✅
- `sellAvgPrice: Number` ✅
- All Iron Fly fields (`if_ceSell`, `if_peSell`, `if_ceBuy`, `if_peBuy`, `if_bwLegs`, etc.) ✅

---

## INTRADAY STRADDLE (INTRADAY_STRADDLE) ✅ FULLY PAPER TESTED — ALL RULES WORKING (02 Jun 2026)

### Cycle Logic (straddle ↔ strangle) — CONFIRMED via 12-adjustment live test
- Uses spot price from tickMap (256265 NIFTY / 260105 BNF) for move calc — not future token
- Branch routing by strike equality: ceLeg.strike === peLeg.strike = straddle, else strangle
  - Straddle + threshold move → expand to strangle (close losing leg, open new leg away from market)
  - Strangle + threshold move → collapse to straddle (close profit leg, open new leg at OTHER open leg's strike)
- Same-strike guard in BOTH straddle→strangle branches: if ceil/floor lands on existing strike, step ±100
  - UP/CE: if newStrike === ceLeg.strike → newStrike += 100
  - DOWN/PE: if newStrike === peLeg.strike → newStrike -= 100
- 3-second cooldown (_straddleAdjustedAt) prevents rapid double-fire between ticks
- _processing lock prevents same-tick re-entry
- ref price (st_refFuturePrice) updated after each adjustment
- Throttled 30-sec log shows spot/ref/move/threshold/legs/pnl

### Max Loss Exit — FIXED
- MAX LOSS check sets forceExit=true
- positionManager.js updatePremium: forceExit caught at top of loop → closes position in DB + memory
- NIFTY: 25pts × lots × lotSize. Trigger is engine MTM, NOT payoff chart display value

### UI
- SELL → BUY badge on closed legs (strategyController getPaperPositions: leg.closed ? "SELL → BUY" : "SELL")

---

## INTRADAY STRANGLE (INTRADAY_STRANGLE) ⚠️ PAPER TESTING IN PROGRESS (02 Jun 2026)

### Rules
- Entry: Sell OTM CE + PE matched premium. minDist NIFTY 200 / BNF 600
- CASE 1 (rise): leg rises RISE% → close that leg, open new same-type leg matching OTHER leg's LTP
- CASE 2 (decay): leg decays DECAY% → book that profit leg, open new same-type leg matching other leg's price
- findClosestByPremium with boundary fallback for strike selection

### Fixes applied
- _processing lock ✅
- 3-second cooldown (_strangleAdjustedAt) set in all 4 adjustment blocks ✅
- First-tick guard (waits for currentPrice on both legs) ✅
- Throttled 30-sec log with rise@/decay@ trigger levels shown ✅

### TEST MODE — RESTORE BEFORE LIVE ⚠️
In engine/strategies/intradayStrangle.js:
- RISE: change 0.15 (test) → STRANGLE.RISE_TRIGGER_PCT (0.50 live)
- DECAY: change 0.10 (test) → STRANGLE.DECAY_TRIGGER_PCT (0.40 live)

### NOT YET CONFIRMED
- Full CASE1/CASE2 cycle in live paper test — testing now
- Strangle has NO max loss check (disabled) — monitor MTM manually, define before live

---

## IRON FLY (IRON_FLY) ✅ ENGINE + UI BUILT
- 4 legs: sell ATM CE+PE, buy OTM CE+PE wings
- Wing distance: 20% of combined premium rounded to nearest 100
- Entry rules: NIFTY weekly >= 500, monthly >= 900; BANKNIFTY monthly only >= 1200
- Adjustment Rule 1: market hits BE → exit buy wing → buy new at BE strike (once per side)
- Adjustment Rule 2: 20% consecutive chain shift on opposite wing inward toward ATM short
- Adjustment Rule 3: broken wing fly creation when Rule 1 fires
- Max loss: ₹2000 per lot realized → exit all
- All `if_` fields persisted to schema and restored on restart ✅
- Iron fly positions excluded from debit spread filter in `getPaperPositions` and `exitAll` ✅

---

## WEBSOCKET — RECONNECT FIX ✅ (applied 19 May 2026)
- **Problem:** When internet dropped and came back, WS reconnected but only subscribed spot tokens `[256265, 260105]` — position tokens lost, monitoring stopped completely
- **Fix in `services/websocketService.js`:**
  - `disconnect` handler: no longer clears `currentTokens` — tokens survive disconnect for reconnect use
  - `connect` handler: merges `currentTokens` (saved from before disconnect) with startup tokens on reconnect — all position tokens automatically resubscribed
  - `global.wsStarted = true` set in connect handler ✅
- **Result:** Internet drop → internet back → monitoring resumes automatically, no server restart needed ✅

---

## TERMINAL LOGGING — CLEAN & NON-FLOODING ✅
- Monitoring logs throttled to every 30 seconds — no flooding ✅
- Event logs fire exactly once per event (entry, loss trigger, shift, strangle conversion, adjustment) ✅
- Restore log on restart prints all critical fields in one line ✅
- `CHECKING PROFIT SHIFT` and `OTM100 price` logs fire every tick when spot is ITM — may get noisy, throttle if needed

---

## TEST MODE vs LIVE MODE — CHANGES NEEDED BEFORE GOING LIVE ⚠️
In `engine/strategies/debitSpread.js`:
- Loss threshold: change `0.9` → `0.5`
- 100pt shift diff: change `>= 20` → `>= 65`
- 50pt shift diff: change `>= 10` → `>= 35`
- Strangle adjustment: change `1.15` → `1.5`

---

## KNOWN ISSUES / TO WATCH

1. **Server restart during market hours** — if server restarts, `currentSellPrice` is not restored (live tick value). Loss side falls back to `sellPremium` (original entry). Safe if loss side has already fired. Risk only in window between entry and first loss adjustment.
2. **Internet drop + MongoDB failure simultaneously** — if MongoDB save fails during network drop, position may be in bad state on restart. Mitigation: don't restart server after internet comes back; let it reconnect automatically.
3. `CE_sell.openedAt` and `PE_sell.openedAt` — now set correctly on conversion and after each adjustment ✅
4. `strategy.js` (root level) — old orphan file, safe to delete manually
5. Duplicate old files safe to delete: `StrategySelection_NEW.jsx`, `StrategySelection_NEW2.jsx`, `ExecutionPanel_FIXED.jsx`, `ExecutionPanel_NEW.jsx`, `positionManager_COMPLETE.js`
6. Token subscription has string/number duplicates — harmless
7. Strangle max loss (INTRADAY_STRANGLE) is null/disabled — needs defining
8. Calendar Spread and Iron Condor — not started, marked Coming Soon

---

## HOW TO WORK ON THIS PROJECT

**Start every session:**
1. Run: `tar -czf project_updated.tar.gz --exclude="node_modules" --exclude=".git" .`
2. Upload the tar.gz
3. State ONE specific goal
4. Share this CHANGELOG.md

**Rules for AI:**
- Read every file that will be touched BEFORE writing any code
- Ask all questions before writing
- Make minimum surgical changes only
- Return complete replacement files (never partial snippets)
- Never rewrite sections that don't need changing
- Test logic against this changelog before giving code
- Do NOT say wrong things are right
- Evaluate terminal logs strictly against the rules defined here

## PAYOFF ENGINE FIXES ✅ (applied 20 May 2026)
- Closed legs skipped from chart loop — only open legs contribute to payoff curve ✅
- Realized P&L from all closed legs added to maxProfit and maxLoss as fixed offset ✅
- Result: maxProfit now correctly shows open leg premium minus realized losses ✅
- Frontend WS tick handler fixed — SELL legs PnL calculated correctly (entry - ltp) not (ltp - entry) ✅

## TOKEN / ACCESS TOKEN FIXES ✅ (applied 20 May 2026)
- Option chain fetch now uses fresh user token from DB not stale position.token ✅
- Broker reconnect callback now wires positionManager.handleTicks to new WS connection ✅
- CE_sell and PE_sell currentPrice now updated from WS ticks for debit spread strangle positions ✅
- Strangle monitoring log now shows live CE/PE ltps vs threshold every 30 seconds ✅

## KNOWN ISSUES / TO WATCH — UPDATED
- WS reconnect after internet drop: tokens resubscribed correctly but engine ticks may stop due to double connect event firing — under investigation. Workaround: wait 60 seconds after internet returns before restarting server
- Zerodha access token expires daily at midnight — must reconnect broker before starting server each morning
- position.token field in DB stores yesterday's access token — option chain now uses fresh user token instead ✅

## NOT YET TESTED
- Profit side shift (100pt and 50pt) — pending test
- Risk free check after shifts covers max loss — pending test  
- BEAR_PUT strangle CE side adjustment — pending test (PE side confirmed working ✅)

## FIXES APPLIED 21 MAY 2026

### debitSpread.js
- 10 second cooldown after strangle adjustment — prevents double firing from stale option chain data ✅
- `position._strangleAdjustedAt = Date.now()` set after both CE and PE adjustments ✅

### positionManager.js
- Missing buy/sell price update restored in handleTicks — `if (token === pos.buyToken) pos.currentBuyPrice = price` — was accidentally deleted, caused engine to stop after new position created ✅
- Force resubscribe after 3 seconds on new position add ✅

### api/routes/ broker callback
- `disconnectWebSocket()` called before `initWebSocket` on broker reconnect — ensures old expired ticker is cleared before new one created ✅
- `mgr.updateTokens()` called after 3 seconds on broker reconnect — resubscribes all position tokens ✅

## MORNING CHECKLIST (EVERY DAY)
1. Connect broker first (fresh Zerodha token) BEFORE starting server
2. Start server
3. Verify engine ticks flowing in terminal
4. Execute trade

## COMPLETE STATUS — 21 MAY 2026

### DEBIT SPREAD — CONFIRMED WORKING ✅
- Entry (Bull Call + Bear Put) ✅
- Loss side conversion to strangle ✅
- Strangle CE adjustment (multiple) ✅
- Strangle PE adjustment (multiple) ✅
- Strangle cooldown after adjustment ✅
- DB persistence and restore on restart ✅
- Live CE/PE ltp in strangle monitoring log ✅
- Chronological leg ordering in UI ✅
- SELL→BUY badge on closed strangle legs ✅
- Closed buy leg shows correct quantity ✅
- Payoff engine shows correct max profit/loss ✅
- Option chain uses fresh user token ✅

### DEBIT SPREAD — NOT YET TESTED ❌
- Profit side 100pt shift — need NIFTY to move significantly ITM
- Profit side 50pt shift — same
- Risk free check — triggers after shifts cover max loss
- BEAR_PUT strangle CE side (PE side confirmed ✅)

### INTRADAY STRADDLE ✅ — engine + UI built,NOT paper tested yet
### INTRADAY STRANGLE ✅ — engine + UI built,NOT paper tested yet
### IRON FLY ✅ — engine + UI built, NOT paper tested yet

## CRITICAL RULES FOR AI IN NEW CHAT
- NEVER touch working code without seeing the file first
- ALWAYS ask for the file before suggesting any change
- NEVER guess which file to change — always confirm
- Evaluate terminal logs strictly — do not say wrong things are right
- Make minimum surgical changes only — one or two lines at a time
- NEVER rewrite sections that don't need changing
- When in doubt ask — do not assume
- Do NOT go in loops on same fix — if something doesn't work after 2 attempts, stop and rethink
- Market is open 9:15 AM to 3:30 PM IST — do not suggest restarts during market hours unless absolutely necessary
- Test mode thresholds currently active — change to live before going live

## FIXES APPLIED 02 JUNE 2026

### intradayStraddle.js
- Spot-based move calc (positionManager passes tickMap spot, not st_currentFuturePrice) ✅
- isStraddle strike-equality branch routing (replaced flawed ceIsITM/peIsITM ITM check) ✅
- Same-strike guard in both straddle→strangle branches (±100 step) ✅
- 3-second cooldown _straddleAdjustedAt ✅
- _processing lock + throttled log ✅

### intradayStrangle.js
- _processing lock + throttled log with trigger levels ✅
- 3-second cooldown _strangleAdjustedAt in all 4 blocks ✅
- First-tick guard ✅
- TEST mode RISE 0.15 / DECAY 0.10 active ⚠️

### positionManager.js
- st_futureToken kept as spot token; straddle/strangle move uses live tickMap spot ✅
- forceExit handler at top of updatePremium loop — auto-closes straddle on max loss ✅
- Removed redundant second forceExit/exitPosition block ✅

# Changelog

All notable changes to this project are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]
### Added
- Calendar spread strategy (in progress).

## [1.0.0]
### Added
- Multi-strategy options engine: debit spread, intraday straddle,
  intraday strangle, and iron fly.
- Real-time position monitoring over a persistent broker WebSocket,
  with automatic reconnection and token resubscription.
- Rule-based adjustment engine evaluated per tick (strike shifts,
  strangle conversion, hedge management).
- Crash-safe state: open positions persist to MongoDB and restore on restart.
- Paper and live trading modes through a single execution path.
- Analytics dashboard: equity curve, drawdown, daily PnL, per-strategy
  breakdown, and trade history with strategy filtering.
- JWT authentication with per-user data scoping.
- API hardening: rate limiting and security headers (helmet).

### Security
- All credentials moved to environment variables.
- Owner-gated live broker connection.

### Tooling
- Jest test suite, ESLint, and Prettier with CI-ready scripts.

### INTRADAY STRADDLE ✅ — FULLY PAPER TESTED, all rules confirmed (02 Jun)
### INTRADAY STRANGLE ⚠️ — testing in progress (02 Jun)
### IRON FLY ✅ — engine + UI built, NOT paper tested yet (next after strangle)