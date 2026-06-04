import React from "react";
import "../styles.css";

export default function ModeToggle({ mode, setMode }) {
  const isPaper = mode === "paper";

  return (
    <div className="mode-toggle-wrapper">
      <span className={`mode-label ${isPaper ? "active" : ""}`}>
        Paper
      </span>

      <div
        className={`toggle ${!isPaper ? "on" : ""}`}
        onClick={() => setMode(isPaper ? "live" : "paper")}
      >
        <div className="circle"></div>
      </div>

      <span className={`mode-label ${!isPaper ? "active" : ""}`}>
        Live
      </span>
    </div>
  );
}