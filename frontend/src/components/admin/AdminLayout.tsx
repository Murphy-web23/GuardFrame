import React, { useCallback, useEffect, useState } from 'react';
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
import {
  listAdminRecords,
  resolveAdminRecord,
  AdminRecordAction,
  ApiError,
  BackendVerificationRecord,
} from '../../api/client';
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
    recordId: rec.recordId,
    applicantId: rec.applicantId,
    applicantName: rec.applicantName,
    idNumberMasked: rec.applicantIdMasked,
    timestamp: rec.timestamp,
    verificationStatus: statusMap[rec.decision.verdict] || 'pending',
    riskLevel,
    riskScore: rec.decision.riskScore,
    method: `身分證 + 人臉活體（${rec.sourceType}）`,
    handlingStatus,
    durationSec: Math.round(rec.recording.durationSec),
    notes: rec.decision.reasons.length > 0 ? rec.decision.reasons.join('；') : '核驗通過',
    vlmSummary: rec.vlmSummary,
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

  // 2026-08-31：「今日驗證」原本直接用 records.length（抓回來的全部
  // 紀錄數，不是只有今天），標籤跟實際數字對不上。record.timestamp
  // 是後端用伺服器當地時間格式化的 "YYYY-MM-DD HH:MM:SS" 字串，取前
  // 10 碼日期跟瀏覽器本地日期字串比對即可，不用額外處理時區轉換——
  // 展示環境的伺服器跟使用者都在同一個時區。
  const todayStr = new Date().toLocaleDateString('sv-SE'); // "YYYY-MM-DD"
  const totalToday = records.filter((r) => r.timestamp.startsWith(todayStr)).length;

  return {
    totalToday,
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

  // 2026-08-30：抽成獨立函式，讓 AdminHeader 的「重新整理」按鈕能重用同一段
  // 邏輯——原本這段只寫在 useEffect 裡、只在掛載時跑一次，畫面上的「重新
  // 整理」按鈕跟「即時更新頻率：每 10 秒」都只是裝飾，按下去只有圖示轉一圈、
  // 沒有真的重新打 API。這裡先只修按鈕本身，不做自動輪詢（那個影響面更大，
  // 之後有需要再另外加）。
  const loadRecords = useCallback(async () => {
    const token = getStoredAdminToken();
    if (!token) {
      setLoadError('登入憑證遺失，請重新登入');
      setIsLoadingRecords(false);
      return;
    }
    setLoadError('');
    try {
      const res = await listAdminRecords(token, { limit: 200 });
      setRecords(res.records.map(mapBackendRecord));
    } catch (err) {
      setLoadError(
        err instanceof ApiError ? err.message : '無法連線到後端伺服器，請確認伺服器是否已啟動'
      );
    } finally {
      setIsLoadingRecords(false);
    }
  }, []);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  const stats = computeStats(records);
  const riskDistribution = computeRiskDistribution(records);
  const riskAlerts = computeRiskAlerts(stats);

  // 2026-08-29：改成真的打後端 POST /api/admin/records/{id}/action——
  // 之前這裡只改前端本地狀態、沒有任何後端端點，重新整理頁面後動作
  // 就會消失，通知信也不會真的寄出。現在會先等後端回應（決定案件的
  // 最終判定並寄出對應通知信），再依照真實結果更新本地畫面，失敗時
  // 拋出例外讓 modal 顯示錯誤訊息，不再無條件顯示成功。
  const handleUpdateRecordStatus = async (
    recordId: number,
    action: AdminRecordAction
  ): Promise<{ emailSent: boolean }> => {
    const token = getStoredAdminToken();
    if (!token) {
      throw new Error('登入憑證遺失，請重新登入');
    }
    const result = await resolveAdminRecord(token, recordId, action);

    setRecords((prev) =>
      prev.map((rec) => {
        if (rec.recordId !== recordId) return rec;
        if (action === 'approve') {
          return {
            ...rec,
            verificationStatus: 'passed',
            riskLevel: 'low',
            handlingStatus: 'completed',
            notes: '專員人工核准通過',
          };
        } else if (action === 'request_docs') {
          return {
            ...rec,
            verificationStatus: 'flagged',
            riskLevel: 'low',
            handlingStatus: 'completed',
            notes: '已發送補件通知，案件標記處理完成',
          };
        } else if (action === 'branch_visit') {
          return {
            ...rec,
            verificationStatus: 'flagged',
            riskLevel: 'low',
            handlingStatus: 'completed',
            notes: '已通知前往實體分行辦理，案件標記處理完成',
          };
        }
        return rec;
      })
    );

    return { emailSent: result.emailSent };
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
          recordsCount={records.length}
          riskCasesCount={stats.highRiskCount}
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
              recordsCount={records.length}
              riskCasesCount={stats.highRiskCount}
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
          onRefresh={loadRecords}
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
