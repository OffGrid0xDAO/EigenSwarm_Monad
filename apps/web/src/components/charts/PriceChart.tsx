'use client';

import { useEffect, useRef } from 'react';
import type { ApiPriceSnapshot } from '@/lib/api';
import type { OhlcvCandle } from '@/lib/geckoTerminal';

interface PriceChartProps {
  ohlcvData?: OhlcvCandle[];
  lineData?: ApiPriceSnapshot[];
  symbol?: string;
  className?: string;
  theme?: 'dark' | 'light';
}

/** Sort by time and deduplicate — lightweight-charts requires strictly ascending timestamps. */
function dedupeChartData(data: ApiPriceSnapshot[]) {
  const sorted = data
    .map((d) => ({
      time: Math.floor(new Date(d.created_at).getTime() / 1000) as any,
      value: d.price_eth,
    }))
    .sort((a: any, b: any) => a.time - b.time);

  const deduped: typeof sorted = [];
  for (const point of sorted) {
    if (deduped.length > 0 && deduped[deduped.length - 1]!.time === point.time) {
      deduped[deduped.length - 1] = point;
    } else {
      deduped.push(point);
    }
  }
  return deduped;
}

function mapOhlcvToCandles(data: OhlcvCandle[]) {
  const sorted = [...data].sort((a, b) => a.time - b.time);
  const deduped: typeof sorted = [];
  for (const candle of sorted) {
    if (deduped.length > 0 && deduped[deduped.length - 1]!.time === candle.time) {
      deduped[deduped.length - 1] = candle;
    } else {
      deduped.push(candle);
    }
  }
  return deduped.map((c) => ({
    time: c.time as any,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
  }));
}

export function PriceChart({ ohlcvData, lineData, symbol, className, theme = 'dark' }: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  const seriesRef = useRef<any>(null);
  const modeRef = useRef<'candle' | 'line' | null>(null);

  const hasOhlcv = ohlcvData && ohlcvData.length > 0;
  const hasLine = lineData && lineData.length > 0;
  const mode = hasOhlcv ? 'candle' : hasLine ? 'line' : null;

  useEffect(() => {
    if (!containerRef.current || !mode) return;

    let cancelled = false;

    import('lightweight-charts').then(({ createChart, ColorType }) => {
      if (cancelled || !containerRef.current) return;

      const isLight = theme === 'light';
      const chart = createChart(containerRef.current, {
        layout: {
          background: { type: ColorType.Solid, color: 'transparent' },
          textColor: isLight ? '#706F84' : '#8888A4',
          fontSize: 10,
          fontFamily: '"DM Mono", monospace',
        },
        grid: {
          vertLines: { color: isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.04)' },
          horzLines: { color: isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.04)' },
        },
        crosshair: {
          vertLine: { color: '#7B3FE4', width: 1, style: 2 },
          horzLine: { color: '#7B3FE4', width: 1, style: 2 },
        },
        rightPriceScale: {
          borderColor: isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)',
        },
        timeScale: {
          borderColor: isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)',
          timeVisible: true,
        },
        handleScroll: { vertTouchDrag: false },
      });

      if (mode === 'candle') {
        const series = chart.addCandlestickSeries({
          upColor: '#7B3FE4',
          downColor: '#C76E6E',
          borderUpColor: '#7B3FE4',
          borderDownColor: '#C76E6E',
          wickUpColor: '#9B6FFF',
          wickDownColor: '#E88E8E',
        });
        seriesRef.current = series;
        series.setData(mapOhlcvToCandles(ohlcvData!));
      } else {
        const series = chart.addLineSeries({
          color: '#7B3FE4',
          lineWidth: 2,
          crosshairMarkerRadius: 4,
          crosshairMarkerBorderColor: '#7B3FE4',
          crosshairMarkerBackgroundColor: '#fff',
          priceFormat: {
            type: 'price',
            precision: 10,
            minMove: 0.0000000001,
          },
        });
        seriesRef.current = series;
        series.setData(dedupeChartData(lineData!));
      }

      chartRef.current = chart;
      modeRef.current = mode;
      chart.timeScale().fitContent();

      const resizeObserver = new ResizeObserver((entries) => {
        const { width, height } = entries[0]!.contentRect;
        chart.applyOptions({ width, height });
      });

      resizeObserver.observe(containerRef.current!);

      (containerRef.current as any).__cleanup = () => {
        resizeObserver.disconnect();
        chart.remove();
      };
    });

    return () => {
      cancelled = true;
      (containerRef.current as any)?.__cleanup?.();
    };
  }, [mode]);

  // Update data when it changes (without recreating chart)
  useEffect(() => {
    if (!seriesRef.current || !chartRef.current) return;

    if (modeRef.current === 'candle' && hasOhlcv) {
      seriesRef.current.setData(mapOhlcvToCandles(ohlcvData!));
    } else if (modeRef.current === 'line' && hasLine) {
      seriesRef.current.setData(dedupeChartData(lineData!));
    }
    chartRef.current.timeScale().fitContent();
  }, [ohlcvData, lineData]);

  if (!hasOhlcv && !hasLine) {
    return (
      <div className={`flex items-center justify-center text-sm text-txt-disabled ${className || 'h-[300px]'}`}>
        <div className="text-center">
          <svg width="40" height="40" viewBox="0 0 40 40" fill="none" stroke="#4B4B66" strokeWidth="1" className="mx-auto mb-2">
            <rect x="2" y="4" width="36" height="28" rx="3" />
            <path d="M6 26l6-8 5 4 8-12 6 6 3-4" />
          </svg>
          Price data will appear as trades execute
        </div>
      </div>
    );
  }

  return <div ref={containerRef} className={className || 'h-[300px]'} />;
}
