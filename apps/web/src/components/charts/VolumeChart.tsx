'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import type { ApiTrade } from '@/lib/api';

interface VolumeChartProps {
  trades: ApiTrade[];
  className?: string;
}

export function VolumeChart({ trades, className }: VolumeChartProps) {
  if (trades.length === 0) {
    return (
      <div className={`flex items-center justify-center text-sm text-txt-disabled ${className || 'h-[200px]'}`}>
        No trade data for volume chart
      </div>
    );
  }

  // Bucket trades by hour
  const buckets = new Map<string, { buys: number; sells: number }>();

  for (const trade of trades) {
    const date = new Date(trade.created_at);
    const key = `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:00`;

    if (!buckets.has(key)) {
      buckets.set(key, { buys: 0, sells: 0 });
    }

    const bucket = buckets.get(key)!;
    const ethAmount = parseFloat(trade.eth_amount) / 1e18;

    if (trade.type === 'buy' || (trade.type === 'rebalance' && parseFloat(trade.eth_amount) > 0)) {
      bucket.buys += ethAmount;
    } else {
      bucket.sells += ethAmount;
    }
  }

  const data = Array.from(buckets.entries()).map(([time, { buys, sells }]) => ({
    time,
    buys: parseFloat(buys.toFixed(4)),
    sells: parseFloat(sells.toFixed(4)),
  }));

  return (
    <div className={className || 'h-[200px]'}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
          <XAxis
            dataKey="time"
            tick={{ fontSize: 9, fill: '#706F84' }}
            axisLine={{ stroke: 'rgba(0,0,0,0.08)' }}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 9, fill: '#706F84' }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#FFFFFF',
              border: '1px solid rgba(123,63,228,0.15)',
              borderRadius: '8px',
              fontSize: '11px',
              fontFamily: 'monospace',
              boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
            }}
            labelStyle={{ color: '#706F84' }}
          />
          <Legend
            verticalAlign="top"
            height={24}
            iconType="rect"
            wrapperStyle={{ fontSize: '10px', fontFamily: 'monospace', color: '#706F84' }}
          />
          <Bar dataKey="buys" name="Buy Volume" fill="#4A9D7E" radius={[3, 3, 0, 0]} />
          <Bar dataKey="sells" name="Sell Volume" fill="#A78BFA" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
