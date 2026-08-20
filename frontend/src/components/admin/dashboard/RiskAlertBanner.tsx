import React from 'react';
import { RiskAlert, AdminNavSection } from '../../../types';
import { AlertTriangle, Clock, ChevronRight, ShieldAlert } from 'lucide-react';

interface RiskAlertBannerProps {
  alerts: RiskAlert[];
  onNavigate: (section: AdminNavSection) => void;
}

export const RiskAlertBanner: React.FC<RiskAlertBannerProps> = ({ alerts, onNavigate }) => {
  if (!alerts || alerts.length === 0) return null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
      {alerts.map((alert) => {
        const isHighRisk = alert.type === 'high_risk';
        return (
          <div
            key={alert.id}
            className={`p-4 rounded-2xl border flex items-center justify-between transition-all ${
              isHighRisk
                ? 'bg-rose-50/50 border-rose-200/80 hover:bg-rose-50/80'
                : 'bg-amber-50/50 border-amber-200/80 hover:bg-amber-50/80'
            }`}
          >
            <div className="flex items-center gap-3">
              <div className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${
                isHighRisk ? 'bg-rose-500 text-white' : 'bg-amber-500 text-white'
              }`}>
                {isHighRisk ? (
                  <ShieldAlert className="h-5 w-5" />
                ) : (
                  <Clock className="h-5 w-5" />
                )}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-black uppercase tracking-wider ${
                    isHighRisk ? 'text-rose-900' : 'text-amber-900'
                  }`}>
                    {alert.title}
                  </span>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-black ${
                    isHighRisk 
                      ? 'bg-rose-200/80 text-rose-800' 
                      : 'bg-amber-200/80 text-amber-800'
                  }`}>
                    {alert.count} 件
                  </span>
                </div>
                <p className="text-xs text-slate-600 mt-0.5">
                  {alert.description}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => onNavigate(alert.targetNav)}
              className={`text-xs font-bold px-3 py-1.5 rounded-xl border flex items-center gap-1 shrink-0 transition-colors cursor-pointer ${
                isHighRisk
                  ? 'bg-white text-rose-700 border-rose-300 hover:bg-rose-100/50'
                  : 'bg-white text-amber-800 border-amber-300 hover:bg-amber-100/50'
              }`}
            >
              <span>{alert.actionText}</span>
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
