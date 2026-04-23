// Position sizing — risk-based lot calculation per the Set-&-Forget strategy.
//
// For FX pairs quoted in USD (EURUSD, GBPUSD), the "pip value" for 1 standard
// lot (100k units) is $10. 1 mini-lot = $1/pip, 1 micro-lot = $0.10/pip.
// For XAU/USD, pip value is $10 per $0.01 move per 100oz, i.e. $1 per $0.01
// per 10oz — but we simplify and size as "units" based on $ SL distance.
//
// Formula:
//   riskDollars = equity * riskPct / 100
//   slDistancePrice = |entry - SL|
//   size = riskDollars / slDistancePrice  (in "units" of the quote currency)
// For FX pairs we convert units → lots by dividing by 100_000.

export type SizingInput = {
  pair: string;
  equity: number;
  riskPct: number;
  entry: number;
  sl: number;
};

export type SizingOutput = {
  riskDollars: number;
  slDistance: number;
  units: number; // raw units of base currency
  lots: number; // 1 lot = 100_000 units for FX, 100 oz for XAU
  displayLots: string; // formatted ("0.10" or "0.05")
  pipsRisked: number;
};

function pipSize(pair: string): number {
  if (pair === "XAUUSD") return 0.1; // $0.10 per pip
  return 0.0001; // standard FX
}

export function computeSize(input: SizingInput): SizingOutput {
  const { pair, equity, riskPct, entry, sl } = input;
  const riskDollars = Math.max(0, (equity * riskPct) / 100);
  const slDistance = Math.abs(entry - sl);

  if (slDistance === 0 || riskDollars === 0) {
    return {
      riskDollars,
      slDistance,
      units: 0,
      lots: 0,
      displayLots: "0.00",
      pipsRisked: 0,
    };
  }

  // For USD-quote pairs (EURUSD, GBPUSD, XAUUSD), $1 profit per 1 unit per 1.0
  // price move ⇒ units = riskDollars / slDistance.
  const units = riskDollars / slDistance;

  const lotUnit = pair === "XAUUSD" ? 100 : 100_000;
  const lots = units / lotUnit;

  const pipsRisked = slDistance / pipSize(pair);

  return {
    riskDollars,
    slDistance,
    units,
    lots,
    displayLots: lots.toFixed(2),
    pipsRisked,
  };
}
