import React, { useEffect, useState } from "react";
import axios from "../api/axios";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";

// Owner-only CRM. Backend already enforces owner via OWNER_EMAIL, so even if a
// non-owner reaches this route the API calls return 403 and panels stay empty.
export default function Admin() {
  const [stats, setStats] = useState({});
  const [contacts, setContacts] = useState([]);
  const [users, setUsers] = useState([]);
  const [positions, setPositions] = useState([]);
  const [tab, setTab] = useState("contacts");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [s, c, u, p] = await Promise.all([
        axios.get("/api/admin/stats"),
        axios.get("/api/contact"),
        axios.get("/api/admin/users"),
        axios.get("/api/admin/positions"),
      ]);
      setStats(s.data.data || {});
      setContacts(c.data.data || []);
      setUsers(u.data.data || []);
      setPositions(p.data.data || []);
    } catch (err) {
      console.log(err.message);
    }
    setLoading(false);
  };

  const toggleReplied = async (id, current) => {
    try {
      await axios.patch(`/api/contact/${id}`, { replied: !current });
      setContacts((prev) =>
        prev.map((c) => (c._id === id ? { ...c, replied: !current } : c)),
      );
    } catch (err) {
      console.log(err.message);
    }
  };

  const togglePaid = async (id, current) => {
    try {
      await axios.patch(`/api/admin/users/${id}/paid`, { isPaid: !current });
      setUsers((prev) =>
        prev.map((u) => (u._id === id ? { ...u, isPaid: !current } : u)),
      );
    } catch (err) {
      console.log(err.message);
    }
  };

  return (
    <>
      <Navbar />
      <div className="main">
        <h2 className="page-title">Admin / CRM</h2>

        {/* STATS */}
        <div className="analytics-kpi-row">
          <StatCard title="Total Users" value={stats.totalUsers ?? 0} />
          <StatCard title="Paid Users" value={stats.paidUsers ?? 0} />
          <StatCard title="Total Enquiries" value={stats.totalContacts ?? 0} />
          <StatCard title="Unreplied" value={stats.unrepliedContacts ?? 0} highlight />
          <StatCard title="Open Positions" value={stats.openPositions ?? 0} />
          <StatCard title="Closed Trades" value={stats.closedTrades ?? 0} />
        </div>

        {/* TABS */}
        <div className="analytics-filters" style={{ gap: 8 }}>
          <button
            className={`primary-btn ${tab !== "contacts" ? "secondary-btn" : ""}`}
            onClick={() => setTab("contacts")}
          >
            Enquiries
          </button>
          <button
            className={`primary-btn ${tab !== "users" ? "secondary-btn" : ""}`}
            onClick={() => setTab("users")}
          >
            Users
          </button>
          <button
            className={`primary-btn ${tab !== "positions" ? "secondary-btn" : ""}`}
            onClick={() => setTab("positions")}
          >
            Live Positions
          </button>
        </div>

        {loading && <p style={{ color: "#64748b" }}>Loading…</p>}

        {/* CONTACTS / ENQUIRIES */}
        {tab === "contacts" && (
          <div className="section-block">
            <h3 className="section-title">
              Contact Enquiries
              <span className="section-title-right">{contacts.length}</span>
            </h3>
            <div className="analytics-table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Phone</th>
                    <th>Message</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {contacts.length === 0 ? (
                    <tr><td colSpan="6">No enquiries yet.</td></tr>
                  ) : (
                    contacts.map((c) => (
                      <tr key={c._id}>
                        <td>{new Date(c.createdAt).toLocaleDateString()}</td>
                        <td>{c.name}</td>
                        <td>{c.email}</td>
                        <td>{c.phone || "-"}</td>
                        <td style={{ maxWidth: 280, whiteSpace: "normal" }}>{c.message || "-"}</td>
                        <td>
                          <button
                            className={c.replied ? "profit" : "loss"}
                            style={{ border: "none", background: "transparent", cursor: "pointer", fontWeight: 600 }}
                            onClick={() => toggleReplied(c._id, c.replied)}
                            title="Click to toggle"
                          >
                            {c.replied ? "✓ Replied" : "Pending"}
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* USERS */}
        {tab === "users" && (
          <div className="section-block">
            <h3 className="section-title">
              Registered Users
              <span className="section-title-right">{users.length}</span>
            </h3>
            <div className="analytics-table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Joined</th>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Broker</th>
                    <th>Plan</th>
                  </tr>
                </thead>
                <tbody>
                  {users.length === 0 ? (
                    <tr><td colSpan="5">No users yet.</td></tr>
                  ) : (
                    users.map((u) => (
                      <tr key={u._id}>
                        <td>{new Date(u.createdAt).toLocaleDateString()}</td>
                        <td>{u.name || "-"}</td>
                        <td>{u.email}</td>
                        <td>{u.broker?.connected ? "Connected" : "—"}</td>
                        <td>
                          <button
                            className={u.isPaid ? "profit" : "loss"}
                            style={{ border: "none", background: "transparent", cursor: "pointer", fontWeight: 600 }}
                            onClick={() => togglePaid(u._id, u.isPaid)}
                            title="Click to toggle paid"
                          >
                            {u.isPaid ? "Paid" : "Free"}
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* LIVE POSITIONS */}
        {tab === "positions" && (
          <div className="section-block">
            <h3 className="section-title">
              Open Positions (All Users)
              <span className="section-title-right">{positions.length}</span>
            </h3>
            <div className="analytics-table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Opened</th>
                    <th>Index</th>
                    <th>Strategy</th>
                    <th>Mode</th>
                    <th>PnL</th>
                  </tr>
                </thead>
                <tbody>
                  {positions.length === 0 ? (
                    <tr><td colSpan="5">No open positions.</td></tr>
                  ) : (
                    positions.map((p) => (
                      <tr key={p._id}>
                        <td>{new Date(p.createdAt).toLocaleDateString()}</td>
                        <td>{p.index}</td>
                        <td>{p.strategyType}</td>
                        <td>{p.mode}</td>
                        <td className={(p.pnl || 0) >= 0 ? "profit" : "loss"}>
                          ₹ {p.pnl ?? 0}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
      <Footer />
    </>
  );
}

function StatCard({ title, value, highlight }) {
  return (
    <div className="analytics-kpi-card">
      <div className="kpi-title">{title}</div>
      <div className={`kpi-value ${highlight && value > 0 ? "loss" : ""}`}>{value}</div>
    </div>
  );
}