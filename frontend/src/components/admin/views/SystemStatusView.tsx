import React from 'react';
import { SystemService, AdminNavSection } from '../../../types';
import { SystemStatusWidget } from '../dashboard/SystemStatusWidget';
import { ArrowLeft, Activity, Server, ShieldCheck, CheckCircle2 } from 'lucide-react';

interface SystemStatusViewProps {
  services: SystemService[];
  onNavigateSection: (section: AdminNavSection) => void;
}

export const SystemStatusView: React.FC<SystemStatusViewProps> = ({
  services,
  onNavigateSection,
}) => {
  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <button
            type="button"
            onClick={() => onNavigateSection('dashboard')}
            className="inline-flex items-center gap-2 px-3.5 py-1.5 mb-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 hover:text-slate-950 font-bold text-sm border border-slate-200 shadow-2xs cursor-pointer transition-all duration-150 group"
          >
            <ArrowLeft className="h-4 w-4 text-slate-600 group-hover:-translate-x-0.5 transition-transform" />
            <span>返回 Dashboard 總覽</span>
          </button>
          <h1 className="text-xl font-black text-slate-900 flex items-center gap-2">
            <Activity className="h-5 w-5 text-emerald-600" />
            系統服務與演算法引擎運行狀態
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            監控 GuardFrame 人臉活體偵測、證件資料辨識與風控分析模型之可用性與延遲
          </p>
        </div>

        <div className="flex items-center gap-2 bg-emerald-50 px-3.5 py-2 rounded-xl border border-emerald-200 text-emerald-800 text-xs font-bold">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          <span>全體服務運行良好 (99.96% SLA)</span>
        </div>
      </div>

      <SystemStatusWidget services={services} />
    </div>
  );
};
