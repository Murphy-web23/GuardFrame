import React from 'react';
import { SystemService } from '../../../types';
import { AIGuardian } from '../../AIGuardian';
import { Activity, CheckCircle2, Server, ShieldCheck, Sparkles } from 'lucide-react';

interface SystemStatusWidgetProps {
  services: SystemService[];
}

export const SystemStatusWidget: React.FC<SystemStatusWidgetProps> = ({ services }) => {
  return (
    <div className="bg-white p-5 rounded-3xl border border-slate-200/80 shadow-xs space-y-4 flex flex-col justify-between">
      {/* Guardian System Assistant Status Banner */}
      <div className="p-3.5 rounded-2xl bg-gradient-to-r from-sky-50 via-white to-emerald-50/60 border border-sky-100 flex items-center gap-3.5">
        <AIGuardian size="sm" mood="success" showBadge={false} />
        <div className="text-xs">
          <div className="flex items-center gap-1.5 font-bold text-slate-900">
            <span>GuardFrame 智慧防護守護中</span>
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
            核心驗證服務正常運作，今日自動核驗率達 90.9%，8 件高風險案件已列入優先審核佇列。
          </p>
        </div>
      </div>

      {/* Services List */}
      <div>
        <div className="flex items-center justify-between pb-2 border-b border-slate-100 mb-2">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
            <Server className="h-3.5 w-3.5 text-sky-600" />
            核心模組狀態 (System Status)
          </span>
          <span className="text-[11px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200/70">
            全部正常運作
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-xs">
          {services.map((svc) => (
            <div
              key={svc.id}
              className="p-2.5 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-between"
            >
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
                <span className="font-semibold text-slate-800 text-[11px] truncate max-w-[140px]">
                  {svc.name.split(' ')[0]}
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
                <span>{svc.latencyMs}ms</span>
                <span>•</span>
                <span className="font-mono text-emerald-700">{svc.uptime}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
