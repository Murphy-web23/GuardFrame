import React, { useState } from 'react';
import { VerificationRecord } from '../../../types';
import { StatusBadge, HandlingStatusBadge } from './StatusBadge';
import { RiskBadge } from './RiskBadge';
import { 
  X, 
  User, 
  Calendar, 
  Clock, 
  ShieldCheck, 
  FileText, 
  Check, 
  AlertTriangle,
  RotateCcw,
  CheckCircle2,
  Mail,
  Building2
} from 'lucide-react';

interface VerificationDetailModalProps {
  record: VerificationRecord | null;
  onClose: () => void;
  onUpdateStatus?: (recordId: string, newStatus: string) => void;
}

export const VerificationDetailModal: React.FC<VerificationDetailModalProps> = ({
  record,
  onClose,
  onUpdateStatus
}) => {
  const [reviewNote, setReviewNote] = useState<string>('');
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);

  if (!record) return null;

  const handleAction = (actionType: string) => {
    setFeedbackMsg(`已成功更新案件狀態：${actionType}`);
    if (onUpdateStatus) {
      onUpdateStatus(record.id, actionType);
    }
    setTimeout(() => {
      setFeedbackMsg(null);
      onClose();
    }, 1200);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 sm:p-6 animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full p-6 sm:p-8 space-y-6 max-h-[90vh] overflow-y-auto">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono font-bold text-sky-600 bg-sky-50 px-2 py-0.5 rounded border border-sky-200/60">
                {record.id}
              </span>
              <StatusBadge status={record.verificationStatus} size="sm" />
              <RiskBadge level={record.riskLevel} />
              {record.riskScore !== undefined && (
                <span className="flex items-center gap-1.5">
                  <span className="text-xs font-mono font-bold text-rose-600 bg-rose-50 px-2 py-0.5 rounded border border-rose-200">
                    風險分數 {record.riskScore}
                  </span>
                  <span className="text-[11px] text-slate-400">（分數越高風險越大）</span>
                </span>
              )}
            </div>
            <h2 className="text-lg font-black text-slate-900 mt-2">
              案件身分核驗詳細報告
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="h-8 w-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-200 cursor-pointer transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Feedback Alert */}
        {feedbackMsg && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs font-bold text-emerald-800 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <span>{feedbackMsg}</span>
          </div>
        )}

        {/* Information Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/70 space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <User className="h-3.5 w-3.5 text-sky-600" />
              申請人基本資料
            </p>
            <div className="space-y-1">
              <p className="text-sm font-bold text-slate-900">
                姓名：{record.applicantName}
              </p>
              <p className="text-xs font-mono text-slate-600">
                身分證字號：{record.idNumberMasked}
              </p>
              <p className="text-xs text-slate-500">
                驗證時間：今日 {record.timestamp}
              </p>
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/70 space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
              驗證管道與處理進度
            </p>
            <div className="space-y-1">
              <p className="text-xs text-slate-700">
                <span className="font-semibold">核驗方式：</span>{record.method}
              </p>
              <p className="text-xs text-slate-700">
                <span className="font-semibold">耗時秒數：</span>{record.durationSec} 秒
              </p>
              <div className="flex items-center gap-2 pt-0.5">
                <span className="text-xs font-semibold text-slate-700">處理狀態：</span>
                <HandlingStatusBadge status={record.handlingStatus} />
              </div>
            </div>
          </div>
        </div>

        {/* Case Notes & Audit Overview */}
        <div className="p-4 rounded-2xl bg-sky-50/40 border border-sky-100 space-y-2">
          <p className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
            <FileText className="h-3.5 w-3.5 text-sky-600" />
            風控審核備註與特徵說明
          </p>
          <p className="text-xs text-slate-600 leading-relaxed bg-white/80 p-3 rounded-xl border border-sky-100">
            {record.notes || '本案身分證件與人臉活體特徵比對正常，符合金管會數位存款帳戶開戶核驗準則。'}
          </p>
        </div>

        {/* Manual Review Action Form */}
        <div className="space-y-3 pt-2 border-t border-slate-100">
          <label className="block text-xs font-bold text-slate-700">
            風控審核意見記錄（選填）
          </label>
          <input
            type="text"
            value={reviewNote}
            onChange={(e) => setReviewNote(e.target.value)}
            placeholder="請輸入審核註記（例如：已確認身分證清晰度正常）"
            className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:border-sky-400 focus:outline-hidden focus:ring-2 focus:ring-sky-100 transition-all"
          />
        </div>

        {/* Modal Actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 cursor-pointer"
          >
            關閉視窗
          </button>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => handleAction('發送補件通知')}
              className="px-4 py-2.5 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              <Mail className="h-3.5 w-3.5" />
              <span>發送補件通知</span>
            </button>

            <button
              type="button"
              onClick={() => handleAction('通知前往實體分行')}
              className="px-4 py-2.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-800 border border-rose-200 text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              <Building2 className="h-3.5 w-3.5" />
              <span>通知前往實體分行</span>
            </button>

            <button
              type="button"
              onClick={() => handleAction('核准通過')}
              className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              <Check className="h-3.5 w-3.5" />
              <span>確認核准通過</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
