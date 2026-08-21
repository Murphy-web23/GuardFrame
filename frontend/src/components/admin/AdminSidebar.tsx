import React from 'react';
import { AdminNavSection } from '../../types';
import { AIGuardian } from '../AIGuardian';
import {
  LayoutDashboard,
  FileCheck,
  AlertTriangle,
  Activity,
  Settings,
  Shield,
  Smartphone,
  ExternalLink,
  ChevronRight,
  Sparkles,
  LogOut
} from 'lucide-react';

interface AdminSidebarProps {
  currentSection: AdminNavSection;
  onNavigate: (section: AdminNavSection) => void;
  onSwitchToUserPortal: () => void;
  onLogout?: () => void;
  isCollapsed?: boolean;
  // 2026-08-20 新增：原本是寫死的「1,284」「8」，改成從 AdminLayout
  // 算好的真實筆數傳進來。可選是因為這個元件目前沒有其他呼叫端。
  recordsCount?: number;
  riskCasesCount?: number;
}

export const AdminSidebar: React.FC<AdminSidebarProps> = ({
  currentSection,
  onNavigate,
  onSwitchToUserPortal,
  onLogout,
  isCollapsed = false,
  recordsCount,
  riskCasesCount,
}) => {
  const navItems: {
    id: AdminNavSection;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: string;
    badgeColor?: string;
  }[] = [
    {
      id: 'dashboard',
      label: '風控總覽',
      icon: LayoutDashboard,
    },
    {
      id: 'records',
      label: '驗證紀錄',
      icon: FileCheck,
      badge: recordsCount !== undefined ? recordsCount.toLocaleString() : undefined,
      badgeColor: 'bg-slate-100 text-slate-600',
    },
    {
      id: 'risk_cases',
      label: '風險案件',
      icon: AlertTriangle,
      badge: riskCasesCount !== undefined ? String(riskCasesCount) : undefined,
      badgeColor: 'bg-rose-100 text-rose-700 font-bold',
    },
    {
      id: 'system_status',
      label: '系統狀態',
      icon: Activity,
      badge: '正常',
      badgeColor: 'bg-emerald-100 text-emerald-700 font-semibold',
    },
  ];

  return (
    <aside className="w-64 bg-white border-r border-slate-200/80 flex flex-col justify-between h-full shrink-0 select-none">
      {/* Brand Header */}
      <div>
        <div className="p-5 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-sky-400 to-sky-600 flex items-center justify-center text-white shadow-xs">
              <Shield className="h-5 w-5 stroke-[2.5]" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-black text-base text-slate-900 tracking-tight">GuardFrame</span>
                <span className="text-[10px] font-bold text-sky-700 bg-sky-50 px-1.5 py-0.5 rounded border border-sky-100">
                  Risk
                </span>
              </div>
              <p className="text-[11px] text-slate-400 font-medium">風控管理系統</p>
            </div>
          </div>
        </div>

        {/* Navigation Items */}
        <div className="p-3.5 space-y-1">
          <p className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
            核心功能 (Core Features)
          </p>

          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentSection === item.id;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-2xl text-xs font-bold transition-all cursor-pointer ${
                  isActive
                    ? 'bg-sky-500 text-white shadow-sm shadow-sky-500/20'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Icon className={`h-4 w-4 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                  <span>{item.label}</span>
                </div>

                {item.badge && (
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] ${
                      isActive ? 'bg-white/20 text-white' : item.badgeColor
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Footer Area: Guardian Health & Switch to Portal */}
      <div className="p-3.5 border-t border-slate-100 space-y-3">
        {/* Guardian Health Status Pill */}
        <div className="p-3 rounded-2xl bg-sky-50/70 border border-sky-100 flex items-center gap-2.5">
          <AIGuardian size="sm" mood="success" showBadge={false} />
          <div className="text-[11px]">
            <div className="font-bold text-sky-950 flex items-center gap-1">
              <span>GuardFrame AI 運行中</span>
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            </div>
            <p className="text-sky-700 text-[10px]">即時守護身分安全</p>
          </div>
        </div>

        {/* Switcher to User Onboarding Portal */}
        <button
          type="button"
          onClick={onSwitchToUserPortal}
          className="w-full flex items-center justify-center gap-2 p-2 rounded-xl border border-slate-200/90 bg-white hover:bg-slate-50 text-xs font-bold text-slate-700 shadow-2xs transition-all cursor-pointer"
        >
          <Smartphone className="h-4 w-4 text-sky-600" />
          <span>體驗開戶前台 (User)</span>
        </button>

        {onLogout && (
          <button
            type="button"
            onClick={onLogout}
            className="w-full flex items-center justify-center gap-1.5 p-2 rounded-xl hover:bg-rose-50 text-slate-500 hover:text-rose-700 text-xs font-semibold transition-colors cursor-pointer"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>登出管理系統</span>
          </button>
        )}

        <div className="text-center text-[10px] text-slate-400">
          GuardFrame v2.4.0 • Enterprise
        </div>
      </div>
    </aside>
  );
};
