import React, { useState, useMemo } from 'react';
import { VerificationRecord, VerificationStatus, AdminNavSection } from '../../../types';
import { StatusBadge, HandlingStatusBadge } from '../common/StatusBadge';
import { RiskBadge } from '../common/RiskBadge';
import { 
  Search, 
  Filter, 
  ChevronRight, 
  ExternalLink, 
  Eye, 
  ArrowUpDown,
  FileCheck,
  Calendar,
  Check
} from 'lucide-react';

interface RecentVerificationsTableProps {
  records: VerificationRecord[];
  onSelectRecord: (record: VerificationRecord) => void;
  onNavigateSection?: (section: AdminNavSection) => void;
}

export const RecentVerificationsTable: React.FC<RecentVerificationsTableProps> = ({
  records,
  onSelectRecord,
  onNavigateSection
}) => {
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'all' | VerificationStatus>('all');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Filter logic。'high_risk' 這個 tab 篩的是 riskLevel（後端 decision.
  // riskScore 換算出來的三段風險等級），不是 verificationStatus——
  // 真的資料只會有 passed/pending/failed 三種 verificationStatus（見
  // AdminLayout.tsx 的 mapBackendRecord 映射說明，後端沒有獨立的
  // high_risk/flagged 狀態），照 verificationStatus 篩 high_risk 對真的
  // 資料永遠篩不到東西。
  const filteredRecords = useMemo(() => {
    return records.filter((rec) => {
      const matchSearch =
        rec.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
        rec.applicantName.includes(searchTerm) ||
        rec.idNumberMasked.toLowerCase().includes(searchTerm.toLowerCase());

      const matchStatus =
        statusFilter === 'all' ||
        (statusFilter === 'high_risk' ? rec.riskLevel === 'high' : rec.verificationStatus === statusFilter);

      return matchSearch && matchStatus;
    });
  }, [records, searchTerm, statusFilter]);

  const pendingCount = useMemo(
    () => records.filter((r) => r.verificationStatus === 'pending').length,
    [records]
  );
  const highRiskCount = useMemo(
    () => records.filter((r) => r.riskLevel === 'high').length,
    [records]
  );

  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) => 
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleSelectAll = () => {
    if (selectedIds.length === filteredRecords.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredRecords.map((r) => r.id));
    }
  };

  return (
    <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden">
      {/* Table Header & Controls */}
      <div className="p-5 border-b border-slate-100 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
              <FileCheck className="h-4 w-4 text-sky-600" />
              最近驗證紀錄 (Recent Verifications)
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              即時接收來自開戶前台之身分驗證與活體核驗紀錄
            </p>
          </div>

          {onNavigateSection && (
            <button
              type="button"
              onClick={() => onNavigateSection('records')}
              className="text-xs font-bold text-sky-600 hover:text-sky-700 flex items-center gap-1 self-start sm:self-auto cursor-pointer"
            >
              <span>查看完整驗證紀錄庫</span>
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Search & Filter Bar */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          {/* Status Tabs */}
          <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
            {[
              { key: 'all', label: '全部' },
              { key: 'pending', label: `待審核 (${pendingCount})` },
              { key: 'high_risk', label: `高風險 (${highRiskCount})` },
              { key: 'passed', label: '已通過' },
              { key: 'failed', label: '未通過' },
            ].map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setStatusFilter(tab.key as any)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all cursor-pointer ${
                  statusFilter === tab.key
                    ? 'bg-sky-500 text-white shadow-xs'
                    : 'bg-slate-100/80 text-slate-600 hover:bg-slate-200/70'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Search Input */}
          <div className="relative min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="搜尋案件 ID、姓名或身分證..."
              className="w-full text-xs pl-9 pr-4 py-2 rounded-xl border border-slate-200 bg-slate-50/70 focus:bg-white focus:border-sky-400 focus:outline-hidden focus:ring-2 focus:ring-sky-100 transition-all placeholder:text-slate-400"
            />
          </div>
        </div>
      </div>

      {/* Desktop Table */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50/70 text-slate-500 font-bold border-b border-slate-200/80">
            <tr>
              <th className="py-3 px-4 w-10">
                <input
                  type="checkbox"
                  checked={selectedIds.length > 0 && selectedIds.length === filteredRecords.length}
                  onChange={handleSelectAll}
                  className="rounded border-slate-300 text-sky-600 focus:ring-sky-400 cursor-pointer"
                />
              </th>
              <th className="py-3 px-4">驗證 ID</th>
              <th className="py-3 px-4">申請人 / 身分證</th>
              <th className="py-3 px-4">驗證時間</th>
              <th className="py-3 px-4">驗證狀態</th>
              <th className="py-3 px-4">風險等級</th>
              <th className="py-3 px-4">核驗方式</th>
              <th className="py-3 px-4">處理狀態</th>
              <th className="py-3 px-4 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-700">
            {filteredRecords.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-8 text-center text-slate-400 text-xs">
                  查無符合條件之驗證紀錄
                </td>
              </tr>
            ) : (
              filteredRecords.map((rec) => {
                const isSelected = selectedIds.includes(rec.id);
                return (
                  <tr
                    key={rec.id}
                    onClick={() => onSelectRecord(rec)}
                    className={`hover:bg-sky-50/40 transition-colors cursor-pointer ${
                      isSelected ? 'bg-sky-50/60' : ''
                    }`}
                  >
                    <td className="py-3.5 px-4" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => handleToggleSelect(rec.id)}
                        className="rounded border-slate-300 text-sky-600 focus:ring-sky-400 cursor-pointer"
                      />
                    </td>
                    <td className="py-3.5 px-4 font-mono font-bold text-sky-700">
                      {rec.id}
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="font-bold text-slate-900">{rec.applicantName}</div>
                      <div className="text-[11px] font-mono text-slate-400">{rec.idNumberMasked}</div>
                    </td>
                    <td className="py-3.5 px-4 text-slate-500 font-mono">
                      {rec.timestamp}
                    </td>
                    <td className="py-3.5 px-4">
                      <StatusBadge status={rec.verificationStatus} size="sm" />
                    </td>
                    <td className="py-3.5 px-4">
                      <RiskBadge level={rec.riskLevel} />
                    </td>
                    <td className="py-3.5 px-4 text-slate-600">
                      {rec.method}
                    </td>
                    <td className="py-3.5 px-4">
                      <HandlingStatusBadge status={rec.handlingStatus} />
                    </td>
                    <td className="py-3.5 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => onSelectRecord(rec)}
                        className="p-1.5 rounded-lg bg-slate-100 hover:bg-sky-50 hover:text-sky-700 text-slate-500 transition-colors cursor-pointer inline-flex items-center gap-1 font-semibold text-[11px]"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        <span>檢視</span>
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile Card List View (< 768px) */}
      <div className="block md:hidden divide-y divide-slate-100">
        {filteredRecords.length === 0 ? (
          <div className="p-6 text-center text-slate-400 text-xs">
            查無符合條件之驗證紀錄
          </div>
        ) : (
          filteredRecords.map((rec) => (
            <div
              key={rec.id}
              onClick={() => onSelectRecord(rec)}
              className="p-4 space-y-2 hover:bg-sky-50/40 transition-colors cursor-pointer"
            >
              <div className="flex items-center justify-between">
                <span className="font-mono font-bold text-sky-700 text-xs">
                  {rec.id}
                </span>
                <span className="text-[11px] font-mono text-slate-400">{rec.timestamp}</span>
              </div>
              
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-bold text-slate-900 text-sm">{rec.applicantName}</span>
                  <span className="ml-2 font-mono text-xs text-slate-400">{rec.idNumberMasked}</span>
                </div>
                <StatusBadge status={rec.verificationStatus} size="sm" />
              </div>

              <div className="flex items-center justify-between pt-1 text-xs">
                <RiskBadge level={rec.riskLevel} />
                <HandlingStatusBadge status={rec.handlingStatus} />
              </div>
            </div>
          ))
        )}
      </div>

      {/* Table Footer */}
      <div className="p-4 bg-slate-50/50 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
        <span>顯示 {filteredRecords.length} 筆案件資料 (共 {records.length} 筆)</span>
        <span className="text-[11px]">即時更新頻率：每 10 秒</span>
      </div>
    </div>
  );
};
