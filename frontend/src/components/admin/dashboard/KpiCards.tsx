import React from 'react';
import { DashboardStats } from '../../../types';
import { 
  Users, 
  CheckCircle2, 
  Clock, 
  AlertTriangle, 
  XCircle, 
  TrendingUp 
} from 'lucide-react';

interface KpiCardsProps {
  stats: DashboardStats;
}

export const KpiCards: React.FC<KpiCardsProps> = ({ stats }) => {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3.5 sm:gap-4">
      {/* 1. 總驗證數 */}
      <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/80 shadow-xs flex flex-col justify-between">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-slate-500">今日驗證</span>
          <div className="h-8 w-8 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center">
            <Users className="h-4 w-4" />
          </div>
        </div>
        <div className="mt-2">
          <div className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
            {stats.totalToday.toLocaleString()}
          </div>
          <div className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-emerald-600">
            <TrendingUp className="h-3 w-3" />
            <span>較昨日 +{stats.totalChangePercent}%</span>
          </div>
        </div>
      </div>

      {/* 2. 驗證成功 */}
      <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/80 shadow-xs flex flex-col justify-between">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-slate-500">驗證成功</span>
          <div className="h-8 w-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <CheckCircle2 className="h-4 w-4" />
          </div>
        </div>
        <div className="mt-2">
          <div className="text-2xl sm:text-3xl font-black text-emerald-700 tracking-tight">
            {stats.passedCount.toLocaleString()}
          </div>
          <div className="mt-1 text-[11px] font-semibold text-emerald-600">
            成功率 {stats.passRatePercent}%
          </div>
        </div>
      </div>

      {/* 3. 待審核 */}
      <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/80 shadow-xs flex flex-col justify-between">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-slate-500">待審核</span>
          <div className="h-8 w-8 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center">
            <Clock className="h-4 w-4" />
          </div>
        </div>
        <div className="mt-2">
          <div className="text-2xl sm:text-3xl font-black text-sky-700 tracking-tight">
            {stats.pendingCount}
          </div>
          <div className="mt-1 text-[11px] font-semibold text-sky-600">
            {stats.pendingNote}
          </div>
        </div>
      </div>

      {/* 4. 高風險 */}
      <div className="bg-white p-4 sm:p-5 rounded-2xl border border-rose-200/80 bg-rose-50/20 shadow-xs flex flex-col justify-between">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-rose-700">高風險</span>
          <div className="h-8 w-8 rounded-xl bg-rose-100 text-rose-600 flex items-center justify-center">
            <AlertTriangle className="h-4 w-4" />
          </div>
        </div>
        <div className="mt-2">
          <div className="text-2xl sm:text-3xl font-black text-rose-700 tracking-tight">
            {stats.highRiskCount}
          </div>
          <div className="mt-1 text-[11px] font-semibold text-rose-600">
            {stats.highRiskNote}
          </div>
        </div>
      </div>

      {/* 5. 驗證失敗 */}
      <div className="col-span-2 sm:col-span-1 bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/80 shadow-xs flex flex-col justify-between">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-slate-500">驗證失敗</span>
          <div className="h-8 w-8 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center">
            <XCircle className="h-4 w-4" />
          </div>
        </div>
        <div className="mt-2">
          <div className="text-2xl sm:text-3xl font-black text-slate-700 tracking-tight">
            {stats.failedCount}
          </div>
          <div className="mt-1 text-[11px] font-semibold text-slate-500">
            佔比 {stats.failedPercent}%
          </div>
        </div>
      </div>
    </div>
  );
};
