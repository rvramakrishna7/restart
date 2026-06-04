const { buildSymbol } = require("../services/symbolService");

describe("symbolService.buildSymbol", () => {
  it("builds a trading symbol from its parts", () => {
    const sym = buildSymbol({
      instrument: "NIFTY",
      strike: 22500,
      type: "CE",
      expiry: "24JUN",
    });
    expect(sym).toBe("NIFTY24JUN22500CE");
  });

  it("throws when expiry is missing", () => {
    expect(() =>
      buildSymbol({ instrument: "NIFTY", strike: 22500, type: "CE" })
    ).toThrow("Expiry missing in symbol build");
  });
});