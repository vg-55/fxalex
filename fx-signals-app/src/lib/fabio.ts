import { db, schema, assertDb } from "@/db/client";
import { eq, desc, gte } from "drizzle-orm";
import { type CandlePair } from "./candles";
import { callGLM } from "./engine";

export type Tick = {
  price: number;
  time: number;
};

export type RangeCandle = {
  open: number;
  high: number;
  low: number;
  close: number;
  timestamp: number;
  volume: number;
  isUp: boolean;
};

export type VolumeProfile = {
  priceLevel: number;
  volume: number;
};

export type FabioAnalysis = {
  pair: string;
  candles: RangeCandle[];
  vah: number; // Value Area High
  val: number; // Value Area Low
  poc: number; // Point of Control
  currentPrice: number;
  isInsideValueArea: boolean;
  signal: "BUY" | "SELL" | "NEUTRAL";
  reasoning: string;
  aiInterpretation?: string;
  aiConfidenceScore?: number;
  entryPrice?: number;
  targetPrice?: number;
  stopLoss?: number;
  cvd: number; // Cumulative Volume Delta
};

// Fabio specifically uses 40 ticks range charts. We will define 1 tick as a pip/point depending on the pair.
// However, since we might have sparse data from price_ticks (fetched every 1-2 mins),
// we need to simulate the range candle generation based on the data we have.
// In reality, a "tick" in his methodology is a fixed price movement.
const TICKS_PER_CANDLE = 40;

function getTickSize(pair: string) {
  if (pair.includes("JPY")) return 0.01;
  if (pair === "XAUUSD") return 0.1; // Gold points
  return 0.0001; // Standard forex pip
}

// In-memory cache for AI interpretations so it doesn't randomly change on every refresh
// when the market state hasn't meaningfully changed.
const aiCache = new Map<string, { interpretation: string; score: number }>();

