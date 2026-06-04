import { useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "../api/axios";
import toast from "react-hot-toast";
import "../styles.css";

const Signup = () => {
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSignup = async () => {
    if (!email || !password) {
      toast.error("Please enter your email and password");
      return;
    }
    if (password.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }

    try {
      setLoading(true);
      const res = await axios.post("/api/auth/signup", { name, email, password });

      localStorage.setItem("token", res.data.token);
      localStorage.setItem("userId", res.data.user._id);
      localStorage.setItem("email", res.data.user.email);

      toast.success("Account created");
      window.location.href = "/dashboard";
    } catch (err) {
      toast.error(err.response?.data?.msg || "Signup failed");
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

        <h2>Create your account</h2>
        <p className="auth-sub">Start trading with Restart</p>

        <div className="auth-field">
          <label>Name</label>
          <input
            type="text"
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="auth-field">
          <label>Email</label>
          <input
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div className="auth-field">
          <label>Password</label>
          <input
            type="password"
            placeholder="At least 6 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSignup()}
          />
        </div>

        <button className="primary-btn" onClick={handleSignup} disabled={loading}>
          {loading ? "Creating account…" : "Create account"}
        </button>

        <div className="auth-divider">or</div>

        <button className="secondary-btn" onClick={() => navigate("/login")}>
          Already have an account? Log in
        </button>
      </div>
    </div>
  );
};

export default Signup;