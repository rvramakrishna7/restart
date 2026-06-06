import { useState, useEffect } from "react";
import axios from "../api/axios";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import "../styles.css";
import ExecutionPanel from "../components/ExecutionPanel";
import ModeToggle from "../components/ModeToggle";

const StrategySelection = () => {
  const [instrument, setInstrument] = useState(null);
  const [direction, setDirection] = useState(null);
  const [strategyType, setStrategyType] = useState("DEBIT_SPREAD");
  const [expiry, setExpiry] = useState(null);
  const [expiries, setExpiries] = useState([]);

  // ── IRON FLY STATE ──
  const [ifInstrument, setIfInstrument] = useState(null);
  const [ifExpiry, setIfExpiry] = useState(null);
  const [ifExpiries, setIfExpiries] = useState([]);
  const [ifLots, setIfLots] = useState(1);
  const [ifRunning, setIfRunning] = useState(false);
  const [ifMode, setIfMode] = useState("paper");
  const [ifData, setIfData] = useState(null);

  const resetIronFly = () => {
    setIfInstrument(null);
    setIfExpiry(null);
    setIfExpiries([]);
    setIfData(null);
  };

  // ── STRANGLE STATE ──
  const [sgInstrument, setSgInstrument] = useState(null);
  const [sgExpiry, setSgExpiry] = useState(null);
  const [sgExpiries, setSgExpiries] = useState([]);
  const [sgLots, setSgLots] = useState(1);
  const [sgRunning, setSgRunning] = useState(false);
  const [sgMode, setSgMode] = useState("paper");
  const [sgData, setSgData] = useState(null);

  const resetStrangle = () => {
    setSgInstrument(null);
    setSgExpiry(null);
    setSgExpiries([]);
    setSgData(null);
  };

  // ── STRADDLE STATE ──
  const [stInstrument, setStInstrument] = useState(null);
  const [stExpiry, setStExpiry] = useState(null);
  const [stExpiries, setStExpiries] = useState([]);
  const [stLots, setStLots] = useState(1);
  const [stRunning, setStRunning] = useState(false);
  const [stMode, setStMode] = useState("paper");
  const [stData, setStData] = useState(null);

  const resetStraddle = () => {
    setStInstrument(null);
    setStExpiry(null);
    setStExpiries([]);
    setStData(null);
  };

  const [lots, setLots] = useState(1);
  const resetSelections = () => {
    setInstrument(null);
    setDirection(null);
    setExpiry(null);
    setExpiries([]);
    setStrategyData(null);
  };
  const [running, setRunning] = useState(false);
  const [mode, setMode] = useState("paper");

  useEffect(() => {
    localStorage.setItem("mode", mode);
  }, [mode]);

  useEffect(() => {
    if (stMode) localStorage.setItem("mode", stMode);
  }, [stMode]);

  useEffect(() => {
    if (sgMode) localStorage.setItem("mode", sgMode);
  }, [sgMode]);

  useEffect(() => {
    if (ifMode) localStorage.setItem("mode", ifMode);
  }, [ifMode]);

  const [strategyData, setStrategyData] = useState(null);
  const [pnl, setPnl] = useState(0);
  const [positions, setPositions] = useState([]);

  // ================= LOAD EXPIRIES FROM ZERODHA (REAL DATES) =================
  useEffect(() => {
    if (!instrument) return;
    setExpiry(null);
    setStrategyData(null);
    setExpiries([]);

    axios
      .get(`/api/strategy/expiries?instrument=${instrument}`)
      .then((res) => {
        setExpiries(res.data?.data || []);
      })
      .catch(() => {
        console.log("Failed to fetch expiries from Zerodha");
        setExpiries([]);
      });
  }, [instrument]);

  // ================= IRON FLY EXPIRIES =================
  useEffect(() => {
    if (!ifInstrument) return;
    setIfExpiry(null);
    setIfData(null);
    setIfExpiries([]);
    axios
      .get(`/api/strategy/expiries?instrument=${ifInstrument}`)
      .then((res) => setIfExpiries(res.data?.data || []))
      .catch(() => setIfExpiries([]));
  }, [ifInstrument]);

  // ================= IRON FLY PREVIEW =================
  useEffect(() => {
    if (!ifInstrument || !ifExpiry || ifRunning) return;
    const expiryDate = ifExpiry?.date || new Date().toISOString().split("T")[0];
    axios
      .post("/api/strategy/preview-iron-fly", {
        instrument: ifInstrument,
        expiry: expiryDate,
        lots: ifLots,
      })
      .then((res) => setIfData(res.data?.data || null))
      .catch(() => setIfData(null));
  }, [ifInstrument, ifExpiry, ifLots]);

  // ================= IRON FLY EXECUTE =================
  const executeIronFly = async () => {
    try {
      const expiryDate = ifExpiry?.date || new Date().toISOString().split("T")[0];
      const res = await axios.post("/api/strategy/execute-iron-fly", {
        instrument: ifInstrument,
        expiry: expiryDate,
        lots: ifLots,
        mode: ifMode,
      });
      setIfRunning(true);
      return res.data?.data;
    } catch (err) {
      console.error("Iron fly execute error:", err.message);
      return null;
    }
  };

  // ================= STRANGLE EXPIRIES =================
  useEffect(() => {
    if (!sgInstrument) return;
    setSgExpiry(null);
    setSgData(null);
    setSgExpiries([]);
    axios
      .get(`/api/strategy/expiries?instrument=${sgInstrument}`)
      .then((res) => setSgExpiries(res.data?.data || []))
      .catch(() => setSgExpiries([]));
  }, [sgInstrument]);

  // ================= STRANGLE PREVIEW =================
  useEffect(() => {
    if (!sgInstrument || !sgExpiry || sgRunning) return;
    const expiryDate = sgExpiry?.date || new Date().toISOString().split("T")[0];
    axios
      .post("/api/strategy/preview-strangle", {
        instrument: sgInstrument,
        expiry: expiryDate,
        lots: sgLots,
      })
      .then((res) => setSgData(res.data?.data || null))
      .catch(() => setSgData(null));
  }, [sgInstrument, sgExpiry, sgLots]);

  // ================= STRANGLE EXECUTE =================
  const executeStrangle = async () => {
    try {
      const expiryDate =
        sgExpiry?.date || new Date().toISOString().split("T")[0];
      const res = await axios.post("/api/strategy/execute-strangle", {
        instrument: sgInstrument,
        expiry: expiryDate,
        lots: sgLots,
        mode: sgMode,
      });
      setSgRunning(true);
      return res.data?.data;
    } catch (err) {
      console.error("Strangle execute error:", err.message);
      return null;
    }
  };

  // ================= STRADDLE EXPIRIES =================
  useEffect(() => {
    if (!stInstrument) return;
    setStExpiry(null);
    setStData(null);
    setStExpiries([]);
    axios
      .get(`/api/strategy/expiries?instrument=${stInstrument}`)
      .then((res) => setStExpiries(res.data?.data || []))
      .catch(() => setStExpiries([]));
  }, [stInstrument]);

  // ================= STRADDLE PREVIEW =================
  useEffect(() => {
    if (!stInstrument || !stExpiry || stRunning) return;
    const expiryDate = stExpiry?.date || new Date().toISOString().split("T")[0];
    axios
      .post("/api/strategy/preview-straddle", {
        instrument: stInstrument,
        expiry: expiryDate,
        lots: stLots,
      })
      .then((res) => setStData(res.data?.data || null))
      .catch(() => setStData(null));
  }, [stInstrument, stExpiry, stLots]);

  // ================= STRADDLE EXECUTE =================
  const executeStraddle = async () => {
    try {
      const expiryDate =
        stExpiry?.date || new Date().toISOString().split("T")[0];
      const res = await axios.post("/api/strategy/execute-straddle", {
        instrument: stInstrument,
        expiry: expiryDate,
        lots: stLots,
        mode: stMode,
      });
      setStRunning(true);
      return res.data?.data;
    } catch (err) {
      console.error("Straddle execute error:", err.message);
      return null;
    }
  };

  // ================= PREVIEW =================
  const previewStrategy = async () => {
    if (!instrument || !direction || !expiry) return;

    try {
      // use real expiry date from Zerodha
      const formatted = expiry?.date || new Date().toISOString().split("T")[0];

      const res = await axios.post("/api/strategy/preview", {
        instrument,
        direction,
        expiry: formatted,
        lots,
      });

      setStrategyData(res.data?.spread || res.data?.data?.spread || null);
    } catch (err) {
      console.log("Preview error:", err.message);
    }
  };

  useEffect(() => {
    if (running) return;
    previewStrategy();
  }, [expiry, direction, instrument, lots]);

  // ================= LIVE POSITION REFRESH =================

  useEffect(() => {
    fetchPositions();

    const interval = setInterval(() => {
      fetchPositions();
    }, 3000);

    return () => clearInterval(interval);
  }, []);

  // ================= EXECUTE =================
  const executeStrategy = async () => {
    try {
      // use real expiry date from Zerodha (expiry.date is ISO string e.g. "2026-05-14")
      const expiryDate = expiry?.date || new Date().toISOString().split("T")[0];

      const res = await axios.post("/api/strategy/execute", {
        instrument,
        direction,
        lots,
        expiry: expiryDate,
        mode,
      });

      setStrategyData(res.data?.spread || null);
      setRunning(true);
      return res.data.data;
    } catch (err) {
      console.error("Execute error:", err.message);
      return null;
    }
  };

  // ================= EXIT =================
  const exitStrategy = async () => {
    await axios.post("/api/strategy/exit-all");
    setRunning(false);
    setPositions([]);
    setPnl(0);
  };

  // ================= FETCH POSITIONS =================
  const fetchPositions = async () => {
    try {
      const mode = localStorage.getItem("mode") || "paper";

      const url =
        mode === "paper"
          ? "/api/strategy/paper-positions"
          : "/api/strategy/real-positions";

      const res = await axios.get(url);
      const data = res.data?.data || [];
      setPositions(data);

      const total = data.reduce((acc, p) => acc + (p.pnl || 0), 0);
      setPnl(total);

      const anyOpen = data.some((p) => p.status === "OPEN");
      if (!anyOpen) setRunning(false);
      if (!anyOpen) setStRunning(false);
      if (!anyOpen) setSgRunning(false);
      if (!anyOpen) setIfRunning(false);
    } catch (err) {
      // server down — silent fail, keep existing state
    }
  };

  return (
    <>
    
    <div className="app">
      <Navbar />

      <div className="main">
        <h2>Strategies</h2>
        <div className="category-title">Positional Strategies</div>
        {/* ================= STRATEGY CONTROLS ================= */}
        <div className="strategy-row">
          <div className="strategy-name">Debit Spread</div>
          <ModeToggle mode={mode} setMode={setMode} />
          <button
            className="reset-btn"
            onClick={resetSelections}
            title="Reset selections"
            disabled={running}
          >
            ↺
          </button>

          {/* STEP 1 */}
          <div className="instrument-switch">
            {["NIFTY", "BANKNIFTY"].map((inst) => (
              <div
                key={inst}
                className={`chip ${instrument === inst ? "active" : ""}`}
                onClick={() => !running && setInstrument(inst)}
              >
                {inst}
              </div>
            ))}
          </div>

          {/* STEP 2 */}
          {instrument && (
            <div className="instrument-switch">
              {["BULLISH", "BEARISH"].map((d) => (
                <div
                  key={d}
                  className={`chip ${direction === d ? "active" : ""}`}
                  onClick={() => !running && setDirection(d)}
                >
                  {d === "BULLISH" ? "Bull Call Spread" : "Bear Put Spread"}
                </div>
              ))}
            </div>
          )}

          {/* STEP 3 */}
          {direction && (
            <div className="expiry-switch">
              {expiries.map((e, i) => (
                <div
                  key={i}
                  className={`chip ${expiry?.label === e.label ? "active" : ""}`}
                  onClick={() => !running && setExpiry(e)}
                >
                  {e.label}
                </div>
              ))}
            </div>
          )}

          {/* LOT */}
          {expiry && (
            <div className="lot-inline">
              <span>Lot</span>
              <select
                value={lots}
                onChange={(e) => setLots(Number(e.target.value))}
              >
                {[1, 2, 3, 4, 5].map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
            </div>
          )}

          <ExecutionPanel
            triggerRefresh={
              instrument && direction && expiry ? executeStrategy : null
            }
            strategyType="DEBIT_SPREAD"
          />
        </div>

        {/* ================= EXECUTION PANEL (FIXED POSITION) ================= */}

        {/* ================= PREVIEW ================= */}
        {!running && strategyData && (
          <div className="preview-row enhanced">
            <span className="buy">
              BUY {strategyData.buyStrike} {strategyData.optionType} @ ₹
              {strategyData.buyPremium}
            </span>

            <span className="sell">
              SELL {strategyData.sellStrike} {strategyData.optionType} @ ₹
              {strategyData.sellPremium}
            </span>

            <span className="metric">
              Margin: <b>₹{strategyData.margin || 0}</b>
            </span>

            <span className="metric profit">
              Profit: ₹{strategyData.maxProfit || 0}
            </span>

            <span className="metric loss">
              Loss: ₹{strategyData.maxLoss || 0}
            </span>

            <span className="metric rr">
              RR: {strategyData.rr ? strategyData.rr.toFixed(2) : "0.00"}
            </span>

            <span
              className={`metric pop ${strategyData.pop > 60 ? "good" : "bad"}`}
            >
              POP: {strategyData.pop ? strategyData.pop.toFixed(1) : "--"}%
            </span>
          </div>
        )}

        {/* ================= NO TRADE ================= */}
        {!running && !strategyData && instrument && direction && expiry && (
          <div className="no-trade">
            Discipline &gt; Opportunity. No valid spread right now.
          </div>
        )}

        {/* ================= IRON FLY ROW ================= */}
        <div className="strategy-row">
          <div className="strategy-name">Iron Fly</div>
          <ModeToggle mode={ifMode} setMode={setIfMode} />
          <button
            className="reset-btn"
            onClick={resetIronFly}
            title="Reset iron fly"
            disabled={ifRunning}
          >
            ↺
          </button>

          <div className="instrument-switch">
            {["NIFTY", "BANKNIFTY"].map((inst) => (
              <div
                key={inst}
                className={`chip ${ifInstrument === inst ? "active" : ""}`}
                onClick={() => !ifRunning && setIfInstrument(inst)}
              >
                {inst}
              </div>
            ))}
          </div>

          {ifInstrument && (
            <div className="expiry-switch">
              {ifExpiries.map((e, i) => (
                <div
                  key={i}
                  className={`chip ${ifExpiry?.label === e.label ? "active" : ""}`}
                  onClick={() => !ifRunning && setIfExpiry(e)}
                >
                  {e.label}
                </div>
              ))}
            </div>
          )}

          {ifExpiry && (
            <div className="lot-inline">
              <span>Lot</span>
              <select
                value={ifLots}
                onChange={(e) => setIfLots(Number(e.target.value))}
              >
                {[1, 2, 3, 4, 5].map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
            </div>
          )}

          <ExecutionPanel
            triggerRefresh={ifInstrument && ifExpiry ? executeIronFly : null}
            strategyType="IRON_FLY"
          />
        </div>

        {/* ================= IRON FLY PREVIEW STRIP ================= */}
        {!ifRunning && ifData && (
          <div className="preview-row enhanced">
            <span className="metric">
              ATM: <b>{ifData.atmStrike}</b>
            </span>
            <span className="sell">SELL CE+PE @ ₹{ifData.ceSellPrem} + ₹{ifData.peSellPrem}</span>
            <span className="buy">
              BUY CE {ifData.ceBuyStrike}@₹{ifData.ceBuyPrem} | PE {ifData.peBuyStrike}@₹{ifData.peBuyPrem}
            </span>
            <span className="metric">Net: ₹{ifData.netPremium}</span>
            <span className="metric" style={{ color: "#f59e0b" }}>
              BE: {ifData.lowerBE} — {ifData.upperBE}
            </span>
            <span className="metric profit">Max Profit: ₹{ifData.maxProfit}</span>
            <span className="metric loss">Max Loss: ₹{ifData.maxLoss}</span>
            <span className="metric" style={{ color: "#6366f1" }}>
              Futures: ₹{ifData.futures}
            </span>
          </div>
        )}

        {/* ================= IRON FLY NO TRADE ================= */}
        {!ifRunning && !ifData && ifInstrument && ifExpiry && (
          <div className="no-trade">
            Discipline &gt; Opportunity. No valid iron fly right now.
          </div>
        )}

        {/* ================= STRATEGY SECTIONS ================= */}
        <div className="category-title">Intraday Strategies</div>
        {/* ================= STRADDLE ROW ================= */}
        <div className="strategy-row">
          <div className="strategy-name">Straddle</div>
          <ModeToggle mode={stMode} setMode={setStMode} />
          <button
            className="reset-btn"
            onClick={resetStraddle}
            title="Reset straddle"
            disabled={stRunning}
          >
            ↺
          </button>

          <div className="instrument-switch">
            {["NIFTY", "BANKNIFTY"].map((inst) => (
              <div
                key={inst}
                className={`chip ${stInstrument === inst ? "active" : ""}`}
                onClick={() => !stRunning && setStInstrument(inst)}
              >
                {inst}
              </div>
            ))}
          </div>

          {stInstrument && (
            <div className="expiry-switch">
              {stExpiries.map((e, i) => (
                <div
                  key={i}
                  className={`chip ${stExpiry?.label === e.label ? "active" : ""}`}
                  onClick={() => !stRunning && setStExpiry(e)}
                >
                  {e.label}
                </div>
              ))}
            </div>
          )}

          {stExpiry && (
            <div className="lot-inline">
              <span>Lot</span>
              <select
                value={stLots}
                onChange={(e) => setStLots(Number(e.target.value))}
              >
                {[1, 2, 3, 4, 5].map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
            </div>
          )}

          <ExecutionPanel
            triggerRefresh={stInstrument && stExpiry ? executeStraddle : null}
            strategyType="INTRADAY_STRADDLE"
          />
        </div>

        {/* ================= STRADDLE PREVIEW STRIP ================= */}
        {!stRunning && stData && (
          <div className="preview-row enhanced">
            <span className="metric">
              ATM: <b>{stData.atmStrike}</b> <span className="buy">CE @ ₹{stData.cePremium}</span> <span className="sell">PE @ ₹{stData.pePremium}</span>
            </span>
            <span className="metric">Combined: ₹{stData.combined}</span>
            <span className="metric" style={{ color: "#f59e0b" }}>
              Adjust on {stData.adjustPts}pt move
            </span>
            <span className="metric profit">
              Max Profit: ₹
              {Number((stData.combined * stData.quantity).toFixed(2))}
            </span>
            <span className="metric loss">Max Loss: ₹{stData.maxLoss}</span>
            <span className="metric" style={{ color: "#6366f1" }}>
              Futures: ₹{stData.futures}
            </span>
          </div>
        )}

        {/* ================= STRANGLE ROW ================= */}
        <div className="strategy-row">
          <div className="strategy-name">Strangle</div>
          <ModeToggle mode={sgMode} setMode={setSgMode} />
          <button
            className="reset-btn"
            onClick={resetStrangle}
            title="Reset strangle"
            disabled={sgRunning}
          >
            ↺
          </button>

          <div className="instrument-switch">
            {["NIFTY", "BANKNIFTY"].map((inst) => (
              <div
                key={inst}
                className={`chip ${sgInstrument === inst ? "active" : ""}`}
                onClick={() => !sgRunning && setSgInstrument(inst)}
              >
                {inst}
              </div>
            ))}
          </div>

          {sgInstrument && (
            <div className="expiry-switch">
              {sgExpiries.map((e, i) => (
                <div
                  key={i}
                  className={`chip ${sgExpiry?.label === e.label ? "active" : ""}`}
                  onClick={() => !sgRunning && setSgExpiry(e)}
                >
                  {e.label}
                </div>
              ))}
            </div>
          )}

          {sgExpiry && (
            <div className="lot-inline">
              <span>Lot</span>
              <select
                value={sgLots}
                onChange={(e) => setSgLots(Number(e.target.value))}
              >
                {[1, 2, 3, 4, 5].map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
            </div>
          )}

          <ExecutionPanel
            triggerRefresh={sgInstrument && sgExpiry ? executeStrangle : null}
            strategyType="INTRADAY_STRANGLE"
          />
        </div>

        {/* ================= STRANGLE PREVIEW STRIP ================= */}
        {!sgRunning && sgData && (
          <div className="preview-row enhanced">
            <span className="metric">
              CE: <b>{sgData.ceStrike}</b>{" "}
              <span className="buy">@ ₹{sgData.cePremium}</span>
            </span>
            <span className="metric">
              PE: <b>{sgData.peStrike}</b>{" "}
              <span className="sell">@ ₹{sgData.pePremium}</span>
            </span>
            <span className="metric">Combined: ₹{sgData.combined}</span>
            <span className="metric" style={{ color: "#f59e0b" }}>
              Range: {Math.round(sgData.ceStrike - sgData.peStrike)}pts
            </span>
            <span className="metric profit">
              Max Profit: ₹
              {Number((sgData.combined * sgData.quantity).toFixed(2))}
            </span>
            <span className="metric loss">Max Loss: ₹{sgData.maxLoss}</span>
            <span className="metric" style={{ color: "#6366f1" }}>
              Futures: ₹{sgData.futures}
            </span>
          </div>
        )}
      </div>
    </div>
    <Footer/>
    </>
  );
};

export default StrategySelection;
