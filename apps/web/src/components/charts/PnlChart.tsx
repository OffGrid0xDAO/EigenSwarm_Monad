'use client';

import {
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  ResponsiveContainer,
} from 'recharts';
import type { ApiTrade } from '@/lib/api';

interface PnlChartProps {
  trades: ApiTrade[];
  ethDeposited: number;
  className?: string;
}

export function PnlChart({ trades, ethDeposited, className }: PnlChartProps) {
  if (trades.length === 0) {
    return (
      <div className={`flex items-center justify-center text-sm text-txt-disabled ${className || 'h-[200px]'}`}>
        No trade data for chart
      </div>
    );
  }

  const sortedTrades = [...trades].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  let volume = 0;
  let withdrawable = ethDeposited;
  let arbProfit = 0;

  const data = sortedTrades.map((trade) => {
    const ethAmt = parseFloat(trade.eth_amount) / 1e18;
    const gasCost = parseFloat(trade.gas_cost) / 1e18;

    volume += ethAmt;

    switch (trade.type) {
      case 'buy':
        withdrawable -= ethAmt + gasCost;
        break;
      case 'sell':
      case 'profit_take':
      case 'reactive_sell':
      case 'liquidation':
        withdrawable += ethAmt - gasCost;
        break;
      case 'rebalance':
        withdrawable -= gasCost;
        break;
      case 'fee_claim':
        withdrawable += ethAmt - gasCost;
        break;
      case 'arbitrage':
        arbProfit += trade.pnl_realized;
        withdrawable += trade.pnl_realized - gasCost;
        break;
    }

    return {
      time: new Date(trade.created_at).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
      volume: parseFloat(volume.toFixed(6)),
      withdrawable: parseFloat(withdrawable.toFixed(6)),
      arbProfit: parseFloat(arbProfit.toFixed(6)),
    };
  });

  const hasArbTrades = sortedTrades.some((t) => t.type === 'arbitrage');

  return (
    <div className={className || 'h-[200px]'}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="volumeGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#7B3FE4" stopOpacity={0.2} />
              <stop offset="95%" stopColor="#7B3FE4" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="withdrawGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#4A9D7E" stopOpacity={0.2} />
              <stop offset="95%" stopColor="#4A9D7E" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="arbGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#E4A83F" stopOpacity={0.2} />
              <stop offset="95%" stopColor="#E4A83F" stopOpacity={0.02} />
            </linearGradient>
          </defs>
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
            formatter={(value: number, name: string) => [
              `${value.toFixed(4)} MON`,
              name === 'volume' ? 'Volume' : name === 'arbProfit' ? 'Arb Profit' : 'Withdrawable',
            ]}
          />
          <Legend
            verticalAlign="top"
            height={24}
            iconType="line"
            wrapperStyle={{ fontSize: '10px', fontFamily: 'monospace', color: '#706F84' }}
          />
          <Area
            type="monotone"
            dataKey="volume"
            fill="url(#volumeGradient)"
            stroke="none"
            legendType="none"
          />
          <Area
            type="monotone"
            dataKey="withdrawable"
            fill="url(#withdrawGradient)"
            stroke="none"
            legendType="none"
          />
          <Line
            type="monotone"
            dataKey="volume"
            name="Volume"
            stroke="#7B3FE4"
            strokeWidth={2}
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="withdrawable"
            name="Withdrawable MON"
            stroke="#4A9D7E"
            strokeWidth={2}
            dot={false}
          />
          {hasArbTrades && (
            <>
              <Area
                type="monotone"
                dataKey="arbProfit"
                fill="url(#arbGradient)"
                stroke="none"
                legendType="none"
              />
              <Line
                type="monotone"
                dataKey="arbProfit"
                name="Arb Profit"
                stroke="#E4A83F"
                strokeWidth={2}
                dot={false}
              />
            </>
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
