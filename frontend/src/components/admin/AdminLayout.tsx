import React, { useEffect, useState } from 'react';
import {
  AdminNavSection,
  VerificationRecord,
  DashboardStats,
  RiskDistributionItem,
  RiskAlert,
} from '../../types';
import {
  mockVerificationTrend,
  mockSystemServices,
} from '../../data/adminMockData';
import { listAdminRecords, ApiError, BackendVerificationRecord } from '../../api/client';
import { getStoredAdminToken } from '../../data/mockAuth';
import { AdminSidebar } from './AdminSidebar';
import { AdminHeader } from './AdminHeader';
import { AdminDashboard } from './dashboard/AdminDashboard';
import { VerificationRecordsView } from './views/VerificationRecordsView';
import { RiskCasesView } from './views/RiskCasesView';
import { SystemStatusView } from './views/SystemStatusView';
import { VerificationDetailModal } from './common/VerificationDetailModal';

interface AdminLayoutProps {
  onSwitchToUserPortal: () => void;
  onLogout: () => void;
}

// 2026-08-20：後台改接真的 GET /api/admin/records。後端的 decision.verdict
// 只有 pass/review/reject 三種，前端原本設計了 5 種狀態
// （passed/pending/high_risk/failed/flagged），這裡做映射，'flagged' 沒有
// 對應的後端概念，不會從真的資料出現（維持給人工操作用，見下面
// handleUpdateRecordStatus 的說明）。riskLevel 的切點直接照後端自己
// 的決策區間（config.RISK_PASS_MAX=30／RISK_REVIEW_MAX=60）換算，兩邊
// 用同一套標準。
function mapBackendRecord(rec: BackendVerificationRecord): VerificationRecord {
  const statusMap: Record<string, VerificationRecord['verificationStatus']> = {
    pass: 'passed',
    review: 'pending',
    reject: 'failed',
  };
  const riskLevel: VerificationRecord['riskLevel'] =
    rec.decision.riskScore <= 30 ? 'low' : rec.decision.riskScore <= 60 ? 'medium' : 'high';
  const handlingStatus: VerificationRecord['handlingStatus'] =
    rec.decision.verdict === 'review' ? 'manual_review' : 'completed';

  return {
    id: rec.id,
    applicantName: rec.applicantName,
    idNumberMasked: rec.applicantIdMasked,
    timestamp: rec.timestamp,
    verificationStatus: statusMap[rec.decision.verdict] || 'pending',
    riskLevel,
    method: `身分證 + 人臉活體（${rec.sourceType}）`,
    handlingStatus,
    durationSec: Math.round(rec.recording.durationSec),
    notes: rec.decision.reasons.length > 0 ? rec.decision.reasons.join('；') : '核驗通過',
  };
}

function computeStats(records: VerificationRecord[]): DashboardStats {
  const total = records.length;
  const passedCount = records.filter((r) => r.verificationStatus === 'passed').length;
  const pendingCount = records.filter((r) => r.verificationStatus === 'pending').length;
  const failedCount = records.filter((r) => r.verificationStatus === 'failed').length;
  // 後端沒有獨立的「高風險」狀態（只有 pass/review/reject 三種），
  // 這裡用 riskLevel === 'high' 當作高風險案件數，跟 failedCount
  // 可能重疊（風險分數 > 60 同時也是 reject），是資料模型本身的限制，
  // 不是算錯。
  const highRiskCount = records.filter((r) => r.riskLevel === 'high').length;
  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 1000) / 10 : 0);

  return {
    totalToday: total,
    // 沒有「昨天」的資料可以比較，不假造變化率
    totalChangePercent: 0,
    passedCount,
    passRatePercent: pct(passedCount),
    pendingCount,
    pendingNote: '需要人工確認',
    highRiskCount,
    highRiskNote: '需要優先處理',
    failedCount,
    failedPercent: pct(failedCount),
  };
}

