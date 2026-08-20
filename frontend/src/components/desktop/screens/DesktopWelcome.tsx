import React from 'react';
import { AIGuardian } from '../../AIGuardian';
import { ArrowRight, ShieldCheck, Sparkles, Clock, CheckCircle2, Camera, UserCheck, Smartphone } from 'lucide-react';

interface DesktopWelcomeProps {
  onStart: () => void;
}

export const DesktopWelcome: React.FC<DesktopWelcomeProps> = ({ onStart }) => {
  return (
    <div className="flex flex-col justify-center min-h-[480px] py-6 px-4 sm:px-8 max-w-5xl mx-auto">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center bg-white/90 p-8 sm:p-10 rounded-3xl border border-slate-200/80 shadow-xs">
        {/* Left Column: Brand & Mascot Presentation (5 cols) */}
        <div className="lg:col-span-5 flex flex-col items-center justify-center p-8 rounded-3xl bg-gradient-to-b from-sky-50/70 via-sky-50/30 to-emerald-50/30 border border-sky-100/80 text-center">
          <div className="relative">
            <AIGuardian size="xl" mood="welcoming" showBadge={true} />
          </div>

          <div className="mt-5 space-y-1">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white text-sky-700 text-xs font-bold shadow-2xs border border-sky-100">
              <Sparkles className="h-3 w-3 text-sky-500" />
              <span>GuardFrame AI</span>
            </div>
            <p className="text-xs text-slate-400 font-medium pt-1">
              智慧數位身分守護系統
            </p>
          </div>
        </div>

        {/* Right Column: Title, Subtitle, Notices & Primary CTA (7 cols) */}
        <div className="lg:col-span-7 flex flex-col justify-center space-y-5 text-left">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-sky-50 text-sky-700 text-xs font-bold border border-sky-200/70">
              <ShieldCheck className="h-3.5 w-3.5 text-sky-600" />
              <span>數位銀行開戶核驗</span>
            </div>

            <h1 className="text-3xl sm:text-4xl font-black text-slate-900 tracking-tight leading-tight">
              安全開戶，<br />
              就從這裡開始
            </h1>

            <p className="text-sm font-medium text-slate-500 leading-relaxed">
              簡單完成身分驗證，全程約需 3 分鐘。
            </p>
          </div>

          {/* 申請前貼心提醒卡片：拍攝裝置提醒 & 申請年齡提醒 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80">
            {/* 拍攝裝置提醒 */}
            <div className="flex items-start gap-2.5 p-2 rounded-xl bg-white border border-slate-200/60 shadow-2xs">
              <div className="h-7 w-7 rounded-lg bg-sky-100 text-sky-700 flex items-center justify-center shrink-0 mt-0.5">
                <Camera className="h-4 w-4" />
              </div>
              <div className="space-y-0.5">
                <p className="text-xs font-bold text-slate-900">拍攝裝置提醒</p>
                <p className="text-[11px] text-slate-500 leading-snug">
                  請使用具備相機鏡頭之裝置，以進行證件拍攝與人臉活體核驗。
                </p>
              </div>
            </div>

            {/* 申請年齡提醒 */}
            <div className="flex items-start gap-2.5 p-2 rounded-xl bg-white border border-slate-200/60 shadow-2xs">
              <div className="h-7 w-7 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0 mt-0.5">
                <UserCheck className="h-4 w-4" />
              </div>
              <div className="space-y-0.5">
                <p className="text-xs font-bold text-slate-900">申請年齡提醒</p>
                <p className="text-[11px] text-slate-500 leading-snug">
                  申請人須年滿 18 歲之中華民國國民，並備妥本人實體身分證。
                </p>
              </div>
            </div>
          </div>

          {/* 3 Lightweight Trust Indicators */}
          <div className="grid grid-cols-3 gap-3">
            <div className="p-2.5 rounded-2xl bg-slate-50/70 border border-slate-100 flex flex-col items-start">
              <Clock className="h-3.5 w-3.5 text-sky-600 mb-0.5" />
              <span className="text-xs font-bold text-slate-800">約 3 分鐘</span>
              <span className="text-[10px] text-slate-400">快速核驗</span>
            </div>

            <div className="p-2.5 rounded-2xl bg-slate-50/70 border border-slate-100 flex flex-col items-start">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 mb-0.5" />
              <span className="text-xs font-bold text-slate-800">金融級加密</span>
              <span className="text-[10px] text-slate-400">金管會標準</span>
            </div>

            <div className="p-2.5 rounded-2xl bg-slate-50/70 border border-slate-100 flex flex-col items-start">
              <CheckCircle2 className="h-3.5 w-3.5 text-sky-600 mb-0.5" />
              <span className="text-xs font-bold text-slate-800">免跑分行</span>
              <span className="text-[10px] text-slate-400">全程線上辦理</span>
            </div>
          </div>

          {/* Primary CTA Action */}
          <div className="pt-2 flex items-center gap-4">
            <button
              type="button"
              onClick={onStart}
              className="px-8 py-3.5 rounded-2xl bg-sky-500 hover:bg-sky-600 active:bg-sky-700 text-white font-black text-sm sm:text-base shadow-lg shadow-sky-500/25 flex items-center gap-2.5 transition-all cursor-pointer hover:scale-[1.01]"
            >
              <span>開始驗證</span>
              <ArrowRight className="h-4 w-4 stroke-[2.5]" />
            </button>

            <span className="text-xs text-slate-400 font-medium">
              請備妥實體國民身分證正本
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
