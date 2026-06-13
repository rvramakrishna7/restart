import React, { useEffect, useState } from "react";
import axios from "../api/axios";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts";
import ModeToggle from "../components/ModeToggle";

// Friendly labels for the strategy codes stored on trades.
const STRATEGY_LABELS = {
  BULL_CALL: "Bull Call Spread",
  BEAR_PUT: "Bear Put Spread",
  DEBIT_SPREAD: "Debit Spread",
  INTRADAY_STRADDLE: "Intraday Straddle",
  INTRADAY_STRANGLE: "Intraday Strangle",
  IRON_FLY: "Iron Fly",
  CALENDAR_SPREAD: "Calendar Spread",
};

// Always offered in the dropdown, even before any trades exist.
const KNOWN_STRATEGIES = [
  "BULL_CALL",
  "BEAR_PUT",
  "INTRADAY_STRADDLE",
  "INTRADAY_STRANGLE",
  "IRON_FLY",
  "CALENDAR_SPREAD",
];

const prettyStrategy = (key) => STRATEGY_LABELS[key] || key;

export default function Analytics() {
  const [summary, setSummary] = useState({});
  const [history, setHistory] = useState([]);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [dailyPnl, setDailyPnl] = useState([]);
  const [strategyData, setStrategyData] = useState({});
  const [allStrategies, setAllStrategies] = useState([]);
  const [strategy, setStrategy] = useState("all");
  const [expanded, setExpanded] = useState(null);
  const [mode, setMode] = useState("paper");

  const [hasApplied, setHasApplied] = useState(false);

  const fetchData = async () => {
    try {
      let query = `from=${fromDate}&to=${toDate}&mode=${mode}`;
      if (strategy !== "all") query += `&strategy=${strategy}`;

      const strat = await axios.get(`/api/analytics/strategy?${query}`);
      setStrategyData(strat.data.data || {});

      // Build the data-driven part of the dropdown from a full fetch.
      if (strategy === "all") {
        setAllStrategies(Object.keys(strat.data.data || {}));
      }

      const d = await axios.get(`/api/analytics/daily?${query}`);
      setDailyPnl(d.data.data || []);

      const s = await axios.get(`/api/analytics/summary?${query}`);
      const h = await axios.get(`/api/analytics/history?${query}`);

      setSummary(s.data.data || {});
      setHistory(h.data.data || []);
    } catch (err) {
      console.log(err.message);
    }
  };

  const getCumulativeData = () => {
    let sum = 0;
    const sorted = [...dailyPnl].sort(
      (a, b) => new Date(a.date) - new Date(b.date),
    );
    return sorted.map((d) => {
      sum += d.pnl;
      return { ...d, cumulative: sum };
    });
  };

  const cumulativeData = getCumulativeData();

  const getDrawdownData = () => {
    let peak = 0;
    return cumulativeData.map((d) => {
      if (d.cumulative > peak) peak = d.cumulative;
      return { ...d, drawdown: d.cumulative - peak };
    });
  };

  const lastPoint = cumulativeData[cumulativeData.length - 1];

  const getStrategyChartData = () => {
    return Object.keys(strategyData).map((key) => ({
      strategy: prettyStrategy(key),
      pnl: strategyData[key],
    }));
  };

  const getStreakStats = () => {
    let win = 0,
      loss = 0,
      maxWin = 0,
      maxLoss = 0;
    history.forEach((t) => {
      if (t.netPnl > 0) {
        win++;
        loss = 0;
      } else {
        loss++;
        win = 0;
      }
      maxWin = Math.max(maxWin, win);
      maxLoss = Math.max(maxLoss, loss);
    });
    return { maxWin, maxLoss };
  };

  const getRiskConsistency = () => {
    const rr = history.map((t) => t.rr || 0).filter((v) => v > 0);
    if (!rr.length) return 0;
    const avg = rr.reduce((a, b) => a + b, 0) / rr.length;
    const variance =
      rr.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / rr.length;
    return (avg / Math.sqrt(variance)).toFixed(2);
  };

  // calendar heatmap ──
  const cellColor = (pnl) => {
    if (pnl == null || pnl === 0) return "#ebedf0";
    if (pnl > 0) {
      if (pnl < 500) return "#9be9a8";
      if (pnl < 1500) return "#40c463";
      if (pnl < 3000) return "#30a14e";
      return "#216e39";
    }
    const a = Math.abs(pnl);
    if (a < 500) return "#fecaca";
    if (a < 1500) return "#f87171";
    if (a < 3000) return "#ef4444";
    return "#b91c1c";
  };

  const buildHeatmap = () => {
    if (!fromDate || !toDate) return { weeks: [], months: [] };
    const start = new Date(fromDate);
    const end = new Date(toDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end)
      return { weeks: [], months: [] };

    const key = (dt) =>
      `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;

    const pnlMap = {};
    dailyPnl.forEach((d) => {
      const dt = new Date(d.date);
      if (!isNaN(dt.getTime())) {
        const k = key(dt);
        pnlMap[k] = (pnlMap[k] || 0) + d.pnl;
      }
    });

    const gridStart = new Date(start);
    gridStart.setDate(gridStart.getDate() - gridStart.getDay()); // back to Sunday
    const gridEnd = new Date(end);
    gridEnd.setDate(gridEnd.getDate() + (6 - gridEnd.getDay())); // forward to Saturday

    const weeks = [];
    const cur = new Date(gridStart);
    while (cur <= gridEnd) {
      const week = [];
      for (let i = 0; i < 7; i++) {
        const inRange = cur >= start && cur <= end;
        const k = key(cur);
        week.push({
          key: k,
          inRange,
          pnl: inRange ? (k in pnlMap ? pnlMap[k] : 0) : null,
        });
        cur.setDate(cur.getDate() + 1);
      }
      weeks.push(week);
    }

    const months = [];
    let lastMonth = -1;
    weeks.forEach((week, wi) => {
      const first = week.find((d) => d.inRange);
      if (first) {
        const [yy, mm, dd] = first.key.split("-").map(Number);
        const dt = new Date(yy, mm - 1, dd);
        if (dt.getMonth() !== lastMonth) {
          months.push({ wi, label: dt.toLocaleString("en-US", { month: "short" }) });
          lastMonth = dt.getMonth();
        }
      }
    });

    return { weeks, months };
  };

  const heatmap = buildHeatmap();
  
  const formatSymbol = (sym) => {
    if (!sym) return "";
    const monthly = sym.match(/^([A-Z]+)(\d{2})([A-Z]{3})(\d+)(CE|PE)$/);
    if (monthly) return `${monthly[1]} ${monthly[4]} ${monthly[5]}`;
    const weekly = sym.match(/^([A-Z]+)(\d{2})(\d)(\d{2})(\d+)(CE|PE)$/);
    if (weekly) return `${weekly[1]} ${weekly[5]} ${weekly[6]}`;
    return sym;
  };

  const streak = getStreakStats();



  // Merge the always-on list with any real strategies found in data (no dupes).
  const strategyOptions = [...new Set([...KNOWN_STRATEGIES, ...allStrategies])];

  return (
    <>
      <Navbar />

      <div className="main">
        <h2 className="page-title">Analytics Dashboard</h2>

        {/* FILTERS */}
        <div className="analytics-filters">
          <div className="date-group">
            <label>From</label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
            />
          </div>

          <div className="date-group">
            <label>To</label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
            />
          </div>

          <div className="date-group">
            <label>Strategy</label>
            <select
              value={strategy}
              onChange={(e) => setStrategy(e.target.value)}
            >
              <option value="all">All Strategies</option>
              {strategyOptions.map((key) => (
                <option key={key} value={key}>
                  {prettyStrategy(key)}
                </option>
              ))}
            </select>
          </div>

          <ModeToggle mode={mode} setMode={setMode} />

          <button
            className="primary-btn apply-btn"
            onClick={() => {
              if (!fromDate || !toDate) {
                alert("Please select both From and To dates.");
                return;
              }
              setHasApplied(true);
              fetchData();
            }}
          >
            Apply
          </button>
        </div>

        {!hasApplied ? (
          <div className="analytics-empty" style={{ padding: "60px 0" }}>
            <div className="analytics-empty-icon">📊</div>
            <div className="analytics-empty-text">
              Select a date range and click Apply to view analytics
            </div>
          </div>
        ) : (
          <>
        

        {/* KPI */}
        <div className="analytics-kpi-row">
          <Card title="Total PnL" value={summary.totalPnl} money />
          <Card title="Trades" value={summary.totalTrades} />
          <Card
            title="Win Rate"
            value={summary.winRate ? summary.winRate + "%" : "0%"}
          />
          <Card title="Max Win" value={summary.maxWin} money />
          <Card title="Max Loss" value={summary.maxLoss} money />
          <Card title="Risk Consistency" value={getRiskConsistency()} />
        </div>

        {/* STREAK */}
        <div className="analytics-kpi-row">
          <Card title="Max Win Streak" value={streak.maxWin} />
          <Card title="Max Loss Streak" value={streak.maxLoss} />
        </div>

        {/* CHARTS */}
        <div className="section-block">
          <h3 className="section-title">
            Performance Overview
            {strategy !== "all" && (
              <span className="section-title-right">
                {prettyStrategy(strategy)}
              </span>
            )}
          </h3>

          <div className="chart-grid">
            <ChartCard title="Equity Curve">
              {dailyPnl.length === 0 ? (
                <Empty />
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={cumulativeData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eef2f6" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v) => `₹ ${v}`} />
                    <Line
                      dataKey="cumulative"
                      stroke={lastPoint?.cumulative >= 0 ? "#16a34a" : "#dc2626"}
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </ChartCard>

            <ChartCard title="Drawdown">
              {dailyPnl.length === 0 ? (
                <Empty />
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={getDrawdownData()}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eef2f6" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v) => `₹ ${v}`} />
                    <Line dataKey="drawdown" stroke="#dc2626" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </ChartCard>
          </div>
        </div>

        {/* SECOND ROW */}
        <div className="section-block">
          <h3 className="section-title">Distribution &amp; Strategy</h3>

          <div className="chart-grid">
            <ChartCard title="Daily PnL">
              {dailyPnl.length === 0 ? (
                <Empty />
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={dailyPnl}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eef2f6" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="pnl" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>

            <ChartCard title="Strategy Performance">
              {Object.keys(strategyData).length === 0 ? (
                <Empty />
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={getStrategyChartData()}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eef2f6" />
                    <XAxis dataKey="strategy" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="pnl" fill="#2563eb" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>
          </div>
        </div>

        {/* HEATMAP */}
        <div className="section-block">
          <h3 className="section-title">
            Performance Heatmap
            {fromDate && toDate && (
              <span className="section-title-right">
                {fromDate} to {toDate}
              </span>
            )}
          </h3>
          {heatmap.weeks.length === 0 ? (
            <Empty />
          ) : (
            <div className="zheat-scroll">
              <div className="zheat">
                <div className="zheat-grid">
                  {heatmap.weeks.map((week, wi) => (
                    <div className="zheat-col" key={wi}>
                      {week.map((day, di) => (
                        <div
                          key={di}
                          className="zheat-cell"
                          title={
                            day.inRange
                              ? `${day.key}: ₹ ${Number(day.pnl).toLocaleString("en-IN")}`
                              : ""
                          }
                          style={{
                            background: day.inRange
                              ? cellColor(day.pnl)
                              : "transparent",
                          }}
                        />
                      ))}
                    </div>
                  ))}
                </div>
                <div className="zheat-months">
                  {heatmap.weeks.map((_, wi) => {
                    const m = heatmap.months.find((mm) => mm.wi === wi);
                    return (
                      <div className="zheat-month" key={wi}>
                        {m ? m.label : ""}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* TABLE */}
        <div className="section-block">
          <h3 className="section-title">
            Trade History
            <span className="section-title-right">
              {history.length} trade{history.length === 1 ? "" : "s"}
            </span>
          </h3>

          <div className="analytics-table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Strategy</th>
                  <th>Instrument</th>
                  <th>PnL</th>
                  <th></th>
                </tr>
              </thead>

              <tbody>
                {history.length === 0 ? (
                  <tr>
                    <td colSpan="5">
                      <Empty />
                    </td>
                  </tr>
                ) : (
                  history.map((t) => (
                    <React.Fragment key={t._id}>
                      <tr
                        onClick={() =>
                          setExpanded(expanded === t._id ? null : t._id)
                        }
                      >
                       <td>{new Date(t.exitTime).toLocaleDateString()}</td>
                        <td>{prettyStrategy(t.strategy)}</td>
                        <td>{t.instrument}</td>
                        <td className={t.netPnl >= 0 ? "profit" : "loss"}>
                          ₹ {t.netPnl}
                        </td>
                        <td className="trade-caret-cell">
                          <span className={`trade-caret ${expanded === t._id ? "open" : ""}`}>
                            <svg viewBox="0 0 24 24" width="20" height="20">
                              <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </span>
                        </td>
                      </tr>

                      {expanded === t._id && (
                        <tr className="trade-detail-row">
                          <td colSpan="5">
                            <div className="trade-detail">
                              <table className="trade-detail-table">
                                <thead>
                                  <tr>
                                    <th>Type</th>
                                    <th>Symbol</th>
                                    <th>Qty</th>
                                    <th>Entry</th>
                                    <th>Entry Value</th>
                                    <th>Exit</th>
                                    <th>Exit Value</th>
                                    <th>Realised P&amp;L</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {t.legs?.map((l, i) => {
                                    const qty = Number(l.qty || 0);
                                    const entry = Number(l.entryPrice || 0);
                                    const exit = Number(l.exitPrice || 0);
                                    const inr = (n) =>
                                      Number(n || 0).toLocaleString("en-IN", {
                                        minimumFractionDigits: 2,
                                        maximumFractionDigits: 2,
                                      });
                                    return (
                                      <tr key={i}>
                                        <td data-label="Type">
                                          <span
                                            className={`leg-badge ${
                                              String(l.type).startsWith("BUY")
                                                ? "leg-buy"
                                                : "leg-sell"
                                            }`}
                                          >
                                            {l.type}
                                          </span>
                                        </td>
                                        <td data-label="Symbol">{formatSymbol(l.symbol)}</td>
                                        <td data-label="Qty">{qty}</td>
                                        <td data-label="Entry">₹ {entry.toFixed(2)}</td>
                                        <td data-label="Entry Value">₹ {inr(qty * entry)}</td>
                                        <td data-label="Exit">₹ {exit.toFixed(2)}</td>
                                        <td data-label="Exit Value">₹ {inr(qty * exit)}</td>
                                        <td
                                          data-label="Realised P&L"
                                          className={Number(l.pnl) >= 0 ? "profit" : "loss"}
                                        >
                                          {Number(l.pnl) >= 0 ? "+" : ""}₹ {inr(l.pnl)}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))
                )}
              </tbody>
            </table>
          </div>
          
        </div>
        </>
        )}
      </div>
      <Footer />
    </>
  );
}

function Card({ title, value, money }) {
  const num = typeof value === "number" ? value : null;
  const cls = money && num !== null ? (num >= 0 ? "profit" : "loss") : "";
  const display =
    money && num !== null
      ? `${num < 0 ? "-" : ""}₹ ${Math.abs(num).toLocaleString("en-IN")}`
      : (value ?? 0);
  return (
    <div className="analytics-kpi-card">
      <div className="kpi-title">{title}</div>
      <div className={`kpi-value ${cls}`}>{display}</div>
    </div>
  );
}

function ChartCard({ title, children }) {
  return (
    <div className="chart-card">
      <div className="chart-header">{title}</div>
      <div className="chart-body">{children}</div>
    </div>
  );
}

function Empty() {
  return (
    <div className="analytics-empty">
      <div className="analytics-empty-icon">📊</div>
      <div className="analytics-empty-text">No trade data available</div>
    </div>
  );
}