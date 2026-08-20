import React from 'react';
import { RiskDistributionItem } from '../../../types';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip
} from 'recharts';
import { ShieldCheck, ShieldAlert, Shield } from 'lucide-react';

interface RiskDistributionChartProps {
  data: RiskDistributionItem[];
}

export const RiskDistributionChart: React.FC<RiskDistributionChartProps> = ({ data }) => {
  const lowRiskPercent = data.find((item) => item.level === 'low')?.percent ?? 0;

  return (
    <div className="bg-white p-5 rounded-3xl border border-slate-200/80 shadow-xs space-y-4 flex flex-col justify-between">
      {/* Header */}
      <div className="pb-2 border-b border-slate-100 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-black text-slate-900 flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
            整體風險等級分布
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            今日核驗案件之風險分級佔比
          </p>
        </div>
      </div>

      {/* Donut Chart & Legend Stack */}
      <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-center">
        {/* Donut Chart (6 cols) */}
        <div className="sm:col-span-6 h-[190px] relative flex items-center justify-center">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                innerRadius={52}
                outerRadius={75}
                paddingAngle={3}
                dataKey="count"
              >
                {data.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value: any) => [`${value.toLocaleString()} 件`, '數量']}
                contentStyle={{
                  backgroundColor: '#FFFFFF',
                  borderRadius: '12px',
                  border: '1px solid #E2E8F0',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                  fontSize: '12px',
                  fontWeight: 600,
                }}
              />
            </PieChart>
          </ResponsiveContainer>
          
          {/* Inner Center Label */}
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="text-[11px] font-bold text-slate-400">低風險率</span>
            <span className="text-xl font-black text-emerald-700">{lowRiskPercent.toFixed(1)}%</span>
          </div>
        </div>

        {/* Breakdown Legend List (6 cols) */}
        <div className="sm:col-span-6 space-y-2">
          {data.map((item) => (
            <div
              key={item.level}
              className="p-2.5 rounded-xl border border-slate-100 bg-slate-50/70 flex items-center justify-between text-xs"
            >
              <div className="flex items-center gap-2">
                <span
                  className="h-3 w-3 rounded-full shrink-0"
                  style={{ backgroundColor: item.color }}
                />
                <span className="font-bold text-slate-800">{item.name}</span>
              </div>
              <div className="text-right">
                <span className="font-black text-slate-900">{item.percent}%</span>
                <span className="text-[11px] text-slate-400 ml-1.5">({item.count}件)</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
