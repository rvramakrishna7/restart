// Provide env so config/env.js loads without exiting during tests.
process.env.ZERODHA_API_KEY = "test";
process.env.ZERODHA_API_SECRET = "test";
process.env.MONGO_URI = "mongodb://localhost/test";
process.env.JWT_SECRET = "test_secret";

const jwt = require("jsonwebtoken");
const auth = require("../api/middleware/auth");

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe("auth middleware", () => {
  it("rejects requests with no token", () => {
    const req = { headers: {} };
    const res = mockRes();
    const next = jest.fn();
    auth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects an invalid token", () => {
    const req = { headers: { authorization: "bad.token" } };
    const res = mockRes();
    const next = jest.fn();
    auth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("accepts a valid token and sets req.user", () => {
    const token = jwt.sign({ id: "user123" }, process.env.JWT_SECRET);
    const req = { headers: { authorization: token } };
    const res = mockRes();
    const next = jest.fn();
    auth(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.user).toBe("user123");
  });
});