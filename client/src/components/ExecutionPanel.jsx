import { useEffect, useState, useRef } from "react";
import axios from "../api/axios";
import toast from "react-hot-toast";
import PayoffChart from "./PayoffChart";
import "../styles.css";

// ── singleton WS — only ONE connection ever opened ──
let _sharedWs = null;
let _wsListeners = [];

function getSharedWs() {
  if (_sharedWs && _sharedWs.readyState <= 1) return _sharedWs;

  const wsUrl = (process.env.REACT_APP_API_URL || "http://localhost:5000")
    .replace("https://", "wss://")
    .replace("http://", "ws://");

  try {
    _sharedWs = new WebSocket(wsUrl);
    _sharedWs.onopen = () => console.log("📡 Frontend WS connected");
    _sharedWs.onmessage = (e) => {
      try {
        const ticks = JSON.parse(e.data);
        if (Array.isArray(ticks)) _wsListeners.forEach((fn) => fn(ticks));
      } catch (_) {}
    };
    _sharedWs.onerror = () => console.log("⚠️ WS error — polling only");
    _sharedWs.onclose = () => {
      console.log("WS closed");
      _sharedWs = null;
    };
  } catch (err) {
    console.log("WS init error:", err.message);
  }

  return _sharedWs;
}

const ExecutionPanel = ({ triggerRefresh, strategyType }) => {
  const [open, setOpen] = useState(false);
  const [positions, setPositions] = useState([]);
  const [hasPositions, setHasPositions] = useState(false); // any open positions?
  const [loading, setLoading] = useState(false);
  const [marketClosed, setMarketClosed] = useState(false);
  const [payoffData, setPayoffData] = useState([]);
  const [payoffMetrics, setPayoffMetrics] = useState({});
  const ltpMapRef = useRef({});
  const [events, setEvents] = useState([]);
  const seenEventsRef = useRef(new Set()); // tracks events already toasted

  const totalPnl = positions.reduce((sum, p) => sum + Number(p.pnl || 0), 0);
  const totalPoints = positions.reduce(
    (sum, p) => sum + Number(p.points || 0),
    0,
  );

  // =====================
  // FETCH POSITIONS
  // =====================
  const fetchPositions = async () => {
    try {
      const mode = localStorage.getItem("mode") || "paper";
      const url =
        mode === "paper"
          ? `/api/strategy/paper-positions${strategyType ? `?strategyType=${strategyType}` : ""}`
          : "/api/strategy/real-positions";

      const res = await axios.get(url);
      const data = res.data?.data || [];

      setPositions(data);

      // any leg that is OPEN = positions exist
      const anyOpen = data.some((p) => p.status === "OPEN");
      setHasPositions(anyOpen);

      // auto-close dropdown if nothing is open
      if (!anyOpen) {
        setOpen(false);
      }

      if (data.length > 0) {
        try {
          const payoffRes = await axios.post("/api/strategy/payoff", {
            positions: data,
          });
          setPayoffData(payoffRes.data?.data?.chart || []);
          setPayoffMetrics(payoffRes.data?.data?.metrics || {});
        } catch (_) {}
      } else {
        setPayoffData([]);
        setPayoffMetrics({});
      }
    } catch (err) {
      // server down or network error — show empty state gracefully
      if (err?.code === "ERR_NETWORK" || err?.message === "Network Error") {
        setPositions([]);
        setHasPositions(false);
        return; // silent — don't crash UI
      }
      console.log("FETCH ERROR:", err.message);
      setPositions([]);
      setHasPositions(false);
    }
  };

  // =====================
  // FETCH ENGINE EVENTS → toast new ones, feed timeline
  // =====================
  const fetchEvents = async () => {
    try {
      const res = await axios.get("/api/strategy/events");
      const data = res.data?.data || [];
      setEvents(data);

      // toast any event not shown yet (skip first load to avoid a flood)
      if (seenEventsRef.current.size === 0) {
        data.forEach((e) => seenEventsRef.current.add(`${e.time}-${e.type}`));
        return;
      }
      data
        .slice()
        .reverse()
        .forEach((e) => {
          const key = `${e.time}-${e.type}`;
          if (!seenEventsRef.current.has(key)) {
            seenEventsRef.current.add(key);
            const isClose = e.type === "MAX_LOSS" || e.type === "TARGET";
            toast(`${isClose ? "🚪" : "🔄"} ${e.message}`, {
              icon: isClose ? "⚠️" : "🔄",
              duration: 5000,
            });
          }
        });
    } catch (_) {
      // silent — events are non-critical
    }
  };

  // =====================
  // INIT — poll + WS
  // =====================
  useEffect(() => {
    fetchPositions();
    fetchEvents();
    const interval = setInterval(() => {
      fetchPositions();
      fetchEvents();
    }, 5000);

    const tickHandler = (ticks) => {
      ticks.forEach((t) => {
        if (t.instrument_token && t.last_price) {
          ltpMapRef.current[t.instrument_token] = t.last_price;
        }
      });

      setPositions((prev) =>
        prev.map((p) => {
          if (p.status === "CLOSED") return p;
          const livePrice = ltpMapRef.current[p.token];
          if (!livePrice) return p;
          const pnl =
            Number(p.qty) < 0
              ? (Number(p.avgPrice) - livePrice) * Math.abs(Number(p.qty))
              : (livePrice - Number(p.avgPrice)) * Number(p.qty);
          return {
            ...p,
            ltp: Number(livePrice.toFixed(2)),
            pnl: Number(pnl.toFixed(2)),
          };
        }),
      );
    };

    _wsListeners.push(tickHandler);
    getSharedWs();

    return () => {
      clearInterval(interval);
      _wsListeners = _wsListeners.filter((fn) => fn !== tickHandler);
    };
  }, []);

  // =====================
  // BUTTON CLICK
  // — no positions  Execute (calls parent's executeStrategy)
  // — positions exist  toggle dropdown
  // =====================
  const handleButtonClick = async () => {
    if (hasPositions) {
      // just toggle the dropdown
      setOpen((prev) => !prev);
      return;
    }

    // no positions  execute
    if (!triggerRefresh) return;
    try {
      setLoading(true);
      const res = await triggerRefresh();
      if (res?.message === "Market closed") setMarketClosed(true);
      else setMarketClosed(false);
      await fetchPositions();
      setOpen(true);
    } catch (err) {
      console.log("Execution error:", err.message);
    } finally {
      setLoading(false);
    }
  };

  // =====================
  // EXIT SINGLE LEG
  // =====================
  const exitSingle = async (symbol, qty) => {
    try {
      const mode = localStorage.getItem("mode") || "paper";
      await axios.post(`/api/strategy/exit-single?mode=${mode}`, {
        symbol,
        qty,
      });

      // optimistic update
      setPositions((prev) =>
        prev.map((p) =>
          p.symbol === symbol ? { ...p, status: "CLOSED", qty: 0 } : p,
        ),
      );

      setTimeout(fetchPositions, 800);
    } catch (err) {
      console.log("Exit error:", err.message);
    }
  };

  // =====================
  // FORMAT TICKER
  // =====================
  const formatTicker = (symbol) => {
    if (!symbol) return "";

    // ISO format: NIFTY2026-05-12 23900 CE
    const iso = symbol.match(/^([A-Z]+)(\d{4})-(\d{2})-(\d{2})(\d+)(CE|PE)$/);
    if (iso) {
      const months = {
        "01": "JAN",
        "02": "FEB",
        "03": "MAR",
        "04": "APR",
        "05": "MAY",
        "06": "JUN",
        "07": "JUL",
        "08": "AUG",
        "09": "SEP",
        10: "OCT",
        11: "NOV",
        12: "DEC",
      };
      return `${iso[1]} ${iso[4]} ${months[iso[3]]} ${iso[5]} ${iso[6]}`;
    }

    // monthly: NIFTY26MAY23900CE
    const monthly = symbol.match(/^([A-Z]+)(\d{2})([A-Z]{3})(\d+)(CE|PE)$/);
    if (monthly)
      return `${monthly[1]} ${monthly[2]} ${monthly[3]} ${monthly[4]} ${monthly[5]}`;

    // weekly: NIFTY2651223900CE
    const weekly = symbol.match(/^([A-Z]+)(\d{2})(\d)(\d{2})(\d+)(CE|PE)$/);
    if (weekly) {
      const months = {
        1: "JAN",
        2: "FEB",
        3: "MAR",
        4: "APR",
        5: "MAY",
        6: "JUN",
        7: "JUL",
        8: "AUG",
        9: "SEP",
        O: "OCT",
        N: "NOV",
        D: "DEC",
      };
      return `${weekly[1]} ${weekly[4]} ${months[weekly[3]]} ${weekly[5]} ${weekly[6]}`;
    }

    return symbol;
  };

  const formatExpiry = (expiry) => {
    if (!expiry) return "";
    return new Date(expiry)
      .toLocaleDateString("en-IN", { day: "2-digit", month: "short" })
      .toUpperCase();
  };
  // ── format timestamp to IST 12-hour AM/PM ──
  const formatTime = (ts) => {
    if (!ts) return "—";
    return new Date(ts).toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
      timeZone: "Asia/Kolkata",
    });
  };

  // determine strategy from symbol — CE = Bull Call, PE = Bear Put
  const firstSymbol = positions[0]?.symbol || "";
  const isBullCall = firstSymbol.includes("CE");
  const strategyLabel =
    positions.length > 0
      ? strategyType === "INTRADAY_STRADDLE"
        ? `Straddle | ${formatExpiry(positions[0]?.expiry)} EXPIRY`
        : strategyType === "INTRADAY_STRANGLE"
          ? `Strangle | ${formatExpiry(positions[0]?.expiry)} EXPIRY`
          : `${isBullCall ? "Bull Call Spread" : "Bear Put Spread"} | ${formatExpiry(positions[0]?.expiry)} EXPIRY`
      : "";

  // ── badge: use p.type from backend (BUY, SELL, BUY  SELL, SELL  BUY) ──
  const getTradeLabel = (p) => {
    if (p.type) return p.type; // backend always sends this now
    return p.qty > 0 ? "Buy" : "Sell"; // fallback
  };

  const getBadgeClass = (p) => {
    const t = p.type || "";
    // BUY  SELL or plain BUY = buy badge (green)
    if (t.startsWith("BUY") || p.qty > 0) return "badge-buy";
    return "badge-sell";
  };

  return (
    <>
      {/* ── BUTTON — lives inside strategy-row via execute-inline ── */}
      <div className="execute-inline">
        {hasPositions && !open && (
          <span className={`exec-mtm ${totalPnl >= 0 ? "profit" : "loss"}`}>
            <span className="exec-mtm-label">MTM</span> ₹{totalPnl.toFixed(2)}
          </span>
        )}
        <button
          className="primary-btn"
          onClick={handleButtonClick}
          disabled={loading}
        >
          {loading
            ? "Processing..."
            : hasPositions
              ? open
                ? "Open Positions ▲"
                : "Open Positions ▼"
              : "Execute ▶"}
        </button>
      </div>

      {/* ── DROPDOWN — full-width below strategy-row ── */}
      <div className={`execution-wrapper ${open ? "open" : ""}`}>
        {open && (
          <div className="execution-table">
            {marketClosed && (
              <div className="market-closed">Market is closed</div>
            )}

            {/* header row: strategy label | MTM | Exit All */}
            {positions.length > 0 && (
              <div className="execution-actions">
                <div className="strategy-summary">{strategyLabel}</div>

                <div className="right-actions">
                  <div
                    className={`spread-total-pnl ${totalPnl >= 0 ? "profit" : "loss"}`}
                  >
                    <span className="mtm-label">MTM :&nbsp;</span>₹{" "}
                    {totalPnl.toFixed(2)}
                  </div>

                  <button
                    className="exit-all-btn"
                    onClick={async () => {
                      try {
                        const mode = localStorage.getItem("mode") || "paper";
                        await axios.post(
                          `/api/strategy/exit-all?mode=${mode}${strategyType ? `&strategyType=${strategyType}` : ""}`,
                        );
                        await fetchPositions();
                      } catch (err) {
                        console.log("Exit all error:", err.message);
                      }
                    }}
                  >
                    Exit All Positions
                  </button>
                </div>
              </div>
            )}

            {positions.length === 0 ? (
              <div className="no-trade">No active positions</div>
            ) : (
              <table className="position-table">
                <thead>
                  <tr>
                    <th>TICKER</th>
                    <th>POINTS</th>
                    <th>TRADE</th>
                    <th>LOTS</th>
                    <th>QTY</th>
                    <th>ENTRY</th>
                    <th>LTP</th>
                    <th>P&amp;L</th>
                    <th>ENTERED</th>
                    <th>EXITED</th>
                    <th>STATUS</th>
                    <th>ACTION</th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map((p, i) => (
                    <tr key={i}>
                      <td data-label="Ticker">
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "6px",
                          }}
                        >
                          {p.legOrder && (
                            <span
                              style={{
                                background: "#e8f0fe",
                                color: "#2563eb",
                                fontSize: "10px",
                                fontWeight: "700",
                                padding: "1px 5px",
                                borderRadius: "4px",
                                minWidth: "20px",
                                textAlign: "center",
                              }}
                            >
                              {p.legOrder}
                            </span>
                          )}
                          {formatTicker(p.symbol || "")}
                        </span>
                      </td>
                      <td
                        data-label="Points"
                        className={Number(p.points) >= 0 ? "profit" : "loss"}
                      >
                        {p.points != null
                          ? `${Number(p.points) >= 0 ? "+" : ""}${Number(p.points).toFixed(2)}`
                          : "—"}
                      </td>
                      <td data-label="Trade">
                        {/* ✅ FIX: use p.type from backend, NOT p.qty sign */}
                        <span className={getBadgeClass(p)}>
                          {getTradeLabel(p)}
                        </span>
                      </td>
                      <td data-label="Lots">{p.lots}</td>
                      <td data-label="Qty">{Math.abs(p.qty)}</td>
                      <td data-label="Entry">
                        {Number(p.avgPrice || 0).toFixed(2)}
                      </td>
                      <td data-label="LTP">{Number(p.ltp || 0).toFixed(2)}</td>
                      <td
                        data-label="P&L"
                        className={p.pnl >= 0 ? "profit" : "loss"}
                      >
                        ₹ {Number(p.pnl || 0).toFixed(2)}
                      </td>
                      <td
                        data-label="Entered"
                        style={{ fontSize: "12px", whiteSpace: "nowrap" }}
                      >
                        {formatTime(p.openedAt)}
                      </td>
                      <td
                        data-label="Exited"
                        style={{ fontSize: "12px", whiteSpace: "nowrap" }}
                      >
                        {formatTime(p.closedAt)}
                      </td>
                      <td data-label="Status">
                        <span
                          className={
                            p.status === "OPEN"
                              ? "active-status"
                              : "closed-status"
                          }
                        >
                          {p.status}
                        </span>
                      </td>
                      <td data-label="Action">
                        {p.status === "OPEN" && (
                          <button
                            className="exit-btn"
                            onClick={() =>
                              exitSingle(p.symbol, Math.abs(p.qty))
                            }
                          >
                            Exit
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  <tr
                    className="total-row"
                    style={{ borderTop: "2px solid #e2e8f0", fontWeight: 700 }}
                  >
                    <td
                      data-label=""
                      style={{ textAlign: "left", paddingLeft: "16px" }}
                    >
                      TOTAL
                    </td>
                    <td
                      data-label="Total Points"
                      className={totalPoints >= 0 ? "profit" : "loss"}
                    >
                      {totalPoints >= 0 ? "+" : ""}
                      {totalPoints.toFixed(2)}
                    </td>
                    <td colSpan="10"></td>
                  </tr>
                </tbody>
              </table>
            )}

            {positions.length > 0 && (
              <PayoffChart
                data={payoffData}
                metrics={payoffMetrics}
                positions={positions}
              />
            )}
            {events.filter((e) => e.strategyType === strategyType).length >
              0 && (
              <div className="activity-feed">
                <div className="activity-title">Activity</div>
                {events
                  .filter((e) => e.strategyType === strategyType)
                  .slice(0, 8)
                  .map((e, i) => (
                    <div key={i} className="activity-row">
                      <span className="activity-time">
                        {formatTime(e.time)}
                      </span>
                      <span className="activity-msg">
                        {e.type === "MAX_LOSS" || e.type === "TARGET"
                          ? "🚪"
                          : "🔄"}{" "}
                        {e.message}
                      </span>
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
};

export default ExecutionPanel;
