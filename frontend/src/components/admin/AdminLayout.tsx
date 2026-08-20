import React, { useState } from 'react';
import { 
  AdminNavSection, 
  VerificationRecord 
} from '../../types';
import { 
  mockDashboardStats, 
  mockVerificationTrend, 
  mockRiskDistribution, 
  mockRecentVerifications, 
  mockSystemServices, 
  mockRiskAlerts 
} from '../../data/adminMockData';
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

export const AdminLayout: React.FC<AdminLayoutProps> = ({ onSwitchToUserPortal, onLogout }) => {
  const [currentSection, setCurrentSection] = useState<AdminNavSection>('dashboard');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState<boolean>(false);
  const [selectedRecord, setSelectedRecord] = useState<VerificationRecord | null>(null);
  
  // Local reactive records state so actions in modal reflect on table
  const [records, setRecords] = useState<VerificationRecord[]>(mockRecentVerifications);
  const [stats, setStats] = useState(mockDashboardStats);

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
          {currentSection === 'dashboard' && (
            <AdminDashboard
              stats={stats}
              trendData={mockVerificationTrend}
              riskDistribution={mockRiskDistribution}
              recentRecords={records}
              services={mockSystemServices}
              alerts={mockRiskAlerts}
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
