import { NextResponse } from "next/server";
import { getFabioAnalysis } from "@/lib/fabio";
import { type CandlePair } from "@/lib/candles";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const pairParam = url.searchParams.get("pair") || "XAUUSD";
    const pair = pairParam as CandlePair;

    const analysis = await getFabioAnalysis(pair);

    if (!analysis) {
       return NextResponse.json({ error: "Not enough tick data to generate Fabio 40-Range analysis." }, { status: 400 });
    }

    return NextResponse.json(analysis, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error(err);
    const message = err instanceof Error ? err.message : "fabio api error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}