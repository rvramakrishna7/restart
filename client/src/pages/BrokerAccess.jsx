import { useNavigate } from "react-router-dom";
import "../styles.css";

// Email/CTA target for access requests 
const ACCESS_EMAIL = "access@restartoptions.com";

const BrokerAccess = () => {
  const navigate = useNavigate();

  const requestAccess = () => {
    window.location.href =
      `mailto:${ACCESS_EMAIL}?subject=Request%20for%20live%20automation%20access` +
      `&body=Hi,%20I'd%20like%20to%20request%20access%20to%20live%20broker%20automation%20on%20Restart.`;
  };

  return (
    <div className="ba-page">
      <div className="ba-card">
        <div className="ba-badge">Private Beta · Invite Only</div>

        <div className="ba-lock">
          <svg viewBox="0 0 24 24" width="26" height="26">
            <path
              d="M12 2a5 5 0 00-5 5v3H6a2 2 0 00-2 2v7a2 2 0 002 2h12a2 2 0 002-2v-7a2 2 0 00-2-2h-1V7a5 5 0 00-5-5zm-3 8V7a3 3 0 016 0v3H9z"
              fill="white"
            />
          </svg>
        </div>

        <h1>
          Live automation is <span className="accent">invite</span> only
        </h1>

        <p className="ba-lead">
          Restart is a strategy-testing and trade-automation platform for
          disciplined traders. Connecting a live broker is enabled for approved
          accounts during our private beta — it isn't open to your account yet.
        </p>

        <div className="ba-steps">
          <span className="ba-step">Backtest</span>
          <span className="ba-step-arrow">→</span>
          <span className="ba-step">Forward test</span>
          <span className="ba-step-arrow">→</span>
          <span className="ba-step">Paper</span>
          <span className="ba-step-arrow">→</span>
          <span className="ba-step is-live">Live</span>
        </div>

        <div className="ba-compliance">
          <svg viewBox="0 0 24 24" width="18" height="18">
            <path
              d="M12 2l7 3v6c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V5l7-3z"
              fill="none"
              stroke="#94a3b8"
              strokeWidth="1.6"
            />
            <path
              d="M9 12l2 2 4-4"
              fill="none"
              stroke="#94a3b8"
              strokeWidth="1.6"
            />
          </svg>
          <p>
            Restart is a <strong>technology platform</strong> — not a
            SEBI-registered investment adviser or research analyst. We do not
            sell tips, calls, or recommendations, and we never hold or manage
            your funds. You automate <strong>your own strategies</strong>{" "}
            through <strong>your own broker account</strong>.
          </p>
        </div>

        <div className="ba-actions">
          <button className="primary-btn" onClick={requestAccess}>
            Request early access
          </button>
          <button className="secondary-btn" onClick={() => navigate("/dashboard")}>
            Back to dashboard
          </button>
        </div>

        <p className="ba-disclaimer">
          Trading and investment in securities and derivatives are subject to
          market risk. Past performance is not indicative of future results.
        </p>
      </div>
    </div>
  );
};

export default BrokerAccess;