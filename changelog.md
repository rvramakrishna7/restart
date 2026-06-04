

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