function computeRiskAlerts(stats: DashboardStats): RiskAlert[] {
  const alerts: RiskAlert[] = [];
  if (stats.highRiskCount > 0) {
    alerts.push({
      id: 'alert-high-risk',
      type: 'high_risk',
      title: '高風險案件',
      count: stats.highRiskCount,
      description: '件案件風險分數偏高，需要優先處理',
      actionText: '查看風險案件',
      targetNav: 'risk_cases',
    });
  }
  if (stats.pendingCount > 0) {
    alerts.push({
      id: 'alert-pending',
      type: 'pending_review',
      title: '待人工審核',
      count: stats.pendingCount,
      description: '件驗證系統判定為人工複核，需要人工確認',
      actionText: '前往審核清單',
      targetNav: 'records',
    });
  }
  return alerts;
}

function computeRiskDistribution(records: VerificationRecord[]): RiskDistributionItem[] {
  const total = records.length;
  const counts = { low: 0, medium: 0, high: 0 };
  records.forEach((r) => counts[r.riskLevel]++);
  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 1000) / 10 : 0);

  return [
    { name: '低風險 (Low Risk)', level: 'low', count: counts.low, percent: pct(counts.low), color: '#10B981' },
    { name: '中風險 (Medium Risk)', level: 'medium', count: counts.medium, percent: pct(counts.medium), color: '#0EA5E9' },
    { name: '高風險 (High Risk)', level: 'high', count: counts.high, percent: pct(counts.high), color: '#F43F5E' },
  ];
}

