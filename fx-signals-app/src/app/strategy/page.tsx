import { ArrowRight, BookOpen, Brain, Crosshair, Target, TrendingUp } from "lucide-react";

export default function StrategyPage() {
  return (
    <div className="p-8 max-w-4xl mx-auto pb-20">
      <header className="mb-12">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 text-blue-400 text-sm font-medium mb-4 border border-blue-500/20">
          <BookOpen size={16} />
          Methodology
        </div>
        <h1 className="text-4xl font-bold text-white mb-4">The "Set & Forget" Strategy</h1>
        <p className="text-xl text-slate-400 leading-relaxed">
          Based on the principles taught by FX Alex G. A rules-based, low-stress approach to trading that focuses on high-probability setups rather than high frequency.
        </p>
      </header>

      <div className="space-y-12">
        {/* Section 1: Philosophy */}
        <section>
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 bg-purple-500/10 rounded-lg text-purple-400">
              <Brain size={24} />
            </div>
            <h2 className="text-2xl font-bold text-white">1. Core Philosophy & Mindset</h2>
          </div>
          <div className="bg-[#1e293b] border border-slate-700 rounded-xl p-6 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="bg-[#0f172a] p-5 rounded-lg border border-slate-700/50">
                <h3 className="text-white font-semibold mb-2">The "Baseball Mindset"</h3>
                <p className="text-slate-400 text-sm leading-relaxed">
                  Profitable traders are like batters waiting for the perfect pitch. Don't swing at every opportunity; wait for your specific setup to form and strike once.
                </p>
              </div>
              <div className="bg-[#0f172a] p-5 rounded-lg border border-slate-700/50">
                <h3 className="text-white font-semibold mb-2">Weekly vs. Daily Goals</h3>
                <p className="text-slate-400 text-sm leading-relaxed">
                  Instead of forcing trades to meet a daily quota (e.g., $1,000/day), aim for a weekly goal. This forces you to wait for only the highest probability setups.
                </p>
              </div>
              <div className="bg-[#0f172a] p-5 rounded-lg border border-slate-700/50">
                <h3 className="text-white font-semibold mb-2">Single Bias Trading</h3>
                <p className="text-slate-400 text-sm leading-relaxed">
                  Stick to one bias (bullish or bearish) based on the higher timeframe trend. Do not switch biases back and forth on the same day.
                </p>
              </div>
              <div className="bg-[#0f172a] p-5 rounded-lg border border-slate-700/50">
                <h3 className="text-white font-semibold mb-2">Anti-FOMO</h3>
                <p className="text-slate-400 text-sm leading-relaxed">
                  Entering after big impulsive moves have already happened is a losing strategy. You must wait for pullbacks into value areas.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Section 2: Technicals */}
        <section>
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 bg-blue-500/10 rounded-lg text-blue-400">
              <TrendingUp size={24} />
            </div>
            <h2 className="text-2xl font-bold text-white">2. Technical Framework</h2>
          </div>
          <div className="bg-[#1e293b] border border-slate-700 rounded-xl p-6">
            <div className="mb-6 pb-6 border-b border-slate-700">
              <h3 className="text-lg font-bold text-white mb-3">The Only Indicator: 50 EMA</h3>
              <p className="text-slate-400 mb-4">
                The strategy keeps charts exceptionally clean, relying on pure price action ("no gap" candlesticks) and a single Exponential Moving Average.
              </p>
              <ul className="space-y-2 text-slate-300">
                <li className="flex items-start gap-2">
                  <ArrowRight size={18} className="text-blue-400 shrink-0 mt-0.5" />
                  <span>Used to determine the dynamic trend direction.</span>
                </li>
                <li className="flex items-start gap-2">
                  <ArrowRight size={18} className="text-blue-400 shrink-0 mt-0.5" />
                  <span>Acts as a dynamic support or resistance level.</span>
                </li>
                <li className="flex items-start gap-2">
                  <ArrowRight size={18} className="text-blue-400 shrink-0 mt-0.5" />
                  <span><strong className="text-white">Price above 50 EMA</strong> = Bullish bias. <strong className="text-white">Price below 50 EMA</strong> = Bearish bias.</span>
                </li>
              </ul>
            </div>
            
            <div>
              <h3 className="text-lg font-bold text-white mb-3">Top-Down Analysis</h3>
              <div className="space-y-4">
                <div className="flex gap-4">
                  <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center font-bold text-slate-400 shrink-0">1</div>
                  <div>
                    <h4 className="text-white font-medium mb-1">Macro Trend (Weekly/Daily)</h4>
                    <p className="text-sm text-slate-400">Identify the overall market structure (Higher Highs/Higher Lows for Uptrend). Determine the current bias.</p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center font-bold text-slate-400 shrink-0">2</div>
                  <div>
                    <h4 className="text-white font-medium mb-1">Areas of Interest (Daily/4H)</h4>
                    <p className="text-sm text-slate-400">Draw horizontal zones at key S/R levels where price has historically reacted strongly. These are the *only* areas to look for trades.</p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="w-12 h-12 rounded-full bg-blue-500/20 border border-blue-500/30 flex items-center justify-center font-bold text-blue-400 shrink-0">3</div>
                  <div>
                    <h4 className="text-blue-400 font-medium mb-1">Execution (1H/15m)</h4>
                    <p className="text-sm text-slate-400">Wait patiently for the price to pull back into the AOI and align with the 50 EMA. Look for candlestick rejection.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Section 3: The Setup */}
        <section>
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 bg-emerald-500/10 rounded-lg text-emerald-400">
              <Crosshair size={24} />
            </div>
            <h2 className="text-2xl font-bold text-white">3. The Setup Formula</h2>
          </div>
          <div className="bg-gradient-to-br from-[#1e293b] to-slate-900 border border-slate-700 rounded-xl p-8 text-center relative overflow-hidden">
            <div className="absolute top-0 right-0 p-8 opacity-5">
              <Target size={200} />
            </div>
            <div className="relative z-10 flex flex-wrap justify-center items-center gap-4 text-lg font-medium text-slate-300">
              <span className="px-4 py-2 bg-slate-800 rounded-lg border border-slate-700">Trend Alignment</span>
              <span className="text-slate-500">+</span>
              <span className="px-4 py-2 bg-slate-800 rounded-lg border border-slate-700">AOI Pullback</span>
              <span className="text-slate-500">+</span>
              <span className="px-4 py-2 bg-blue-900/50 text-blue-300 rounded-lg border border-blue-500/30">50 EMA Touch</span>
              <span className="text-slate-500">+</span>
              <span className="px-4 py-2 bg-emerald-900/50 text-emerald-300 rounded-lg border border-emerald-500/30">Candle Rejection</span>
              <span className="text-slate-500">=</span>
              <span className="px-6 py-2 bg-emerald-500 text-white rounded-lg shadow-lg shadow-emerald-500/20 font-bold">Valid Entry</span>
            </div>
          </div>
        </section>
        
        {/* Section 4: Risk Management */}
        <section>
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 bg-amber-500/10 rounded-lg text-amber-400">
              <Target size={24} />
            </div>
            <h2 className="text-2xl font-bold text-white">4. Risk Management (The "Forget" Phase)</h2>
          </div>
          <div className="bg-[#1e293b] border border-slate-700 rounded-xl p-6">
            <p className="text-slate-300 mb-6 italic">"Once you conduct your analysis, set your entry limit orders, set your SL, and set your TP, you step away from the charts. Let the edge play out."</p>
            
            <div className="grid sm:grid-cols-2 gap-6">
              <div className="bg-[#0f172a] p-5 rounded-lg border border-amber-500/20">
                <h3 className="text-amber-400 font-bold mb-2">Asymmetrical Risk:Reward</h3>
                <p className="text-slate-400 text-sm">Always aim for a minimum of a <strong className="text-white">1:2 or greater</strong> Risk-to-Reward ratio. With a 1:2 R:R, you can have a win rate of less than 40% and still be a profitable trader.</p>
              </div>
              <div className="bg-[#0f172a] p-5 rounded-lg border border-slate-700">
                <h3 className="text-white font-bold mb-2">Capital Preservation</h3>
                <p className="text-slate-400 text-sm">Risk a fixed, small percentage of your account per trade (strictly 1% to 2%). This ensures you can survive inevitable losing streaks.</p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
