exports.buildSymbol = ({ instrument, strike, type, expiry }) => {
  if (!expiry) {
    throw new Error("Expiry missing in symbol build");
  }

  return `${instrument}${expiry}${strike}${type}`;
};