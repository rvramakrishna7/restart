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

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

          <button className="primary-btn apply-btn" onClick={fetchData}>
            Apply
          </button>
        </div>

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
                <ResponsiveContainer>
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
                <ResponsiveContainer>
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
                <ResponsiveContainer>
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
                <ResponsiveContainer>
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
          <h3 className="section-title">Performance Heatmap</h3>
          {dailyPnl.length === 0 ? (
            <Empty />
          ) : (
            <div className="heatmap">
              {dailyPnl.map((d, i) => (
                <div
                  key={i}
                  className="heat-cell"
                  title={`${d.date}: ₹ ${d.pnl}`}
                  style={{
                    background:
                      d.pnl > 0
                        ? `rgba(22,163,74,${Math.min(d.pnl / 1000, 1)})`
                        : `rgba(220,38,38,${Math.min(Math.abs(d.pnl) / 1000, 1)})`,
                  }}
                />
              ))}
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
                </tr>
              </thead>

              <tbody>
                {history.length === 0 ? (
                  <tr>
                    <td colSpan="4">
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
                      </tr>

                      {expanded === t._id && (
                        <tr>
                          <td colSpan="4">
                            <div className="trade-expand">
                              {t.legs?.map((l, i) => (
                                <div key={i} className="trade-expand-row">
                                  <span className="trade-expand-label">
                                    {l.type} {l.symbol}
                                  </span>
                                  <span className="trade-expand-value">
                                    ₹ {l.pnl}
                                  </span>
                                </div>
                              ))}
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