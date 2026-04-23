// Client-side mirror of sizing.ts (kept separate to avoid Drizzle imports on client)
export type SizingInput = {
  pair: string;
  equity: number;
  riskPct: number;
  entry: number;
  sl: number;
};

function pipSize(pair: string): number {
  if (pair === "XAUUSD") return 0.1;
  return 0.0001;
}

export function computeSize(input: SizingInput) {
  const { pair, equity, riskPct, entry, sl } = input;
  const riskDollars = Math.max(0, (equity * riskPct) / 100);
  const slDistance = Math.abs(entry - sl);
  if (slDistance === 0 || riskDollars === 0) {
    return { riskDollars, slDistance, units: 0, lots: 0, displayLots: "0.00", pipsRisked: 0 };
  }
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
