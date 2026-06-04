function findATMStrike(spotPrice, strikes) {

  if (!spotPrice || !strikes || strikes.length === 0) return null;

  let closestStrike = strikes[0];
  let minDiff = Math.abs(spotPrice - closestStrike);

  for (let i = 0; i < strikes.length; i++) {

    const strike = strikes[i];
    const diff = Math.abs(spotPrice - strike);

    if (diff < minDiff) {
      minDiff = diff;
      closestStrike = strike;
    }
  }

  return closestStrike;
}

module.exports = findATMStrike;