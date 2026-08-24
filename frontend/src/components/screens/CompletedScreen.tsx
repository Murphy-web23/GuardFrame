import React from 'react';
import { motion } from 'motion/react';
import { FormData } from '../../types';
import { AIGuardian } from '../AIGuardian';
import { 
  CheckCircle2, 
  RotateCcw, 
  ShieldCheck, 
  CreditCard, 
  Calendar, 
  FileText,
  Clock,
  Sparkles,
  Home
} from 'lucide-react';

interface CompletedScreenProps {
  formData: FormData;
  onReset: () => void;
  onBackStep?: () => void;
}

export const CompletedScreen: React.FC<CompletedScreenProps> = ({
  formData,
  onReset,
}) => {
  const cardStyleName = formData.cardStyle === 'style_b' ? '極光冰川白 (限定版)' : '極簡深海藍 (經典版)';
  const notifyName = formData.notificationMethod === 'sms' ? '簡訊通知' : formData.notificationMethod === 'email' ? '電子郵件' : '簡訊 + 電子郵件';
  const todayStr = new Date().toISOString().split('T')[0];

  return (
    <div className="flex flex-col flex-1 px-5 pt-4 pb-8 bg-white select-none">
      {/* Top Success Illustration & Guardian */}
      <div className="flex flex-col items-center text-center mt-2 mb-5">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.4 }}
          className="relative mb-3"
        >
          <div className="h-16 w-16 rounded-full bg-emerald-50 text-emerald-500 border border-emerald-200 flex items-center justify-center shadow-md">
            <CheckCircle2 className="h-9 w-9 stroke-[2.5]" />
          </div>
          <div className="absolute -bottom-1 -right-1">
            <AIGuardian size="xs" mood="success" />
          </div>
        </motion.div>

        {/* 2026-08-22：verdict === 'review' 的案件也會走到這個完成畫面
            （不再被當成失敗擋下來），但文案要誠實反映「還在人工複核」，
            不能讓使用者誤以為已經核准。 */}
        <span className="text-[11px] font-bold text-emerald-600 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200 mb-1.5">
          {formData.verificationVerdict === 'review' ? '申請案件已受理，待人工複核' : '申請案件已送出'}
        </span>
        <h1 className="text-xl font-black text-slate-900 tracking-tight">
          {formData.verificationVerdict === 'review' ? '開戶申請已送出，正在人工複核' : '開戶申請已完成送審'}
        </h1>
        <p className="text-xs text-slate-500 mt-1 max-w-xs leading-relaxed">
          {formData.verificationVerdict === 'review'
            ? '感謝您的申請！本次人臉驗證系統判定需要人工複核，我們已收到您的完整資料，複核結果將透過簡訊與 Email 第一時間通知您。'
            : '感謝您的申請！我們已收到您的完整資料，審核結果將透過簡訊與 Email 第一時間通知您。'}
        </p>
      </div>

      {/* Application Case Card */}
      <div className="space-y-4 flex-1">
        <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-2.5 text-xs">
          <div className="flex items-center justify-between border-b border-slate-200/60 pb-2">
            <span className="font-bold text-slate-800 flex items-center gap-1.5">
              <FileText className="h-4 w-4 text-sky-600" />
              <span>開戶案件摘要</span>
            </span>
            <span className="font-mono text-[11px] text-slate-500">
              GF-20250520-8820
            </span>
          </div>

          <div className="space-y-1.5 text-slate-600">
            <div className="flex justify-between py-0.5">
              <span className="text-slate-500">申請人姓名</span>
              <span className="font-bold text-slate-900">{formData.fullName || '王小明'}</span>
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-slate-500">身分證字號</span>
              <span className="font-mono font-bold text-slate-900">{formData.idNumber || 'A123456789'}</span>
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-slate-500">驗證手機</span>
              <span className="font-mono font-bold text-slate-900">{formData.phone || '0912345678'}</span>
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-slate-500">金融卡面</span>
              <span className="font-bold text-slate-900">{cardStyleName}</span>
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-slate-500">帳務通知</span>
              <span className="font-bold text-slate-900">{notifyName}</span>
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-slate-500">申請時間</span>
              <span className="font-mono text-slate-700">{todayStr}</span>
            </div>
          </div>
        </div>

        {/* Friendly Guidance Box */}
        <div className="p-3.5 rounded-2xl bg-sky-50/60 border border-sky-100 flex items-start gap-2.5 text-xs text-sky-900">
          <Clock className="h-4 w-4 text-sky-600 shrink-0 mt-0.5" />
          <div className="leading-relaxed">
            <span className="font-bold">溫馨提醒：</span>
            <p className="text-[11px] text-sky-800 mt-0.5">
              線上審核一般於 1~2 個工作天內完成。核准後將自動開通網路銀行，實體金融卡將以掛號寄至您的通訊地址。
            </p>
          </div>
        </div>
      </div>

      {/* Return to Home CTA */}
      <div className="pt-4">
        <button
          id="completed-return-home-btn"
          type="button"
          onClick={onReset}
          className="w-full py-3.5 px-6 rounded-2xl bg-slate-900 hover:bg-slate-800 active:bg-slate-950 text-white font-bold text-sm shadow-md flex items-center justify-center gap-2 transition-all cursor-pointer"
        >
          <Home className="h-4 w-4" />
          <span>返回首頁</span>
        </button>
      </div>
    </div>
  );
};
