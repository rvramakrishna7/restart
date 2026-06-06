import { useNavigate } from "react-router-dom";
import "../styles.css";

const LandingPage = () => {
  const navigate = useNavigate();

  // "","","","","","","","",
  // "","","","","","","",
  // "","","","","","","",
  // "","","","","","",""
  // ];

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

  return (
    <div className="landing-clean">
      {/* BACKGROUND */}
      <div className="bg-pattern">
        {Array.from({ length: 160 }).map((_, i) => {
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
        })}
      </div>

      {/* CONTENT */}
      <div className="landing-content">
        <h1>RESTART Options</h1>

        <div className="landing-tagline">Zero se kar restart</div>

        <p>Automated Options Trading Platform</p>

        <div className="landing-buttons">
          <button className="primary-btn" onClick={() => navigate("/login")}>
            Login
          </button>

          <button className="secondary-btn" onClick={() => navigate("/signup")}>
            Signup
          </button>
        </div>
      </div>
    </div>
  );
};

export default LandingPage;