function selectBestExpiry(expiries) {

  if (!expiries || expiries.length === 0) return null;

  let bestExpiry = null;
  let bestRR = 0;

  for (let i = 0; i < expiries.length; i++) {

    const expiry = expiries[i];

    if (!expiry || !expiry.riskReward) continue;

    if (expiry.riskReward >= 1.9 && expiry.riskReward > bestRR) {
      bestRR = expiry.riskReward;
      bestExpiry = expiry;
    }
  }

  return bestExpiry;
}

module.exports = selectBestExpiry;