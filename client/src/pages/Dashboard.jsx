import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import axios from "../api/axios";
import "../styles.css";

const Dashboard = () => {
  const navigate = useNavigate();
  const [mode, setMode] = useState(localStorage.getItem("mode") || "paper");
  const [positions, setPositions] = useState([]);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [brokerConnected, setBrokerConnected] = useState(null); // null = unknown

  const fetchPositions = async () => {
    try {
      const url =
        mode === "paper"
          ? "/api/strategy/paper-positions"
          : "/api/strategy/real-positions";
      const res = await axios.get(url);
      setPositions(res.data?.data || []);
    } catch {
      setPositions([]);
    }
  };

  // ── check broker connection status ──
  const fetchBrokerStatus = async () => {
    try {
      const res = await axios.get("/api/user/status");
      setBrokerConnected(!!res.data?.data?.brokerConnected);
    } catch {
      setBrokerConnected(false);
    }
  };

  const handleConnectBroker = () => {
    const userId = localStorage.getItem("userId");
    if (!userId) {
      navigate("/login");
      return;
    }
    // Only the owner account can connect a live broker (also enforced on the
    // backend). Everyone else sees the beta page.
    const ownerEmail = process.env.REACT_APP_OWNER_EMAIL || "test@gmail.com";
    if (localStorage.getItem("email") !== ownerEmail) {
      navigate("/broker-access");
      return;
    }
    const apiUrl = process.env.REACT_APP_API_URL || "http://localhost:5000";
    window.location.href = `${apiUrl}/api/user/broker/zerodha/login?userId=${userId}`;
  };

  useEffect(() => {
    localStorage.setItem("mode", mode);
    fetchPositions();
    const interval = setInterval(fetchPositions, 3000);
    return () => clearInterval(interval);
  }, [mode]);

  useEffect(() => {
    fetchBrokerStatus();
  }, []);

  // ── close dropdown on outside click ──
  useEffect(() => {
    const close = () => setShowBreakdown(false);
    if (showBreakdown) document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [showBreakdown]);

  // ── PnL calculations ──
  // ── count unique open strategies not individual legs ──
  const openLegs      = positions.filter((p) => p.status === "OPEN");
  const openPositions = [
    ...new Map(
      openLegs.map((p) => [p.expiry + (p.strategyType || "DS"), p])
    ).values(),
  ];
  const totalPnL       = positions.reduce((acc, p) => acc + (p.pnl || 0), 0);

  const positionalPnL  = positions
    .filter((p) => p.strategyType === "DEBIT_SPREAD" || !p.strategyType)
    .reduce((acc, p) => acc + (p.pnl || 0), 0);

  const intradayPnL    = positions
    .filter((p) => p.strategyType === "INTRADAY_STRADDLE" || p.strategyType === "INTRADAY_STRANGLE")
    .reduce((acc, p) => acc + (p.pnl || 0), 0);

  const positionalOpen = [
    ...new Map(
      positions
        .filter((p) => (p.strategyType === "DEBIT_SPREAD" || !p.strategyType) && p.status === "OPEN")
        .map((p) => [p.expiry + "DS", p])
    ).values(),
  ].length;

  const intradayOpen = [
    ...new Map(
      positions
        .filter((p) => (p.strategyType === "INTRADAY_STRADDLE" || p.strategyType === "INTRADAY_STRANGLE") && p.status === "OPEN")
        .map((p) => [p.expiry + (p.strategyType || ""), p])
    ).values(),
  ].length;

  const pnlClass = (v) => (v >= 0 ? "profit" : "loss");
  const fmt      = (v) => (v === 0 ? "₹0.00" : `${v > 0 ? "+" : ""}₹${Math.abs(v).toFixed(2)}`);
  const fmtSign  = (v) => (v < 0 ? "-" : v > 0 ? "+" : "");

  return (
    <>
    <div className="app">
      <Navbar />

      <div className="main">

        {/* ── HEADER ── */}
        <div className="dash-header">
          <div className="dash-header-left">
            <h2>Dashboard</h2>
            <p>Live performance overview</p>
          </div>

          <div className="dash-mode-toggle">
            {["paper", "live"].map((m) => (
              <button
                key={m}
                className={`dash-mode-btn ${mode === m ? "active" : ""}`}
                onClick={() => setMode(m)}
              >
                {m === "paper" ? "📋 Paper" : "🔴 Live"}
              </button>
            ))}
          </div>
        </div>

        {/* ── BROKER CONNECT BANNER (only when not connected) ── */}
        {brokerConnected === false && (
          <div className="broker-banner">
            <div className="broker-banner-icon">
              <svg viewBox="0 0 24 24" width="20" height="20">
                <path d="M4 14l5-5 4 4 7-7" stroke="white" strokeWidth="2" fill="none" />
              </svg>
            </div>
            <div className="broker-banner-text">
              <div className="broker-banner-title">Connect your broker</div>
              <div className="broker-banner-sub">
                Link your broker account to fetch live prices and execute trades.
              </div>
            </div>
            <button className="primary-btn" onClick={handleConnectBroker}>
              Connect Broker
            </button>
          </div>
        )}

        {/* ── KPI ROW ── */}
        <div className="kpi-row">

          {/* Total PnL with dropdown */}
          <div
            className={`kpi-card clickable pnl-${totalPnL >= 0 ? "positive" : "negative"}`}
            onClick={(e) => { e.stopPropagation(); setShowBreakdown(!showBreakdown); }}
          >
            <div className="kpi-title">
              Total P&L
              {openPositions.length > 0 && (
              <span className={`kpi-arrow-icon ${showBreakdown ? "open" : ""}`} />
              )}
            </div>
            <div className="kpi-value">
              <span style={{ color: "#0f172a" }}>{fmtSign(totalPnL)}₹</span>
              <span className={pnlClass(totalPnL)}>{Math.abs(totalPnL).toFixed(2)}</span>
            </div>
            

            {showBreakdown && (
              <div className="pnl-dropdown">
                {[
                  { label: "Positional Strategies", sub: `${positionalOpen} open`, pnl: positionalPnL },
                  { label: "Intraday Strategies",   sub: `${intradayOpen} open`,   pnl: intradayPnL   },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="pnl-dropdown-item"
                    onClick={(e) => { e.stopPropagation(); navigate("/strategies"); }}
                  >
                    <div>
                      <div className="pnl-dropdown-label">{item.label}</div>
                      <div className="pnl-dropdown-sub">{item.sub} · tap to view</div>
                    </div>
                    <div className="pnl-dropdown-value">
                      <span style={{ color: "#0f172a" }}>{fmtSign(item.pnl)}₹</span>
                      <span className={pnlClass(item.pnl)}>{Math.abs(item.pnl).toFixed(2)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Open Positions */}
          <div className="kpi-card">
            <div className="kpi-title">Open Positions</div>
            <div className="kpi-value">{openPositions.length}</div>
            <div className="kpi-sub">{positionalOpen} positional · {intradayOpen} intraday</div>
          </div>

          

        </div>

        
        {/* ── EMPTY STATE ── */}
        {openPositions.length === 0 && (
          <div className="dash-empty">
            <div className="dash-empty-icon">🎯</div>
            <div className="dash-empty-title">No active positions</div>
            <div className="dash-empty-sub">Head to Strategies to execute your trade</div>
            <button className="dash-empty-btn" onClick={() => navigate("/strategies")}>
              Go to Strategies →
            </button>
          </div>
        )}

      </div>
    </div>
    <Footer />
    </>
  );
};

export default Dashboard;