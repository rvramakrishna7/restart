# Restart Options Trading Engine

An automated options trading engine for NIFTY and BANKNIFTY index options. It
executes multi-leg option strategies, monitors them tick-by-tick over a live
broker WebSocket, and runs rule-based adjustments (strike shifts, strangle
conversions, hedge management) without manual intervention. It supports both
paper and live modes and persists open positions so state survives a restart.


## Tech stack

- **Backend:** Node.js, Express 5
- **Frontend:** React (Create React App)
- **Database:** MongoDB Atlas (Mongoose)
- **Broker / market data:** Zerodha Kite Connect (REST + KiteTicker WebSocket)
- **Realtime to browser:** `ws` WebSocket server
- **Auth:** JWT, bcrypt

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

## Environment variables

Backend (`.env`): `ZERODHA_API_KEY`, `ZERODHA_API_SECRET`, `MONGO_URI`,
`JWT_SECRET`, `PORT`, `NODE_ENV`, `FRONTEND_URL`.

Frontend (`client/.env`): `REACT_APP_API_URL`.

## Deployment

- **Backend:** Render (or any Node host). Set the env vars above in the host's
  dashboard. Health check: `GET /`.
- **Frontend:** Vercel. Set `REACT_APP_API_URL` to the deployed backend URL.

After deploy, set the broker OAuth redirect URL in the Kite developer console to
`<backend-url>/api/user/broker/zerodha/callback`.

## Engineering highlights
- Real-time tick processing over a persistent broker WebSocket with reconnect + token resubscription.
- Crash-safe state: open positions persist to MongoDB and restore on restart.
- Rule-based adjustment engine (strike shifts, strangle conversion) running per-tick.
- Paper/live mode parity through a single execution path.
- Secured API: JWT auth, per-user data scoping, rate-limiting, helmet.
- Tested (Jest) and linted (ESLint + Prettier) with CI-ready scripts.

## Testing & quality
npm test      # Jest unit tests
npm run lint  # ESLint
