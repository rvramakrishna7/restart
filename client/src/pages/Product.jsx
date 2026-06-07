import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import "../styles/product.css";

gsap.registerPlugin(ScrollTrigger);

/*
 * Restart Options — Product page (route /product or /)
 * App-theme blue · stock-market themed · GSAP pinned scroll-story.
 * Desktop: pinned 3-act centerpiece (dashboard builds -> morphs to pipeline).
 * Mobile : NO pin — sections stack and fade up (fixes overlap + dead scroll).
 */

const Product = () => {
  const navigate = useNavigate();
  const root = useRef(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from(".rp-hero-line", {
        yPercent: 120,
        opacity: 0,
        duration: 1,
        stagger: 0.12,
        ease: "power4.out",
        delay: 0.15,
      });
      gsap.from(".rp-hero-sub, .rp-hero-actions, .rp-hero-note", {
        y: 24,
        opacity: 0,
        duration: 0.9,
        stagger: 0.1,
        ease: "power3.out",
        delay: 0.55,
      });
      gsap.from(".rp-candle", {
        scaleY: 0,
        transformOrigin: "bottom",
        opacity: 0,
        stagger: 0.05,
        duration: 0.7,
        ease: "power3.out",
        delay: 0.4,
      });

      gsap.utils.toArray(".rp-frow").forEach((row, i) => {
        gsap.from(row, {
          x: i % 2 === 0 ? -50 : 50,
          opacity: 0,
          duration: 0.9,
          ease: "power3.out",
          scrollTrigger: { trigger: row, start: "top 82%" },
        });
      });
      gsap.utils.toArray(".rp-reveal").forEach((el) => {
        gsap.from(el, {
          y: 36,
          opacity: 0,
          duration: 0.8,
          ease: "power3.out",
          scrollTrigger: { trigger: el, start: "top 86%" },
        });
      });
      gsap.to(".rp-philo-bg", {
        yPercent: 18,
        ease: "none",
        scrollTrigger: {
          trigger: ".rp-philo",
          start: "top bottom",
          end: "bottom top",
          scrub: true,
        },
      });

      const mm = gsap.matchMedia();

      // DESKTOP — pinned
      mm.add("(min-width: 861px)", () => {
        gsap.to(".rp-orb", {
          yPercent: -16,
          ease: "none",
          scrollTrigger: {
            trigger: ".rp-hero",
            start: "top top",
            end: "bottom top",
            scrub: true,
          },
        });
        const tl = gsap.timeline({
          scrollTrigger: {
            trigger: ".rp-stage",
            start: "top top",
            end: "+=900",
            scrub: 0.3,
            pin: true,
            anticipatePin: 1,
          },
        });
        tl.from(".rp-dash", { scale: 0.94, opacity: 0, duration: 0.5 })
          .from(".rp-kpi", { y: 26, opacity: 0, stagger: 0.1, duration: 0.4 }, "-=0.15")
          .fromTo(
            ".rp-spark-path",
            { strokeDashoffset: 560 },
            { strokeDashoffset: 0, duration: 0.7, ease: "power2.out" },
            "-=0.1"
          )
          .from(".rp-spark-fill", { opacity: 0, duration: 0.4 }, "<0.25")
          .from(".rp-prow", { x: -24, opacity: 0, stagger: 0.08, duration: 0.35 }, "-=0.3")
          .to(".rp-act-1", { opacity: 1, duration: 0.25 }, 0)
          .to(".rp-act-1", { opacity: 0, duration: 0.25 }, ">0.3")
          .to(".rp-dash", { y: -30, opacity: 0, scale: 0.97, duration: 0.5 }, ">0.15")
          .from(
            ".rp-node",
            { scale: 0, opacity: 0, stagger: 0.14, duration: 0.45, ease: "back.out(1.6)" },
            ">-0.15"
          )
          .from(
            ".rp-pipe",
            { scaleX: 0, transformOrigin: "left center", stagger: 0.16, duration: 0.35 },
            "<0.1"
          )
          .to(".rp-act-2", { opacity: 1, duration: 0.25 }, "<")
          .fromTo(
            ".rp-pulse",
            { left: "2%", opacity: 0 },
            { left: "98%", opacity: 1, duration: 1.0, ease: "power1.inOut" },
            ">0.1"
          )
          .to(".rp-pulse", { opacity: 0, duration: 0.2 });
      });

      // MOBILE — no pin; stage children stack & fade up
      mm.add("(max-width: 860px)", () => {
        gsap.from(".rp-dash", {
          y: 40,
          opacity: 0,
          duration: 0.8,
          ease: "power3.out",
          scrollTrigger: { trigger: ".rp-dash", start: "top 85%" },
        });
        gsap.fromTo(
          ".rp-spark-path",
          { strokeDashoffset: 560 },
          {
            strokeDashoffset: 0,
            duration: 1.1,
            ease: "power2.out",
            scrollTrigger: { trigger: ".rp-dash", start: "top 70%" },
          }
        );
        gsap.from(".rp-node", {
          y: 26,
          opacity: 0,
          stagger: 0.12,
          duration: 0.5,
          ease: "power3.out",
          scrollTrigger: { trigger: ".rp-pipeline", start: "top 85%" },
        });
      });
    }, root);

    return () => ctx.revert();
  }, []);

  return (
    <div className="rp-page" ref={root}>
      {/* ===== NAV ===== */}
      <header className="rp-nav">
        <div className="rp-logo" onClick={() => navigate("/")}>
          <span className="rp-logo-mark" />
          RESTART <span className="rp-logo-light">Options</span>
        </div>
        <nav className="rp-nav-links">
          <a href="#features">Features</a>
          <a href="#why">Why</a>
          <a onClick={() => navigate("/contact")} style={{ cursor: "pointer" }}>
            Contact
          </a>
          <button className="rp-nav-cta" onClick={() => navigate("/start")}>
            Login
          </button>
        </nav>
      </header>

      {/* ===== HERO ===== */}
      <section className="rp-hero">
        <div className="rp-orb rp-orb-1" />
        <div className="rp-orb rp-orb-2" />
        <div className="rp-grid-fade" />
        <div className="rp-hero-inner">
          <div className="rp-badge">Rule-Based Options Trading Automation</div>
          <h1 className="rp-hero-title">
            <span className="rp-line-wrap">
              <span className="rp-hero-line">
                Trade your <em>rules</em>,
              </span>
            </span>
            <span className="rp-line-wrap">
              <span className="rp-hero-line">
                not your <s>emotions</s>.
              </span>
            </span>
          </h1>
          <p className="rp-hero-sub">
            Build. Test. Automate. Restart Options helps traders transform rule-based option
            strategies into disciplined systems.<br/> No fear. No greed. No hesitation. Just execution.
          </p>
          <div className="rp-hero-actions">
            <button className="rp-btn-primary" onClick={() => navigate("/contact")}>
              Lets start
            </button>
          </div>
        </div>
        {/* ===== SCROLL CUE — animated candle ===== */}
<div className="rp-scroll-cue candle-green" ref={(el) => {
  if (!el) return;
  const patterns = [
    // [wick-top, body, wick-bot, isGreen]
    [8,  32, 8,  true],   // normal green
    [14, 28, 4,  true],   // hammer (long top wick)
    [4,  28, 14, true],   // inverted hammer
    [10, 32, 10, false],  // normal red
    [14, 26, 4,  false],  // shooting star
    [4,  26, 16, false],  // hanging man
    [12, 20, 12, true],   // doji-like green
    [6,  36, 6,  true],   // tall green
    [6,  36, 6,  false],  // tall red
  ];
  let i = 0;
  const animate = () => {
    const [wt, body, wb, green] = patterns[i % patterns.length];
    el.classList.toggle("candle-green", green);
    el.classList.toggle("candle-red", !green);
    el.querySelector(".wick-top").style.height = wt + "px";
    el.querySelector(".candle-body").style.height = body + "px";
    el.querySelector(".wick-bot").style.height = wb + "px";
    i = Math.floor(Math.random() * patterns.length);
    setTimeout(animate, 900 + Math.random() * 700);
  };
  setTimeout(animate, 800);
}}>
  <div className="wick-top" />
  <div className="candle-body" />
  <div className="wick-bot" />
</div>
      </section>

      

      {/* ===== PINNED SCROLL STORY ===== */}
      <section className="rp-stage" id="story">
        <div className="rp-stage-inner">
          <div className="rp-act rp-act-1">From rules to analysis and execution...</div>
          <div className="rp-act rp-act-2">Discipline executing every decision</div>

          <div className="rp-dash">
            <div className="rp-dash-bar">
              <span className="rp-dot" />
              <span className="rp-dot" />
              <span className="rp-dot" />
              <div className="rp-dash-title">Restart · Live Paper Engine</div>
              <div className="rp-live">
                <i />
                LIVE
              </div>
            </div>
            <div className="rp-dash-body">
              <div className="rp-kpis">
                <div className="rp-kpi">
                  <span>Total P&amp;L</span>
                  <b className="rp-up">+₹12,480</b>
                </div>
                <div className="rp-kpi">
                  <span>Win Rate</span>
                  <b>68%</b>
                </div>
                <div className="rp-kpi">
                  <span>Open</span>
                  <b>2</b>
                </div>
              </div>
              <div className="rp-chart">
                <svg viewBox="0 0 520 150" preserveAspectRatio="none">
                  <path
                    className="rp-spark-fill"
                    d="M0,120 C60,110 90,70 140,80 C200,92 230,40 300,52 C370,64 410,20 520,28 L520,150 L0,150 Z"
                  />
                  <path
                    className="rp-spark-path"
                    d="M0,120 C60,110 90,70 140,80 C200,92 230,40 300,52 C370,64 410,20 520,28"
                  />
                </svg>
              </div>
              <div className="rp-rows">
                <div className="rp-prow">
                  <span className="rp-tag rp-buy">BUY</span> NIFTY 23500 CE{" "}
                  <b className="rp-up">+₹3,240</b>
                </div>
                <div className="rp-prow">
                  <span className="rp-tag rp-sell">SELL</span> NIFTY 23700 CE{" "}
                  <b className="rp-down">−₹860</b>
                </div>
                <div className="rp-prow">
                  <span className="rp-tag rp-buy">BUY</span> BANKNIFTY 51000 PE{" "}
                  <b className="rp-up">+₹1,910</b>
                </div>
              </div>
            </div>
          </div>

          <div className="rp-pipeline">
            <div className="rp-pulse" />
            <div className="rp-node">
              <div className="rp-node-ic">📡</div>
              <span>Live Tick</span>
              <small>Broker feed</small>
            </div>
            <div className="rp-pipe" />
            <div className="rp-node">
              <div className="rp-node-ic">⚙️</div>
              <span>Engine</span>
              <small>Rules &amp; risk</small>
            </div>
            <div className="rp-pipe" />
            <div className="rp-node">
              <div className="rp-node-ic">🎯</div>
              <span>Decision</span>
              <small>Adjust / exit</small>
            </div>
            <div className="rp-pipe" />
            <div className="rp-node">
              <div className="rp-node-ic">📨</div>
              <span>Trade + Alert</span>
              <small>Executed</small>
            </div>
          </div>
        </div>
      </section>

      {/* ===== FEATURES ===== */}
      <section className="rp-features" id="features">
        <div className="rp-section-head rp-reveal">
          <span className="rp-eyebrow">The platform</span>
          <h2>Built for traders who value discipline.</h2>
        </div>

        <div className="rp-frow">
          <div className="rp-fcopy">
            <h3>Validate before risking capital</h3>
            <p>
              Forward-test your strategy on live market conditions. See how it behaves before a
              single rupee is deployed.
            </p>
          </div>
          <div className="rp-fvisual rp-fv-1">
            <span>📈</span>
          </div>
        </div>

        <div className="rp-frow rp-frow-rev">
          <div className="rp-fcopy">
            <h3>Risk management that never negotiates</h3>
            <p>
              Stops. Targets. Adjustments. Executed exactly as planned, even when emotions say
              otherwise.
            </p>
          </div>
          <div className="rp-fvisual rp-fv-2">
            <span>🛡️</span>
          </div>
        </div>

        <div className="rp-frow">
          <div className="rp-fcopy">
            <h3>Know your edge</h3>
            <p>
              Track expectancy, drawdowns, win rate, adjustment efficiency and long-term
              performance. Confidence comes from data, not opinions.
            </p>
          </div>
          <div className="rp-fvisual rp-fv-3">
            <span>⚡</span>
          </div>
        </div>

        <div className="rp-frow rp-frow-rev">
          <div className="rp-fcopy">
            <h3>Strategy Automation Engine</h3>
            <p>
              Automate complex options strategies with predefined rules. Bull Call Spreads. Bear Put
              Spreads. Dynamic strike shifting. Debit recovery adjustments. Risk-reward filtering.
              Rule-based exits.
            </p>
          </div>
          <div className="rp-fvisual rp-fv-1" data-icon="gear">
            <span>⚙️</span>
          </div>
        </div>
      </section>

      {/* ===== WHY TRADERS FAIL ===== */}
      <section className="rp-why-fail">
        <div className="rp-why-container">
          <h2>Why Most Traders Fail</h2>
          <p className="rp-why-intro">
            Most traders don&apos;t fail because of bad strategies. They fail because they fail to
            follow their own rules.
          </p>
          <div className="rp-fail-grid">
            <div className="rp-fail-card">Move stop losses</div>
            <div className="rp-fail-card">Exit winners too early</div>
            <div className="rp-fail-card">Average losing trades</div>
            <div className="rp-fail-card">Ignore risk limits</div>
            <div className="rp-fail-card">Trade emotionally</div>
          </div>
          <div className="rp-fail-footer">Automation eliminates these mistakes.</div>
        </div>
      </section>

      {/* ===== PHILOSOPHY ===== */}
      <section className="rp-philo" id="why">
        <div className="rp-philo-bg" />
        <div className="rp-philo-inner rp-reveal">
          <span className="rp-eyebrow rp-eyebrow-light">The philosophy</span>
          <h2>Discipline &gt; Opportunity.</h2>
          <p>
            Every trader starts with rules. Most traders break them. Not because the strategy
            failed. Because emotions took over. A stop loss became a hope trade. A target became
            greed. A planned exit became hesitation. Restart Options exists to remove that gap. When
            a rule is defined, the system executes it exactly as intended. No second guessing. No
            revenge trading. No emotional overrides. Discipline becomes your edge.
          </p>
          <button className="rp-btn-primary" onClick={() => navigate("/contact")}>
            Get started
          </button>
        </div>
      </section>

      {/* ===== CTA ===== */}
      <section className="rp-cta rp-reveal">
        <h2 className="rp-cta-title">
          The market is uncertain and dynamic. <br/> Your execution shouldn&apos;t be.
        </h2>
        <p>Build your strategy. Test it. Automate it. <br/> Let discipline become your edge.</p>
      </section>

      {/* ===== FOOTER ===== */}
      <footer className="rp-footer">
        <div className="rp-footer-top">
          <div className="rp-logo">
            <span className="rp-logo-mark" />
            RESTART <span className="rp-logo-light">Options</span>
          </div>
          <div className="rp-footer-tagline">
            Built for traders who believe consistency beats prediction and discipline beats emotion.
          </div>
        </div>
        <div className="rp-disclaimer">
          <strong>Important disclaimer.</strong> Restart Options is a software tool for the
          analysis, backtesting, forward-testing and automation of user-defined trading strategies.
          It is <em>not</em> involved in investment advice, stock-tip service, or a
          portfolio-management service, and it is not a SEBI-registered investment adviser or
          research analyst firm. We do not provide buy/sell recommendations or promise any returns.
        </div>
        <div className="rp-footer-bottom">
          Made with <span className="rp-heart">♥</span> in Mumbai · © {new Date().getFullYear()}{" "}
          Restart Options
        </div>
      </footer>
    </div>
  );
};

export default Product;