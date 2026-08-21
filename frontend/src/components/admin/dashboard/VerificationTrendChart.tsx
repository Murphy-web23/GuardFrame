import React, { useState } from 'react';
import { DailyTrendItem } from '../../../types';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend
} from 'recharts';
import { TrendingUp, Calendar } from 'lucide-react';

interface VerificationTrendChartProps {
  trendData: DailyTrendItem[];
}

export const VerificationTrendChart: React.FC<VerificationTrendChartProps> = ({ trendData }) => {
  const [range, setRange] = useState<'7d' | '14d' | '30d'>('7d');

  return (
    <div className="bg-white p-5 rounded-3xl border border-slate-200/80 shadow-xs space-y-4 flex flex-col justify-between">
      {/* Header with Title & Filter Buttons */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-slate-100">
        <div>
          <h3 className="text-sm font-black text-slate-900 flex items-center gap-1.5">
            <TrendingUp className="h-4 w-4 text-sky-600" />
            驗證數量與趨勢分析
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            過去 7 天身分核驗成功、待審核與失敗案件量
          </p>
        </div>

        {/* Timeframe tabs */}
        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl self-start sm:self-auto">
          {(['7d', '14d', '30d'] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                range === r
                  ? 'bg-white text-sky-700 shadow-xs'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {r === '7d' ? '近 7 天' : r === '14d' ? '近 14 天' : '近 30 天'}
            </button>
          ))}
        </div>
      </div>

      {/* Chart Area */}
      <div className="h-[240px] w-full pt-2">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={trendData}
            margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
          >
            <defs>
              <linearGradient id="passedGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10B981" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#10B981" stopOpacity={0.0} />
              </linearGradient>
              <linearGradient id="pendingGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#0EA5E9" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#0EA5E9" stopOpacity={0.0} />
              </linearGradient>
              <linearGradient id="failedGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#F43F5E" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#F43F5E" stopOpacity={0.0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
            <XAxis 
              dataKey="date" 
              tick={{ fontSize: 11, fill: '#64748B' }} 
              axisLine={{ stroke: '#E2E8F0' }} 
              tickLine={false} 
            />
            <YAxis 
              tick={{ fontSize: 11, fill: '#64748B' }} 
              axisLine={false} 
              tickLine={false} 
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#FFFFFF',
                borderRadius: '16px',
                border: '1px solid #E2E8F0',
                boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                fontSize: '12px',
                fontWeight: 600,
              }}
            />
            <Legend 
              verticalAlign="top" 
              height={32} 
              iconType="circle"
              formatter={(value) => {
                const map: Record<string, string> = {
                  passed: '驗證成功',
                  pending: '待審核',
                  failed: '驗證失敗',
                };
                return <span className="text-xs font-semibold text-slate-700">{map[value] || value}</span>;
              }}
            />
            <Area
              type="monotone"
              dataKey="passed"
              stroke="#10B981"
              strokeWidth={2.5}
              fillOpacity={1}
              fill="url(#passedGradient)"
            />
            <Area
              type="monotone"
              dataKey="pending"
              stroke="#0EA5E9"
              strokeWidth={2}
              fillOpacity={1}
              fill="url(#pendingGradient)"
            />
            <Area
              type="monotone"
              dataKey="failed"
              stroke="#F43F5E"
              strokeWidth={2}
              fillOpacity={1}
              fill="url(#failedGradient)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
