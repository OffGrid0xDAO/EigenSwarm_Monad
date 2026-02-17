'use client';

import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import type { ApiTrade } from '@/lib/api';

interface TradeDistributionProps {
  trades: ApiTrade[];
  className?: string;
}

const COLORS: Record<string, string> = {
  buy: '#7B3FE4',
  sell: '#A78BFA',
  profit_take: '#4A9D7E',
  reactive_sell: '#878285',
  liquidation: '#DC2626',
  fee_claim: '#FBBF24',
  rebalance: '#C4B5FD',
  arbitrage: '#E4A83F',
};

const LABELS: Record<string, string> = {
  buy: 'Buy',
  sell: 'Sell',
  profit_take: 'Profit Take',
  reactive_sell: 'Reactive Sell',
  liquidation: 'Liquidation',
  fee_claim: 'Fee Claim',
  rebalance: 'Rebalance',
  arbitrage: 'Arbitrage',
};

export function TradeDistribution({ trades, className }: TradeDistributionProps) {
  if (trades.length === 0) {
    return (
      <div className={`flex items-center justify-center text-sm text-txt-disabled ${className || 'h-[200px]'}`}>
        No trade data
      </div>
    );
  }

  // Count by type
  const counts = new Map<string, number>();
  for (const trade of trades) {
    counts.set(trade.type, (counts.get(trade.type) || 0) + 1);
  }

  const data = Array.from(counts.entries()).map(([type, count]) => ({
    name: LABELS[type] || type,
    value: count,
    color: COLORS[type] || '#8888A4',
  }));

  const total = trades.length;

  return (
    <div className={`flex items-center ${className || 'h-[200px]'}`}>
      {/* Pie chart — shifted left to make room for legend */}
      <div className="relative flex-shrink-0" style={{ width: '55%', height: '100%' }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={38}
              outerRadius={62}
              paddingAngle={1}
              dataKey="value"
            >
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                backgroundColor: '#FFFFFF',
                border: '1px solid rgba(123,63,228,0.15)',
                borderRadius: '8px',
                fontSize: '11px',
                fontFamily: 'monospace',
                boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        {/* Center label */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="font-mono text-lg font-bold text-txt-primary leading-none">{total}</span>
          <span className="text-[9px] text-txt-muted uppercase tracking-wider mt-0.5">trades</span>
        </div>
      </div>

      {/* Custom right-side legend */}
      <div className="flex flex-col justify-center gap-1.5 pl-2 min-w-0" style={{ width: '45%' }}>
        {data.map((entry) => (
          <div key={entry.name} className="flex items-center gap-1.5 min-w-0">
            <span
              className="flex-shrink-0 w-2 h-2 rounded-full"
              style={{ backgroundColor: entry.color }}
            />
            <span className="text-[10px] text-txt-muted truncate">{entry.name}</span>
            <span className="text-[10px] font-mono text-txt-primary ml-auto flex-shrink-0">{entry.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
