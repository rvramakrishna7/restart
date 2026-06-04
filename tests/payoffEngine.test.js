const { generatePayoff } = require("../services/payoffEngine");

describe("payoffEngine.generatePayoff", () => {
  it("returns an empty payoff for no positions", () => {
    const result = generatePayoff([]);
    expect(result).toEqual({ chart: [], metrics: {} });
  });

  it("returns a chart and metrics for a valid leg", () => {
    const result = generatePayoff([
      { symbol: "NIFTY24JUN22500CE", side: "BUY", qty: 50, entryPrice: 100 },
    ]);
    expect(Array.isArray(result.chart)).toBe(true);
    expect(typeof result.metrics).toBe("object");
  });
});