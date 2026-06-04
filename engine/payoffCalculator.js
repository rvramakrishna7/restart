function calculateDebitSpreadRR(buyStrike, sellStrike, buyPremium, sellPremium) {

  if (
    buyStrike == null ||
    sellStrike == null ||
    buyPremium == null ||
    sellPremium == null
  ) {
    return {
      maxProfit: 0,
      maxLoss: 0,
      riskReward: 0,
      isValidTrade: false
    };
  }

  const strikeWidth = Math.abs(sellStrike - buyStrike);

  const maxLoss = buyPremium - sellPremium;

  if (maxLoss <= 0) {
    return {
      maxProfit: 0,
      maxLoss: 0,
      riskReward: 0,
      isValidTrade: false
    };
  }

  const maxProfit = strikeWidth - maxLoss;

  const riskReward = maxProfit / maxLoss;

  return {
    maxProfit,
    maxLoss,
    riskReward,
    isValidTrade: riskReward >= 1.9
  };
}

module.exports = calculateDebitSpreadRR;