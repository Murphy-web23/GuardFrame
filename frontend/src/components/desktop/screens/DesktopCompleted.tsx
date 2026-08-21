import React from 'react';
import { motion } from 'motion/react';
import { FormData } from '../../../types';
import { AIGuardian } from '../../AIGuardian';
import { 
  CheckCircle2, 
  RotateCcw, 
  ShieldCheck, 
  CreditCard, 
  Calendar, 
  FileText,
  Clock,
  Sparkles,
  Home,
  Check
} from 'lucide-react';

interface DesktopCompletedProps {
  formData: FormData;
  onReset: () => void;
}

export const DesktopCompleted: React.FC<DesktopCompletedProps> = ({
  formData,
  onReset,
}) => {
  const cardStyleName = formData.cardStyle === 'style_b' ? '極光冰川白 (限定版)' : '極簡深海藍 (經典版)';
  const notifyName = formData.notificationMethod === 'sms' ? '簡訊通知' : formData.notificationMethod === 'email' ? '電子郵件' : '簡訊 + 電子郵件';
  const todayStr = new Date().toISOString().split('T')[0];

  return (
    <div className="flex flex-col flex-1 justify-center py-6 px-4 sm:px-8 max-w-3xl mx-auto w-full">
      <div className="bg-white p-8 sm:p-10 rounded-3xl border border-slate-200/80 shadow-xs space-y-6">
        {/* Top Success Banner */}
        <div className="flex items-center gap-4 border-b border-slate-100 pb-6">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.4 }}
            className="h-16 w-16 rounded-3xl bg-emerald-50 text-emerald-500 border border-emerald-200 flex items-center justify-center shrink-0 shadow-md"
          >
            <CheckCircle2 className="h-9 w-9 stroke-[2.5]" />
          </motion.div>
          <div>
            <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-md border border-emerald-200">
              開戶申請已送出
            </span>
            <h1 className="text-2xl font-black text-slate-900 tracking-tight mt-1.5">
              開戶申請已完成送審
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">
              感謝您的申請！我們已收到您的開戶資料，審核結果將透過簡訊與 Email 第一時間通知您。
            </p>
          </div>
        </div>

        {/* Case Info Summary */}
        <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-4 text-sm">
          <div className="flex items-center justify-between border-b border-slate-200/60 pb-3">
            <span className="font-bold text-slate-800 flex items-center gap-2">
              <FileText className="h-4 w-4 text-sky-600" />
              <span>開戶案件摘要明細</span>
            </span>
            <span className="font-mono text-xs text-slate-500 bg-white px-2.5 py-1 rounded-md border border-slate-200">
              案件編號：GF-20250520-8820
            </span>
          </div>

          <div className="grid grid-cols-2 gap-4 text-slate-600">
            <div className="flex justify-between py-1 border-b border-slate-100">
              <span className="text-slate-500">申請人姓名</span>
              <span className="font-bold text-slate-900">{formData.fullName || '王小明'}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-100">
              <span className="text-slate-500">身分證字號</span>
              <span className="font-mono font-bold text-slate-900">{formData.idNumber || 'A123456789'}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-100">
              <span className="text-slate-500">驗證手機</span>
              <span className="font-mono font-bold text-slate-900">{formData.phone || '0912345678'}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-100">
              <span className="text-slate-500">金融卡面</span>
              <span className="font-bold text-slate-900">{cardStyleName}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-100">
              <span className="text-slate-500">帳務通知</span>
              <span className="font-bold text-slate-900">{notifyName}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-100">
              <span className="text-slate-500">申請時間</span>
              <span className="font-mono text-slate-700">{todayStr}</span>
            </div>
          </div>
        </div>

        {/* Warm Guidance Box */}
        <div className="p-4 rounded-2xl bg-sky-50/70 border border-sky-100 flex items-start gap-3 text-sm text-sky-900">
          <Clock className="h-5 w-5 text-sky-600 shrink-0 mt-0.5" />
          <div className="leading-relaxed">
            <span className="font-bold">後續作業提示：</span>
            <p className="text-xs text-sky-800 mt-1">
              線上審核一般於 1~2 個工作天內完成。核准通過後將自動啟用網路銀行與 App 登入功能，實體金融卡將以掛號郵寄至您的通訊地址。
            </p>
          </div>
        </div>

        {/* Action Button */}
        <div className="pt-2 flex justify-end">
          <button
            id="desktop-completed-return-home-btn"
            type="button"
            onClick={onReset}
            className="py-3 px-8 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-sm shadow-md flex items-center gap-2 transition-all cursor-pointer"
          >
            <Home className="h-4 w-4" />
            <span>返回首頁</span>
          </button>
        </div>
      </div>
    </div>
  );
};
