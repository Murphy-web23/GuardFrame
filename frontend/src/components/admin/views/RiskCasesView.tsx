import React from 'react';
import { VerificationRecord, AdminNavSection } from '../../../types';
import { RecentVerificationsTable } from '../dashboard/RecentVerificationsTable';
import { ArrowLeft, ShieldAlert, AlertTriangle } from 'lucide-react';

interface RiskCasesViewProps {
  records: VerificationRecord[];
  onSelectRecord: (record: VerificationRecord) => void;
  onNavigateSection: (section: AdminNavSection) => void;
}

export const RiskCasesView: React.FC<RiskCasesViewProps> = ({
  records,
  onSelectRecord,
  onNavigateSection,
}) => {
  const highRiskRecords = records.filter(
    (r) => r.riskLevel === 'high' || r.verificationStatus === 'high_risk' || r.handlingStatus === 'action_required'
  );

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="bg-rose-50/60 p-6 rounded-3xl border border-rose-200/80 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <button
            type="button"
            onClick={() => onNavigateSection('dashboard')}
            className="inline-flex items-center gap-2 px-3.5 py-1.5 mb-3 rounded-xl bg-white/90 hover:bg-white text-rose-800 hover:text-rose-950 font-bold text-sm border border-rose-200 shadow-2xs cursor-pointer transition-all duration-150 group"
          >
            <ArrowLeft className="h-4 w-4 text-rose-700 group-hover:-translate-x-0.5 transition-transform" />
            <span>返回 Dashboard 總覽</span>
          </button>
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-xl bg-rose-500 text-white flex items-center justify-center">
              <ShieldAlert className="h-4 w-4" />
            </div>
            <h1 className="text-xl font-black text-rose-950">
              高風險案件優先審核佇列 (Priority Risk Cases)
            </h1>
          </div>
          <p className="text-xs text-rose-700 mt-1.5">
            共 {highRiskRecords.length} 件高風險案件需要人工專員介入核驗與判定。
          </p>
        </div>
      </div>

      {/* Filtered Table */}
      <RecentVerificationsTable
        records={highRiskRecords}
        onSelectRecord={onSelectRecord}
      />
    </div>
  );
};