export async function getFabioAnalysis(pair: CandlePair): Promise<FabioAnalysis | null> {
  assertDb();
  
  // Fetch the last 2000 ticks (price points)
  const rows = await db
    .select({
      price: schema.priceTicks.price,
      fetchedAt: schema.priceTicks.fetchedAt,
    })
    .from(schema.priceTicks)
    .where(eq(schema.priceTicks.pair, pair))
    .orderBy(desc(schema.priceTicks.fetchedAt))
    .limit(2000);

  if (rows.length < 50) return null;

  // Data comes newest first, we need oldest first to build candles forward
  const ticks: Tick[] = rows.reverse().map(r => ({
    price: Number(r.price),
    time: r.fetchedAt.getTime()
  })).filter(t => t.price > 0);

  if (ticks.length < 50) return null;

  const tickSize = getTickSize(pair);
  
  let rangeCandles: RangeCandle[] = [];
  let requiredRange = TICKS_PER_CANDLE * tickSize;
  let appliedRangeTicks = TICKS_PER_CANDLE;

  // CVD tracker & Profile map
  let cvd = 0;
  const volumeProfileMap = new Map<number, number>();

  // Helper to build candles so we can retry with smaller ranges if market is dead (e.g. weekend)
  const tryBuildCandles = (rangeTarget: number) => {
    const candles: RangeCandle[] = [];
    let currentCandle: Partial<RangeCandle> | null = null;
    let currentVolume = 0;
    for (const tick of ticks) {
      if (!currentCandle) {
        currentCandle = { open: tick.price, high: tick.price, low: tick.price, timestamp: tick.time };
        currentVolume = 1;
      } else {
        currentCandle.high = Math.max(currentCandle.high!, tick.price);
        currentCandle.low = Math.min(currentCandle.low!, tick.price);
        currentVolume++;
        if ((currentCandle.high! - currentCandle.low!) >= rangeTarget) {
          candles.push({
            open: currentCandle.open!, high: currentCandle.high!, low: currentCandle.low!,
            close: tick.price, timestamp: currentCandle.timestamp!, volume: currentVolume,
            isUp: tick.price >= currentCandle.open!
          });
          currentCandle = null;
          currentVolume = 0;
        }
      }
    }
    if (currentCandle && currentVolume > 0) {
      candles.push({
        open: currentCandle.open!, high: currentCandle.high!, low: currentCandle.low!,
        close: ticks[ticks.length - 1].price, timestamp: currentCandle.timestamp!, volume: currentVolume,
        isUp: ticks[ticks.length - 1].price >= currentCandle.open!
      });
    }
    return candles;
  };

  // Adaptive range sizing for weekends/low-volatility periods
  const rangesToTry = [40, 20, 10, 5, 2, 1, 0.5, 0.1];
  for (const r of rangesToTry) {
    appliedRangeTicks = r;
    requiredRange = appliedRangeTicks * tickSize;
    rangeCandles = tryBuildCandles(requiredRange);
    if (rangeCandles.length >= 5) break;
  }

  if (rangeCandles.length < 5) return null; // Still not enough movement

  // Process CVD and Volume Profile only once on the ticks array
  let lastPrice = ticks[0].price;
  for (const tick of ticks) {
    if (tick.price > lastPrice) cvd += 1;
    else if (tick.price < lastPrice) cvd -= 1;
    lastPrice = tick.price;

    const priceLevel = Math.round(tick.price / tickSize) * tickSize;
    volumeProfileMap.set(priceLevel, (volumeProfileMap.get(priceLevel) || 0) + 1);
  }

  // Calculate Volume Profile (POC, VAH, VAL)
  let totalVolume = 0;
  let maxVolume = 0;
  let poc = ticks[0].price;

  for (const [price, vol] of volumeProfileMap.entries()) {
    totalVolume += vol;
    if (vol > maxVolume) {
      maxVolume = vol;
      poc = price;
    }
  }

  // 70% Value Area
  const targetValueAreaVolume = totalVolume * 0.70;
  let currentVaVolume = maxVolume;
  
  // Sort price levels
  const sortedLevels = Array.from(volumeProfileMap.keys()).sort((a, b) => a - b);
  const pocIndex = sortedLevels.indexOf(poc);
  
  let upIndex = pocIndex + 1;
  let downIndex = pocIndex - 1;
  
  let vah = poc;
  let val = poc;

  while (currentVaVolume < targetValueAreaVolume && (upIndex < sortedLevels.length || downIndex >= 0)) {
    const upPrice = upIndex < sortedLevels.length ? sortedLevels[upIndex] : null;
    const downPrice = downIndex >= 0 ? sortedLevels[downIndex] : null;

    const upVol = upPrice !== null ? (volumeProfileMap.get(upPrice) || 0) : -1;
    const downVol = downPrice !== null ? (volumeProfileMap.get(downPrice) || 0) : -1;

    if (upVol >= downVol && upPrice !== null) {
      currentVaVolume += upVol;
      vah = upPrice;
      upIndex++;
    } else if (downPrice !== null) {
      currentVaVolume += downVol;
      val = downPrice;
      downIndex--;
    } else {
        break;
    }
  }

  const currentPrice = ticks[ticks.length - 1].price;
  const isInsideValueArea = currentPrice >= val && currentPrice <= vah;

  // Strategy Execution Model 1: Value Area Reversion (The 80% Rule)
  // If price crossed inside the VAL and is bouncing, buy target POC -> VAH.
  // We approximate this by seeing if the current price is just inside VAL and pointing up.
  
  let signal: "BUY" | "SELL" | "NEUTRAL" = "NEUTRAL";
  let reasoning = "Market is outside Value Area or chopping without a clear entry setup.";
  let entryPrice = undefined;
  let targetPrice = undefined;
  let stopLoss = undefined;

  const lastCandle = rangeCandles[rangeCandles.length - 1];

  if (isInsideValueArea) {
    // If near VAL and last candle was bullish (bouncing)
    if (currentPrice < val + (requiredRange * 2) && lastCandle.isUp) {
      // Model 1: Long setup
      signal = "BUY";
      reasoning = "Model 1 (Triple-A): Price bounced off Value Area Low (VAL). The 80% rule suggests rotation to the Point of Control (POC) and potentially Value Area High (VAH).";
      entryPrice = currentPrice;
      targetPrice = poc; // First target
      stopLoss = val - requiredRange; // Stop just below VAL
    }
    // If near VAH and last candle was bearish (rejecting)
    else if (currentPrice > vah - (requiredRange * 2) && !lastCandle.isUp) {
      signal = "SELL";
      reasoning = "Model 1 (Triple-A): Price rejected off Value Area High (VAH). Rotation back to POC expected.";
      entryPrice = currentPrice;
      targetPrice = poc;
      stopLoss = vah + requiredRange;
    } else {
       reasoning = "Price is inside the Value Area (chop zone). Waiting for a bounce off VAL/VAH or a breakout.";
    }
  } else {
     // Expansion phase
     reasoning = "Price is outside the Value Area. Market is in trend/expansion phase. Waiting for pullback.";
  }

  let aiInterpretation = undefined;
  let aiConfidenceScore = undefined;

  // Add AI Analysis Layer
  try {
    const decimals = pair.includes("JPY") ? 3 : 5;
    
    // Create a deterministic cache key based on the exact mechanical state
    const stateKey = `${pair}_${currentPrice.toFixed(decimals)}_${vah.toFixed(decimals)}_${poc.toFixed(decimals)}_${val.toFixed(decimals)}_${cvd}_${lastCandle.isUp}_${signal}`;
    
    if (aiCache.has(stateKey)) {
      const cached = aiCache.get(stateKey)!;
      aiInterpretation = cached.interpretation;
      aiConfidenceScore = cached.score;
    } else {
      const sysPrompt = "You are Fabio, an elite order flow and tape reader. You trade exclusively via 40-Range charts and Volume Profile (Auction Market Theory). Analyze the provided state, determine if it's a high probability setup based on the 'Triple-A' 80% rule or Absorption & Squeeze. Respond with a sharp, professional desk commentary analyzing the setup (max 4 sentences). End your response with a confidence score on a new line formatted exactly as: [SCORE: X/100].";
      
      const userMsg = `PAIR: ${pair}
CURRENT PRICE: ${currentPrice.toFixed(decimals)}
VALUE AREA HIGH (VAH): ${vah.toFixed(decimals)}
POINT OF CONTROL (POC): ${poc.toFixed(decimals)}
VALUE AREA LOW (VAL): ${val.toFixed(decimals)}
CUMULATIVE DELTA (CVD): ${cvd} (Aggression: ${cvd > 0 ? 'Buy' : cvd < 0 ? 'Sell' : 'Neutral'})
LAST 40-RANGE CANDLE: ${lastCandle.isUp ? 'BULLISH' : 'BEARISH'} (C: ${lastCandle.close.toFixed(decimals)})
INSIDE VALUE AREA: ${isInsideValueArea ? 'YES' : 'NO'}
MECHANICAL SIGNAL: ${signal}
MECHANICAL REASONING: ${reasoning}`;

      const aiRes = await callGLM(sysPrompt, userMsg, 600, 0.25);
      
      if (aiRes) {
        // Extract score
        const scoreMatch = aiRes.match(/\[SCORE:\s*(\d+)\/100\]/i);
        if (scoreMatch && scoreMatch[1]) {
          aiConfidenceScore = parseInt(scoreMatch[1], 10);
        }
        // Remove score from the text for the interpretation
        aiInterpretation = aiRes.replace(/\[SCORE:\s*\d+\/100\]/i, '').trim();
        
        if (aiInterpretation && aiConfidenceScore !== undefined) {
          // Store in cache to keep it stable until the state changes
          aiCache.set(stateKey, { interpretation: aiInterpretation, score: aiConfidenceScore });
          // Optional: clear cache if it gets too large
          if (aiCache.size > 1000) aiCache.clear();
        }
      }
    }
  } catch (e) {
    console.error("Fabio AI generation failed", e);
  }

  return {
    pair,
    candles: rangeCandles,
    vah,
    val,
    poc,
    currentPrice,
    isInsideValueArea,
    signal,
    reasoning,
    aiInterpretation,
    aiConfidenceScore,
    entryPrice,
    targetPrice,
    stopLoss,
    cvd
  };
}