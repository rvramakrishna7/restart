import { useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "../api/axios";
import toast from "react-hot-toast";
import "../styles.css";

const Login = () => {
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

  return (
    <div className="auth-clean">
      <div className="auth-box-clean">
        <div className="auth-logo-mark">
          <svg viewBox="0 0 24 24" width="22" height="22">
            <path d="M4 14l5-5 4 4 7-7" stroke="white" strokeWidth="2" fill="none" />
          </svg>
        </div>

        <h2>Welcome back</h2>
        <p className="auth-sub">Log in to your Restart account</p>

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

        <button className="primary-btn" onClick={handleLogin} disabled={loading}>
          {loading ? "Logging in…" : "Log in"}
        </button>

        <div className="auth-divider">or</div>

        <button className="secondary-btn" onClick={() => navigate("/signup")}>
          Don't have an account? Sign up
        </button>
      </div>
    </div>
  );
};

export default Login;