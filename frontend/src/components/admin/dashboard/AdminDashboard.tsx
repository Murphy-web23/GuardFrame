import React from 'react';
import { 
  DashboardStats, 
  DailyTrendItem, 
  RiskDistributionItem, 
  VerificationRecord, 
  SystemService, 
  RiskAlert,
  AdminNavSection
} from '../../../types';
import { RiskAlertBanner } from './RiskAlertBanner';
import { KpiCards } from './KpiCards';
import { VerificationTrendChart } from './VerificationTrendChart';
import { RiskDistributionChart } from './RiskDistributionChart';
import { RecentVerificationsTable } from './RecentVerificationsTable';
import { SystemStatusWidget } from './SystemStatusWidget';

interface AdminDashboardProps {
  stats: DashboardStats;
  trendData: DailyTrendItem[];
  riskDistribution: RiskDistributionItem[];
  recentRecords: VerificationRecord[];
  services: SystemService[];
  alerts: RiskAlert[];
  onSelectRecord: (record: VerificationRecord) => void;
  onNavigateSection: (section: AdminNavSection) => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  stats,
  trendData,
  riskDistribution,
  recentRecords,
  services,
  alerts,
  onSelectRecord,
  onNavigateSection,
}) => {
  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* 1. Priority Risk Alert Banner */}
      <RiskAlertBanner alerts={alerts} onNavigate={onNavigateSection} />

      {/* 2. KPI Summary Cards */}
      <KpiCards stats={stats} />

      {/* 3. Middle Visual Analytics Row: Verification Trend (7 cols) + Risk Distribution (5 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        <div className="lg:col-span-7">
          <VerificationTrendChart trendData={trendData} />
        </div>
        <div className="lg:col-span-5">
          <RiskDistributionChart data={riskDistribution} />
        </div>
      </div>

      {/* 4. Recent Verifications Table */}
      <RecentVerificationsTable
        records={recentRecords}
        onSelectRecord={onSelectRecord}
        onNavigateSection={onNavigateSection}
      />

      {/* 5. System Status & Guardian Widget */}
      <SystemStatusWidget services={services} />
    </div>
  );
};