export const AdminLayout: React.FC<AdminLayoutProps> = ({ onSwitchToUserPortal, onLogout }) => {
  const [currentSection, setCurrentSection] = useState<AdminNavSection>('dashboard');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState<boolean>(false);
  const [selectedRecord, setSelectedRecord] = useState<VerificationRecord | null>(null);

  // Local reactive records state so actions in modal reflect on table
  const [records, setRecords] = useState<VerificationRecord[]>([]);
  const [isLoadingRecords, setIsLoadingRecords] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string>('');

  useEffect(() => {
    const token = getStoredAdminToken();
    if (!token) {
      setLoadError('登入憑證遺失，請重新登入');
      setIsLoadingRecords(false);
      return;
    }
    listAdminRecords(token, { limit: 200 })
      .then((res) => setRecords(res.records.map(mapBackendRecord)))
      .catch((err) => {
        setLoadError(
          err instanceof ApiError ? err.message : '無法連線到後端伺服器，請確認伺服器是否已啟動'
        );
      })
      .finally(() => setIsLoadingRecords(false));
  }, []);

  const stats = computeStats(records);
  const riskDistribution = computeRiskDistribution(records);
  const riskAlerts = computeRiskAlerts(stats);

  // 後端目前沒有任何「行員手動更新紀錄狀態」的端點（沒有 PATCH
  // /api/admin/records/{id} 這種東西），這裡維持原本的純前端本地狀態
  // 變更，不假裝呼叫了後端——重新整理頁面後這個操作不會被記住，
  // 這是後端目前真實的能力邊界，不是這次改動漏做。
  const handleUpdateRecordStatus = (recordId: string, actionName: string) => {
    setRecords((prev) =>
      prev.map((rec) => {
        if (rec.id === recordId) {
          if (actionName.includes('核准')) {
            return {
              ...rec,
              verificationStatus: 'passed',
              riskLevel: 'low',
              handlingStatus: 'completed',
              notes: '專員人工核准通過',
            };
          } else if (actionName.includes('補件')) {
            return {
              ...rec,
              verificationStatus: 'flagged',
              riskLevel: 'low',
              handlingStatus: 'completed',
              notes: '已發送補件通知，案件標記處理完成',
            };
          } else if (actionName.includes('分行')) {
            return {
              ...rec,
              verificationStatus: 'flagged',
              riskLevel: 'low',
              handlingStatus: 'completed',
              notes: '已通知前往實體分行辦理，案件標記處理完成',
            };
          } else if (actionName.includes('人工')) {
            return {
              ...rec,
              verificationStatus: 'pending',
              handlingStatus: 'manual_review',
              notes: '已轉由人工二次審查',
            };
          }
        }
        return rec;
      })
    );
  };

  return (
    <div className="flex h-screen bg-slate-100/60 overflow-hidden font-sans text-slate-900">
      {/* Desktop Sidebar (hidden on mobile) */}
      <div className="hidden md:flex shrink-0">
        <AdminSidebar
          currentSection={currentSection}
          onNavigate={(sec) => {
            setCurrentSection(sec);
            setMobileSidebarOpen(false);
          }}
          onSwitchToUserPortal={onSwitchToUserPortal}
          onLogout={onLogout}
        />
      </div>

      {/* Mobile Drawer Sidebar */}
      {mobileSidebarOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          <div 
            className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs" 
            onClick={() => setMobileSidebarOpen(false)} 
          />
          <div className="relative z-10 w-64 bg-white shadow-2xl h-full">
            <AdminSidebar
              currentSection={currentSection}
              onNavigate={(sec) => {
                setCurrentSection(sec);
                setMobileSidebarOpen(false);
              }}
              onSwitchToUserPortal={onSwitchToUserPortal}
              onLogout={onLogout}
            />
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <AdminHeader
          currentSection={currentSection}
          onNavigate={setCurrentSection}
          onSwitchToUserPortal={onSwitchToUserPortal}
          onLogout={onLogout}
          onToggleMobileSidebar={() => setMobileSidebarOpen(!mobileSidebarOpen)}
        />

        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          {loadError && (
            <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs font-semibold text-rose-700">
              {loadError}
            </div>
          )}
          {isLoadingRecords && !loadError && (
            <div className="mb-4 p-3 rounded-xl bg-sky-50 border border-sky-200 text-xs font-semibold text-sky-700">
              正在載入驗證紀錄…
            </div>
          )}

          {currentSection === 'dashboard' && (
            <AdminDashboard
              stats={stats}
              trendData={mockVerificationTrend}
              riskDistribution={riskDistribution}
              recentRecords={records}
              services={mockSystemServices}
              alerts={riskAlerts}
              onSelectRecord={setSelectedRecord}
              onNavigateSection={setCurrentSection}
            />
          )}

          {currentSection === 'records' && (
            <VerificationRecordsView
              records={records}
              onSelectRecord={setSelectedRecord}
              onNavigateSection={setCurrentSection}
            />
          )}

          {currentSection === 'risk_cases' && (
            <RiskCasesView
              records={records}
              onSelectRecord={setSelectedRecord}
              onNavigateSection={setCurrentSection}
            />
          )}

          {currentSection === 'system_status' && (
            <SystemStatusView
              services={mockSystemServices}
              onNavigateSection={setCurrentSection}
            />
          )}

          {currentSection === 'settings' && (
            <div className="max-w-3xl mx-auto bg-white p-8 rounded-3xl border border-slate-200/80 shadow-xs space-y-6">
              <h2 className="text-xl font-black text-slate-900">風控與核驗規則參數設定</h2>
              <p className="text-xs text-slate-500">
                此處為金管會數位存款帳戶驗證準則之核心參數設定。
              </p>
              <div className="p-4 bg-sky-50 rounded-2xl border border-sky-100 text-xs text-sky-800">
                目前使用標準金融級高嚴格度防偽模式 (Strict Mode)。
              </div>
              <button
                type="button"
                onClick={() => setCurrentSection('dashboard')}
                className="px-5 py-2.5 rounded-xl bg-sky-500 text-white text-xs font-bold hover:bg-sky-600 cursor-pointer"
              >
                返回總覽 Dashboard
              </button>
            </div>
          )}
        </main>
      </div>

      {/* Verification Detail Modal */}
      <VerificationDetailModal
        record={selectedRecord}
        onClose={() => setSelectedRecord(null)}
        onUpdateStatus={handleUpdateRecordStatus}
      />
    </div>
  );
};
