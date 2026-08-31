import React, { useState } from 'react';
import { AdminNavSection } from '../../types';
import { 
  Search, 
  Bell, 
  User, 
  ShieldCheck, 
  RotateCcw, 
  Menu, 
  Smartphone,
  CheckCircle2,
  AlertTriangle,
  LogOut
} from 'lucide-react';

interface AdminHeaderProps {
  currentSection: AdminNavSection;
  onNavigate: (section: AdminNavSection) => void;
  onSwitchToUserPortal: () => void;
  onLogout: () => void;
  onToggleMobileSidebar?: () => void;
  // 2026-08-30：原本這個按鈕只有轉圈動畫，沒有真的重新拉資料，見
  // AdminLayout.tsx loadRecords() 的說明。
  onRefresh?: () => Promise<void> | void;
}

export const AdminHeader: React.FC<AdminHeaderProps> = ({
  currentSection,
  onNavigate,
  onSwitchToUserPortal,
  onLogout,
  onToggleMobileSidebar,
  onRefresh,
}) => {
  const [showNotifications, setShowNotifications] = useState<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  const sectionTitles: Record<AdminNavSection, { title: string; subtitle: string }> = {
    dashboard: {
      title: '風控總覽 Dashboard',
      subtitle: '即時監控全行身分驗證、活體防偽與風險案件',
    },
    records: {
      title: '身分驗證紀錄總庫',
      subtitle: '檢索歷史開戶核驗案件與身分證件特徵',
    },
    risk_cases: {
      title: '高風險案件管理',
      subtitle: '優先處理需要專人介入核驗之異常案件',
    },
    system_status: {
      title: '系統服務運行狀態',
      subtitle: '核心 AI 活體模型與辨識引擎即時可用性',
    },
    settings: {
      title: '風控參數設定',
      subtitle: '管理身分核驗閾值與安全規則',
    },
  };

  const handleRefresh = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      await onRefresh?.();
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <header className="h-16 bg-white border-b border-slate-200/80 px-6 flex items-center justify-between sticky top-0 z-30 select-none">
      {/* Left: Mobile Menu Trigger & Section Title */}
      <div className="flex items-center gap-3">
        {onToggleMobileSidebar && (
          <button
            type="button"
            onClick={onToggleMobileSidebar}
            className="md:hidden p-2 rounded-xl text-slate-500 hover:bg-slate-100 cursor-pointer"
          >
            <Menu className="h-5 w-5" />
          </button>
        )}

        <div>
          <h1 className="text-base font-black text-slate-900 leading-tight">
            {sectionTitles[currentSection].title}
          </h1>
          <p className="hidden sm:block text-[11px] text-slate-400">
            {sectionTitles[currentSection].subtitle}
          </p>
        </div>
      </div>

      {/* Right: Actions, Live Indicator, Notifications, Admin Profile */}
      <div className="flex items-center gap-3.5">
        {/* Real-time Status Badge */}
        <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200/70 text-[11px] font-bold">
          <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
          <span>即時同步連線中</span>
        </div>

        {/* Refresh Button */}
        <button
          type="button"
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
          title="重新整理數據"
        >
          {/* 改用 animate-spin 而不是原本的單次 180 度旋轉——真正打 API
              的耗時不固定，單次轉一半的動畫在請求比較久時看起來會卡住
              不動，持續旋轉才能撐住整段等待時間。 */}
          <RotateCcw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
        </button>

        {/* Notification Bell with Dropdown */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowNotifications(!showNotifications)}
            className="p-2 rounded-xl text-slate-500 hover:text-slate-800 hover:bg-slate-100 relative cursor-pointer"
            title="系統通知"
          >
            <Bell className="h-4 w-4" />
            <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-rose-500 ring-2 ring-white" />
          </button>

          {showNotifications && (
            <div className="absolute right-0 mt-2 w-80 bg-white rounded-2xl shadow-xl border border-slate-200/80 p-4 space-y-3 z-50 animate-in fade-in zoom-in-95 duration-150">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <span className="text-xs font-bold text-slate-800">最新風控通知</span>
                <span className="text-[10px] font-bold text-rose-600 bg-rose-50 px-2 py-0.5 rounded-full">
                  8 件未處理
                </span>
              </div>

              <div className="space-y-2 text-xs">
                <div 
                  onClick={() => {
                    setShowNotifications(false);
                    onNavigate('risk_cases');
                  }}
                  className="p-2.5 rounded-xl bg-rose-50/70 border border-rose-100 hover:bg-rose-100/60 cursor-pointer space-y-1 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-rose-900 flex items-center gap-1.5">
                      <AlertTriangle className="h-3.5 w-3.5 text-rose-600" />
                      高風險案件待處理
                    </span>
                    <span className="text-[10px] text-rose-500 font-mono">10:31</span>
                  </div>
                  <p className="text-[11px] text-slate-600">
                    VF-20260818-003 偵測到動態環境光影異常，已列入佇列。
                  </p>
                </div>

                <div 
                  onClick={() => {
                    setShowNotifications(false);
                    onNavigate('records');
                  }}
                  className="p-2.5 rounded-xl bg-sky-50/70 border border-sky-100 hover:bg-sky-100/60 cursor-pointer space-y-1 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-sky-900 flex items-center gap-1.5">
                      <ShieldCheck className="h-3.5 w-3.5 text-sky-600" />
                      人工審核待確認
                    </span>
                    <span className="text-[10px] text-sky-500 font-mono">10:38</span>
                  </div>
                  <p className="text-[11px] text-slate-600">
                    VF-20260818-002 證件邊緣反光，請專員進行二次確認。
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  setShowNotifications(false);
                  onNavigate('records');
                }}
                className="w-full py-1.5 text-center text-xs font-bold text-sky-600 hover:text-sky-700 block border-t border-slate-100 pt-2 cursor-pointer"
              >
                查看全部通知
              </button>
            </div>
          )}
        </div>

        {/* Switch to User Portal (Quick button) */}
        <button
          type="button"
          onClick={onSwitchToUserPortal}
          className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-sky-50 text-sky-700 hover:bg-sky-100 border border-sky-200/80 text-xs font-bold transition-colors cursor-pointer"
        >
          <Smartphone className="h-3.5 w-3.5" />
          <span>開戶前台</span>
        </button>

        {/* Admin Profile */}
        <div className="flex items-center gap-2.5 pl-2 border-l border-slate-200">
          <div className="h-8 w-8 rounded-full bg-sky-600 text-white flex items-center justify-center text-xs font-bold shadow-xs">
            陳
          </div>
          <div className="hidden sm:block text-left text-xs leading-tight">
            <div className="font-bold text-slate-900">陳專員</div>
            <div className="text-[10px] text-slate-400">高級風控審核師</div>
          </div>
        </div>

        {/* Logout Button */}
        <button
          type="button"
          onClick={onLogout}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200 text-slate-600 text-xs font-bold transition-colors cursor-pointer shadow-2xs"
          title="登出後台管理系統"
        >
          <LogOut className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">登出</span>
        </button>
      </div>
    </header>
  );
};
