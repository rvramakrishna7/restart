import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  Line,
} from "recharts";

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const pnl = payload.find((p) => p.dataKey === "pnl")?.value;
  const t0  = payload.find((p) => p.dataKey === "t0")?.value;
  return (
    <div style={{
      background: "#fff",
      border: "1px solid #e2e8f0",
      borderRadius: 10,
      padding: "10px 14px",
      boxShadow: "0 4px 16px rgba(15,23,42,0.12)",
      fontSize: 12.5,
      minWidth: 130,
    }}>
      <div style={{ fontWeight: 700, color: "#0f172a", marginBottom: 6, fontSize: 13 }}>
        {Number(label).toLocaleString("en-IN")}
      </div>
      {pnl !== undefined && (
        <div style={{ color: pnl >= 0 ? "#059669" : "#dc2626", fontWeight: 600 }}>
          pnl : {Number(pnl).toFixed(2)}
        </div>
      )}
      {t0 !== undefined && (
        <div style={{ color: "#2563eb", fontWeight: 500 }}>
          t0 : {Number(t0).toFixed(2)}
        </div>
      )}
    </div>
  );
};

const PayoffChart = ({ data, metrics, positions }) => {
  if (!data || data.length === 0) return null;

  const currentSpot =
    positions?.[0]?.spotPrice ||
    positions?.[0]?.underlyingPrice ||
    positions?.[0]?.spot ||
    0;

  const underlying = positions?.[0]?.symbol?.includes("BANKNIFTY")
    ? "BANKNIFTY"
    : "NIFTY";

  const pnlValues = data.map((d) => d.pnl).filter((v) => v !== undefined);
  const minPnl    = Math.min(...pnlValues);
  const maxPnl    = Math.max(...pnlValues);
  const pad       = Math.abs(maxPnl - minPnl) * 0.12 || 500;
  const yMin      = Math.floor((minPnl - pad) / 500) * 500;
  const yMax      = Math.ceil((maxPnl  + pad) / 500) * 500;

  return (
    <div className="payoff-wrapper">
      <div className="payoff-top">
        <div className="payoff-title">Strategy Payoff Analysis</div>
        <div className="payoff-metrics">
          <div>POP:<span>{metrics?.pop}%</span></div>
          <div>Max Profit:<span className="green">&#8377; {metrics?.maxProfit}</span></div>
          <div>Max Loss:<span className="red">&#8377; {metrics?.maxLoss}</span></div>
          <div>RR:<span>{metrics?.rr}</span></div>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={300}>
        <AreaChart data={data} margin={{ top: 10, right: 12, left: 6, bottom: 0 }}>
          <defs>
            <linearGradient id="profitGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="#16a34a" stopOpacity={0.22} />
              <stop offset="100%" stopColor="#16a34a" stopOpacity={0.04} />
            </linearGradient>
            <linearGradient id="lossGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="#ef4444" stopOpacity={0.18} />
              <stop offset="100%" stopColor="#ef4444" stopOpacity={0.03} />
            </linearGradient>
          </defs>

          <CartesianGrid strokeDasharray="4 4" stroke="#e8edf4" vertical={false} />

          <XAxis
            dataKey="spot"
            type="number"
            domain={["dataMin", "dataMax"]}
            tickCount={9}
            minTickGap={20}
            tickFormatter={(v) =>
              Number(v).toLocaleString("en-IN", { maximumFractionDigits: 0 })
            }
            tick={{ fontSize: 11, fill: "#94a3b8" }}
            axisLine={{ stroke: "#e2e8f0" }}
            tickLine={false}
          />

          <YAxis
            domain={[yMin, yMax]}
            tickFormatter={(v) =>
              v >= 1000 || v <= -1000 ? `${(v / 1000).toFixed(1)}k` : v
            }
            tick={{ fontSize: 11, fill: "#94a3b8" }}
            axisLine={false}
            tickLine={false}
            width={46}
          />

          <Tooltip content={<CustomTooltip />} />

          <ReferenceLine y={0} stroke="#94a3b8" strokeWidth={1} />

          {currentSpot > 0 && (
            <ReferenceLine
              x={currentSpot}
              stroke="#7c3aed"
              strokeDasharray="5 4"
              strokeWidth={1.5}
              label={{
                value: underlying,
                position: "insideTopRight",
                fill: "#7c3aed",
                fontSize: 11,
                fontWeight: 600,
              }}
            />
          )}

          <Area
            type="monotone"
            dataKey={(d) => (d.pnl < 0 ? d.pnl : 0)}
            stroke="none"
            fill="url(#lossGradient)"
            isAnimationActive={false}
          />
          <Area
            type="monotone"
            dataKey={(d) => (d.pnl > 0 ? d.pnl : 0)}
            stroke="none"
            fill="url(#profitGradient)"
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="pnl"
            stroke="#16a34a"
            strokeWidth={2.5}
            dot={false}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="t0"
            stroke="#3b82f6"
            strokeDasharray="6 4"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>

      <div className="payoff-bottom">
        <div>Lower BE : <span>{metrics?.lowerBreakeven || "-"}</span></div>
        <div>Upper BE : <span>{metrics?.upperBreakeven || "-"}</span></div>
        <div>Margin : <span>&#8377; {Number(metrics?.requiredMargin || 0).toLocaleString("en-IN")}</span></div>
      </div>
    </div>
  );
};

export default PayoffChart;