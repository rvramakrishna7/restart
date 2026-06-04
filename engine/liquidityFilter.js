function filterLiquidOptions(optionChain) {

  if (!optionChain || optionChain.length === 0) return [];

  const MAX_SPREAD = 5;
  const MIN_VOLUME = 1000;
  const MIN_OI = 40000;

  return optionChain.filter(option => {

    if (!option) return false;

    const spread = option.ask - option.bid;

    if (spread > MAX_SPREAD) return false;
    if (option.volume < MIN_VOLUME) return false;
    if (option.oi < MIN_OI) return false;

    return true;
  });
}

module.exports = filterLiquidOptions;