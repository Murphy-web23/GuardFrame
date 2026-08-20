import React from 'react';
import { VerificationRecord, AdminNavSection } from '../../../types';
import { RecentVerificationsTable } from '../dashboard/RecentVerificationsTable';
import { ArrowLeft, FileCheck, Filter, Download } from 'lucide-react';

interface VerificationRecordsViewProps {
  records: VerificationRecord[];
  onSelectRecord: (record: VerificationRecord) => void;
  onNavigateSection: (section: AdminNavSection) => void;
}

export const VerificationRecordsView: React.FC<VerificationRecordsViewProps> = ({
  records,
  onSelectRecord,
  onNavigateSection,
}) => {
  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-3xl border border-slate-200/80 shadow-xs">
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
            <FileCheck className="h-5 w-5 text-sky-600" />
            身分驗證紀錄總庫 (Verification Records)
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            提供銀行風控專員檢索歷史開戶核驗、OCR 證件辨識與人臉特徵比對案件
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => alert('已匯出今日驗證審核紀錄報表 (CSV)')}
            className="px-4 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold text-slate-700 flex items-center gap-1.5 cursor-pointer"
          >
            <Download className="h-3.5 w-3.5 text-slate-500" />
            <span>匯出報表</span>
          </button>
        </div>
      </div>

      {/* Verification Records Table */}
      <RecentVerificationsTable
        records={records}
        onSelectRecord={onSelectRecord}
      />
    </div>
  );
};
