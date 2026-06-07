import { useState,useMemo } from "react";
import { useNavigate } from "react-router-dom";
import axios from "../api/axios";
import toast from "react-hot-toast";
import "../styles.css";

const LandingPage = () => {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!email || !password) {
      toast.error("Please enter your email and password");
      return;
    }

    try {
      setLoading(true);
      const res = await axios.post("/api/auth/login", { email, password });

      localStorage.setItem("token", res.data.token);
      localStorage.setItem("userId", res.data.user._id);
      localStorage.setItem("email", res.data.user.email);

      toast.success("Login successful");
      window.location.href = "/dashboard";
    } catch (err) {
      toast.error(err.response?.data?.msg || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  const icons = [
    // Trend Up
    <svg viewBox="0 0 24 24" width="16" height="16">
      <path
        d="M4 14l5-5 4 4 7-7"
        stroke="currentColor"
        strokeWidth="2"
        fill="none"
      />
    </svg>,

    // Trend Down
    <svg viewBox="0 0 24 24" width="16" height="16">
      <path
        d="M4 10l5 5 4-4 7 7"
        stroke="currentColor"
        strokeWidth="2"
        fill="none"
      />
    </svg>,

    // Bars
    <svg viewBox="0 0 24 24" width="16" height="16">
      <rect x="4" y="10" width="3" height="10" fill="currentColor" />
      <rect x="10" y="6" width="3" height="14" fill="currentColor" />
      <rect x="16" y="3" width="3" height="17" fill="currentColor" />
    </svg>,

    // Money
    <svg viewBox="0 0 24 24" width="16" height="16">
      <circle cx="12" cy="12" r="8" stroke="currentColor" fill="none" />
      <text x="12" y="16" textAnchor="middle" fontSize="10" fill="currentColor">
        ₹
      </text>
    </svg>,

    // Circular trade
    <svg viewBox="0 0 24 24" width="16" height="16">
      <path
        d="M4 12a8 8 0 0114-5M20 12a8 8 0 01-14 5"
        stroke="currentColor"
        fill="none"
      />
    </svg>,

    // Volatility
    <svg viewBox="0 0 24 24" width="16" height="16">
      <path d="M13 2L3 14h7l-1 8 10-12h-7z" fill="currentColor" />
    </svg>,
  ];

  const getRandomIcon = () => icons[Math.floor(Math.random() * icons.length)];

  
  const bgIcons = useMemo(
    () =>
      Array.from({ length: 160 }).map((_, i) => {
        const rotation = Math.random() * 360;
        const scale = 1 + Math.random() * 1.2;
        const top = Math.random() * 100;
        const left = Math.random() * 100;
        const opacity = 0.15 + Math.random() * 0.35;
        return (
          <span
            key={i}
            className="bg-icon"
            style={{
              top: `${top}%`,
              left: `${left}%`,
              "--rotate": `${rotation}deg`,
              "--scale": scale,
              opacity: opacity,
            }}
          >
            {getRandomIcon()}
          </span>
        );
      }),
    []
  );

  return (
    <div className="landing-clean">
      {/* BACKGROUND */}
    
      <div className="bg-pattern">{bgIcons}</div>

      {/* CONTENT */}
      <div className="landing-content">
        <h1>Restart Options</h1>

        <div className="landing-tagline">Zero se kar restart</div>

        <p>Automated Options Trading Platform</p>

        {/* ── LOGIN FORM (merged in) ── */}
        <div className="landing-login">
          <div className="auth-field">
            <label>Email</label>
            <input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleLogin()}
            />
          </div>

          <div className="auth-field">
            <label>Password</label>
            <input
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleLogin()}
            />
          </div>

          <div className="landing-buttons">
            <button
              className="primary-btn"
              onClick={handleLogin}
              disabled={loading}
            >
              {loading ? "Logging in…" : "Log in"}
            </button>

            <button
              className="secondary-btn"
              onClick={() => navigate("/signup")}
            >
              Sign up
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LandingPage;