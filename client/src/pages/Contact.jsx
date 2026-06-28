import { useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "../api/axios";
import "../styles.css";

/*
 * Contact page (route /contact)
 */

const Contact = () => {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    message: "",
  });
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const update = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const validEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  const validPhone = (v) => /^[0-9+\-\s()]{7,15}$/.test(v);

  const submit = async () => {
    setError("");
    const { name, email, phone, message } = form;
    if (!name.trim() || !email.trim() || !phone.trim() || !message.trim()) {
      setError("Please fill in all fields.");
      return;
    }
    if (!validEmail(email)) {
      setError("Please enter a valid email address.");
      return;
    }
    if (!validPhone(phone)) {
      setError("Please enter a valid phone number.");
      return;
    }

    try {
      setLoading(true);
      const res = await axios.post("/api/contact", {
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim(),
        message: message.trim(),
      });
      if (res.data?.success) setSent(true);
      else
        setError(
          res.data?.message || "Something went wrong. Please try again.",
        );
    } catch (err) {
      setError(
        err.response?.data?.message ||
          "Something went wrong. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rp-page">
      {/* ===== NAV ===== */}
      <header className="rp-nav">
        <div className="rp-logo" onClick={() => navigate("/")}>
          <span className="rp-logo-mark" />
          RESTART <span className="rp-logo-light">Options</span>
        </div>
        <nav className="rp-nav-links">
          <button className="rp-nav-cta" onClick={() => navigate("/start")}>
            Login
          </button>
        </nav>
      </header>

      {/* ===== CONTACT ===== */}
      <section className="rp-contact">
        <div className="rp-contact-grid">
          {/* LEFT — story / proverb */}
          <div className="rp-contact-left">
            <span className="rp-eyebrow">Get in touch</span>
            <h1>Let's talk strategy.</h1>
            <p className="rp-contact-intro">
              Questions about the platform, automation, or getting set up? Send
              us a note and we'll get back to you within 1–2 working days.
            </p>

            <blockquote className="rp-quote">
              "The market is a device for transferring money from the impatient
              to the patient."
            </blockquote>
          </div>

          {/* RIGHT — form / success */}
          <div className="rp-contact-card">
            {sent ? (
              <div className="rp-success">
                <div className="rp-success-ic">✓</div>
                <h3>Thank you — message received!</h3>
                <p>
                  We've got your enquiry and will get back to you within
                  <b> 1–2 working days</b>. Keep an eye on your inbox.
                </p>
                <button
                  className="rp-btn-primary"
                  onClick={() => navigate("/")}
                >
                  Back to home
                </button>
              </div>
            ) : (
              <>
                <h3 className="rp-form-title">Send us a message</h3>

                <div className="rp-field">
                  <label>Name</label>
                  <input
                    type="text"
                    placeholder="Your full name"
                    value={form.name}
                    onChange={update("name")}
                  />
                </div>
                <div className="rp-field">
                  <label>Email</label>
                  <input
                    type="email"
                    placeholder="you@example.com"
                    value={form.email}
                    onChange={update("email")}
                  />
                </div>
                <div className="rp-field">
                  <label>Phone</label>
                  <input
                    type="tel"
                    placeholder="+91 98765 43210"
                    value={form.phone}
                    onChange={update("phone")}
                  />
                </div>
                <div className="rp-field">
                  <label>Message</label>
                  <textarea
                    rows="4"
                    placeholder="How can we help?"
                    value={form.message}
                    onChange={update("message")}
                  />
                </div>

                {error && <div className="rp-form-error">{error}</div>}

                <button
                  className="rp-btn-primary rp-btn-block"
                  onClick={submit}
                  disabled={loading}
                >
                  {loading ? "Sending…" : "Send message"}
                </button>
              </>
            )}
          </div>
        </div>
      </section>

      {/* ===== FOOTER ===== */}
      <footer className="rp-footer">
        <div className="rp-footer-top">
          <div className="rp-logo">
            <span className="rp-logo-mark" />
            RESTART <span className="rp-logo-light">Options</span>
          </div>
          <div className="rp-footer-tagline">
            Built for traders who believe consistency beats prediction and
            discipline beats emotion.
          </div>
        </div>
        <div className="rp-disclaimer">
          <strong>Important disclaimer.</strong> Restart Options is a software
          tool for the analysis, backtesting, forward-testing and automation of
          user-defined trading strategies. It is <em>not</em> investment advice,
          a stock-tip service, or a portfolio-management service, and it is not
          a SEBI-registered investment adviser or research analyst.
        </div>
        <div className="rp-footer-bottom">
          Made with <span className="rp-heart">♥</span> in India · ©{" "}
          {new Date().getFullYear()} Restart Options
        </div>
      </footer>
    </div>
  );
};

export default Contact;
