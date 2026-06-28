import { useEffect, useState } from "react";
import axios from "../api/axios";
import toast from "react-hot-toast";
import { useNavigate } from "react-router-dom";

const Navbar = () => {
  const navigate = useNavigate();

  const [isConnected, setIsConnected] = useState(false);
  const [time, setTime] = useState("");
  const [loading, setLoading] = useState(false);

  const [market, setMarket] = useState({
    nifty: null,
    banknifty: null,
  });

  // =====================
  // FETCH STATUS
  // =====================
  const fetchStatus = async () => {
    try {
      const res = await axios.get("/api/user/status");
      setIsConnected(res.data.data?.brokerConnected || false);
    } catch (err) {
      console.log(err);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  // =====================
  // FETCH MARKET DATA (REST POLLING — NO WEBSOCKET)
  // The WebSocket connection is owned by ExecutionPanel to avoid conflicts.
  // Navbar polls REST API every 3 seconds for market data instead.
  // =====================
  useEffect(() => {
    const fetchMarketData = async () => {
      try {
        const res = await axios.get("/api/user/market-data", {
          headers: {
            Authorization: `Bearer ${localStorage.getItem("token")}`,
          },
        });

        setMarket({
          nifty: res.data?.data?.nifty || null,
          banknifty: res.data?.data?.banknifty || null,
        });
      } catch (err) {
        console.log("Market data fetch failed");
      }
    };

    // initial fetch
    fetchMarketData();

    // poll every 3 seconds
    const interval = setInterval(fetchMarketData, 3000);

    return () => clearInterval(interval);
  }, []);

  // =====================
  // CHANGE CALC
  // =====================
  const getChange = (current, previousClose) => {
    if (!current || !previousClose) {
      return { change: 0, percent: 0 };
    }

    const diff = current - previousClose;

    return {
      change: diff,
      percent: (diff / previousClose) * 100,
    };
  };

  // =====================
  // MARKET STATUS
  // =====================
  const getMarketStatus = () => {
    const now = new Date();

    const day = now.getDay();
    const hour = now.getHours();
    const minute = now.getMinutes();

    if (day === 0 || day === 6) return "CLOSED";

    if (
      (hour > 9 && hour < 15) ||
      (hour === 9 && minute >= 15) ||
      (hour === 15 && minute <= 30)
    ) {
      return "OPEN";
    }

    return "CLOSED";
  };

  // =====================
  // TOGGLE
  // =====================
  const handleToggle = async () => {
    if (loading) return;
    setLoading(true);

    try {
      if (isConnected) {
        await axios.post("/api/user/broker/disconnect");
        setIsConnected(false);
        setLoading(false);
        return;
      }

      const userId = localStorage.getItem("userId");

      if (!userId) {
        toast.error("User not found. Please login again.");
        setLoading(false);
        return;
      }

      // Only the owner account can connect a live broker (also enforced the backend). 
      const ownerEmail = process.env.REACT_APP_OWNER_EMAIL || "test@gmail.com";
      if (localStorage.getItem("email") !== ownerEmail) {
        setLoading(false);
        navigate("/broker-access");
        return;
      }

      const apiUrl = process.env.REACT_APP_API_URL || "http://localhost:5000";
      window.location.href = `${apiUrl}/api/user/broker/zerodha/login?userId=${userId}`;
    } catch (err) {
      console.log(err);
      setLoading(false);
    }
  };

  // =====================
  // LOGOUT
  // =====================
  const logout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("userId");
    navigate("/");
  };

  // =====================
  // TIME
  // =====================
  useEffect(() => {
    const interval = setInterval(() => {
      setTime(
        new Date().toLocaleString("en-IN", {
          timeZone: "Asia/Kolkata",
          weekday: "short",
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
      );
    }, 1000);

    return () => clearInterval(interval);
  }, []);


  const niftyChange = getChange(market.nifty);
  const bankChange = getChange(market.banknifty);

  return (
    <div className="navbar">
      {/* LEFT */}
      <div className="nav-left">
        <div className="logo" onClick={() => navigate("/dashboard")}>
          Restart Options
        </div>

        <div className="nav-links">
          <span onClick={() => navigate("/dashboard")}>Dashboard</span>
          <span onClick={() => navigate("/strategies")}>Strategies</span>
          <span onClick={() => navigate("/analytics")}>Analytics</span>
          {localStorage.getItem("email") ===
            (process.env.REACT_APP_OWNER_EMAIL || "test@gmail.com") && (
            <span onClick={() => navigate("/admin")}>Admin</span>
          )}
        </div>

        {/* MARKET */}
        <div className="market-box">
          {/* NIFTY */}
          <span
            className={`market-item ${niftyChange.change >= 0 ? "up" : "down"}`}
          >
            <b>NIFTY</b> {market.nifty ? Math.round(market.nifty) : "--"}
            
          </span>

          {/* BANKNIFTY */}
          <span
            className={`market-item ${bankChange.change >= 0 ? "up" : "down"}`}
          >
            <b>BANKNIFTY</b>{" "}
            {market.banknifty ? Math.round(market.banknifty) : "--"}
           
          </span>

          {/* STATUS */}
          <span className="market-status">{getMarketStatus()}</span>
        </div>
      </div>

      {/* RIGHT */}
      <div className="nav-right">
        <span>{time}</span>

        <div className="broker-box">
          <span>Broker: {isConnected ? "Live" : "Off"}</span>

          <div
            className={`toggle ${isConnected ? "on" : "off"}`}
            onClick={handleToggle}
          >
            <div className="circle"></div>
          </div>
        </div>

        <button className="primary-btn" onClick={logout}>
          Logout
        </button>
      </div>
    </div>
  );
};

export default Navbar;