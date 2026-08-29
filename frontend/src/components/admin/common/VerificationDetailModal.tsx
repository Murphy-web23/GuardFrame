import React, { useState } from 'react';
import { VerificationRecord } from '../../../types';
import { AdminRecordAction } from '../../../api/client';
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
  Building2,
  Sparkles
} from 'lucide-react';

const ACTION_LABEL: Record<AdminRecordAction, string> = {
  approve: '核准通過',
  request_docs: '發送補件通知',
  branch_visit: '通知前往實體分行',
};

interface VerificationDetailModalProps {
  record: VerificationRecord | null;
  onClose: () => void;
  // 2026-08-29：改成真的打後端 /admin/records/{id}/action（見
  // AdminLayout.tsx handleUpdateRecordStatus），回傳是否真的寄出通知信，
  // 讓這裡可以誠實顯示「已寄出」還是「動作完成但信件寄送失敗」，
  // 不再是點下去就無條件顯示成功的假回饋。
  onUpdateStatus?: (recordId: string, action: AdminRecordAction) => Promise<{ emailSent: boolean }>;
}

export const VerificationDetailModal: React.FC<VerificationDetailModalProps> = ({
  record,
  onClose,
  onUpdateStatus
}) => {
  const [reviewNote, setReviewNote] = useState<string>('');
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  if (!record) return null;

  const handleAction = async (action: AdminRecordAction) => {
    if (!onUpdateStatus || isSubmitting) return;
    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      const result = await onUpdateStatus(record.id, action);
      setFeedbackMsg(
        result.emailSent
          ? `已成功更新案件狀態：${ACTION_LABEL[action]}（通知信已寄出）`
          : `案件狀態已更新：${ACTION_LABEL[action]}（通知信未寄出，請確認信件服務是否已設定）`
      );
      setTimeout(() => {
        setFeedbackMsg(null);
        onClose();
      }, 1500);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '動作執行失敗，請稍後再試');
    } finally {
      setIsSubmitting(false);
    }
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
        {errorMsg && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs font-bold text-rose-800 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-rose-600" />
            <span>{errorMsg}</span>
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

        {/* AI 視覺複核摘要（VLM，FR-37）——只有人工複核案件才有值，刻意排
            在「風控審核備註」之後：複核人員該先看系統判定的實際原因，
            AI 摘要只是補充視覺線索，不是要優先看的內容。跟風控審核備註
            分開一區、用不同底色，因為這裡是系統當下呼叫 VLM 產生的內容，
            不是人工輸入也不是決策依據；available=false 時要清楚講
            「目前無法使用」，不能讓複核人員誤以為是「沒有異常」。見
            vlm_summary/README.md「已知的限制」。
            2026-08-29：沒找到異常的影格（observation 以「未見明顯異常」
            開頭）不顯示秒數列表——這種情況下列出「第 X 秒：未見明顯
            異常」對複核沒有幫助，只有「有話要講」的才值得列出來對應
            時間點。*/}
        {record.vlmSummary && (
          <div className="p-4 rounded-2xl bg-violet-50/50 border border-violet-100 space-y-2">
            <p className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-violet-600" />
              AI 視覺複核摘要
            </p>
            {record.vlmSummary.available ? (
              <div className="space-y-2">
                <p className="text-xs text-slate-600 leading-relaxed bg-white/80 p-3 rounded-xl border border-violet-100">
                  {record.vlmSummary.summary}
                </p>
                {(() => {
                  const flagged = record.vlmSummary!.frameObservations.filter(
                    (obs) => !obs.observation.trim().startsWith('未見明顯異常')
                  );
                  return flagged.length > 0 ? (
                    <ul className="space-y-1">
                      {flagged.map((obs, i) => (
                        <li key={i} className="text-[11px] text-slate-500 flex items-start gap-1.5">
                          <span className="font-mono font-bold text-violet-500 shrink-0">
                            第 {obs.timestampSec} 秒
                          </span>
                          <span>{obs.observation}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null;
                })()}
              </div>
            ) : (
              <p className="text-xs text-slate-500 bg-white/80 p-3 rounded-xl border border-violet-100">
                AI 視覺複核摘要目前無法使用，請直接查看原始異常影格與各層數據。
              </p>
            )}
          </div>
        )}

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
              disabled={isSubmitting}
              onClick={() => handleAction('request_docs')}
              className="px-4 py-2.5 rounded-xl bg-amber-50 hover:bg-amber-100 disabled:opacity-50 disabled:cursor-not-allowed text-amber-800 border border-amber-200 text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              <Mail className="h-3.5 w-3.5" />
              <span>發送補件通知</span>
            </button>

            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => handleAction('branch_visit')}
              className="px-4 py-2.5 rounded-xl bg-rose-50 hover:bg-rose-100 disabled:opacity-50 disabled:cursor-not-allowed text-rose-800 border border-rose-200 text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              <Building2 className="h-3.5 w-3.5" />
              <span>通知前往實體分行</span>
            </button>

            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => handleAction('approve')}
              className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold shadow-xs flex items-center gap-1.5 cursor-pointer transition-colors"
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
