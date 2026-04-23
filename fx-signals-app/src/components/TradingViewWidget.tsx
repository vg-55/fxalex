"use client";
import React, { useEffect, useRef, memo } from 'react';

function TradingViewWidget({ symbol = "OANDA:XAUUSD" }: { symbol?: string }) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!container.current) return;
    
    // Clear previous script (handles React strict mode double-mounts)
    container.current.innerHTML = '';
    
    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.type = "text/javascript";
    script.async = true;
    script.innerHTML = `
      {
        "autosize": true,
        "symbol": "${symbol}",
        "interval": "60",
        "timezone": "Etc/UTC",
        "theme": "dark",
        "style": "1",
        "locale": "en",
        "enable_publishing": false,
        "backgroundColor": "rgba(30, 41, 59, 0)",
        "gridColor": "rgba(51, 65, 85, 0.4)",
        "hide_top_toolbar": false,
        "hide_legend": false,
        "save_image": false,
        "studies": [
          "STD;EMA"
        ],
        "support_host": "https://www.tradingview.com"
      }`;
    
    container.current.appendChild(script);
  }, [symbol]);

  return (
    <div className="tradingview-widget-container" style={{ height: "100%", width: "100%" }}>
      <div ref={container} className="tradingview-widget-container__widget" style={{ height: "100%", width: "100%" }}></div>
    </div>
  );
}

export default memo(TradingViewWidget);
