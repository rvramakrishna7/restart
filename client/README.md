# Restart Options Trading Engine

An automated options trading engine for NIFTY and BANKNIFTY index options. It
executes multi-leg option strategies, monitors them tick-by-tick over a live
broker WebSocket, and runs rule-based adjustments (strike shifts, strangle
conversions, hedge management) without manual intervention. It supports both
paper and live modes and persists open positions so state survives a restart.

<!-- Add after deploying: -->
<!-- **Live demo:** https://your-app.vercel.app -->
<!-- **Demo video:** https://your-demo-link -->

> **Note:** Core strategy and decision logic in `engine/` and `managers/` is
> proprietary.

## Tech stack

- **Backend:** Node.js, Express 5
- **Frontend:** React (Create React App)
- **Database:** MongoDB Atlas (Mongoose)
- **Broker / market data:** Zerodha Kite Connect (REST + KiteTicker WebSocket)
- **Realtime to browser:** `ws` WebSocket server
- **Auth & security:** JWT, bcrypt, helmet, rate limiting

## Engineering highlights

- Real-time tick processing over a persistent broker WebSocket, with reconnect
  and automatic token resubscription.
- Crash-safe state: open positions persist to MongoDB and are restored on
  restart, so a server restart never loses live positions.
- Rule-based adjustment engine (strike shifts, strangle conversion, hedge
  management) evaluated on every tick.
- Paper and live trading share a single execution path for behavioural parity.
- Secured API: JWT auth, per-user data scoping, rate limiting, and helmet.
- Tested with Jest and linted with ESLint + Prettier (CI-ready scripts).

## Architecture

```
Browser (React)
   │  REST (axios + JWT)        WebSocket (live ticks)
   ▼                                  ▼
Express API ── controllers ── services ──► Zerodha Kite (orders, quotes)
   │                              │
   │                              ├── websocketService  (KiteTicker feed)
   │                              └── strategyControllerBridge (shared tick map)
   ▼
engine/ (strategy + adjustment logic)  ◄── positionManager (per-tick monitoring)
   │
   ▼
MongoDB (positions + trades, restored on restart)
```

- `engine/strategyRouter.js` dispatches each open position to the correct
  strategy module by `strategyType`.
- `managers/positionManager.js` holds live positions in memory, processes every
  tick, and persists changes to MongoDB.
- `services/strategyControllerBridge.js` shares the latest tick map between the
  WebSocket feed and the API layer without creating a circular dependency.

## Strategies

Debit spread (with loss-side strangle conversion and profit-side strike shifts),
intraday straddle, intraday strangle, iron fly, and calendar spread.

## Getting started

### Backend

```bash
cp .env.example .env      # then fill in real values
npm install
npm run dev               # nodemon, or: npm start
```

### Frontend

```bash
cd client
cp .env.example .env      # set REACT_APP_API_URL
npm install
npm start
```

## Testing & quality

```bash
npm test          # Jest unit tests
npm run lint      # ESLint
npm run format    # Prettier
```

## Environment variables

Backend (`.env`): `ZERODHA_API_KEY`, `ZERODHA_API_SECRET`, `MONGO_URI`,
`JWT_SECRET`, `PORT`, `NODE_ENV`, `FRONTEND_URL`, `OWNER_EMAIL`.

Frontend (`client/.env`): `REACT_APP_API_URL`, `REACT_APP_OWNER_EMAIL`.

## Deployment

- **Backend:** Render (or any Node host). Set the env vars above in the host's
  dashboard. Health check: `GET /`.
- **Frontend:** Vercel, with root directory `client`. Set `REACT_APP_API_URL`
  to the deployed backend URL.

After deploy, set the broker OAuth redirect URL in the Kite developer console to
`<backend-url>/api/user/broker/zerodha/callback`.