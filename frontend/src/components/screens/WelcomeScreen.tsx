import React from 'react';
import { AIGuardian } from '../AIGuardian';
import { ArrowRight, ShieldCheck, Sparkles, Camera, UserCheck, AlertCircle } from 'lucide-react';

interface WelcomeScreenProps {
  onStart: () => void;
}

export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({ onStart }) => {
  return (
    <div className="flex flex-col justify-between flex-1 px-5 pt-4 pb-7 bg-white text-center select-none">
      {/* Top Brand Tag */}
      <div className="flex justify-center">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-sky-50 text-sky-700 text-xs font-bold border border-sky-100/80">
          <Sparkles className="h-3.5 w-3.5 text-sky-500" />
          <span>GuardFrame</span>
        </div>
      </div>

      {/* Main Focal Point: Mascot + Core Message */}
      <div className="my-auto py-2 flex flex-col items-center space-y-4">
        {/* Guardian Mascot */}
        <div className="relative">
          <AIGuardian size="lg" mood="welcoming" showBadge={true} />
        </div>

        {/* Core Headline & Subtitle */}
        <div className="space-y-1.5 max-w-[280px] mx-auto">
          <h1 className="text-2xl font-black text-slate-900 tracking-tight leading-snug">
            安全開戶，<br />就從這裡開始
          </h1>
          <p className="text-xs font-medium text-slate-500">
            簡單完成數位身分核驗，全程約需 3 分鐘。
          </p>
        </div>

        {/* 申請須知與提醒卡片：拍攝裝置提醒 + 申請年齡提醒 */}
        <div className="w-full max-w-[320px] mx-auto rounded-2xl bg-slate-50/90 border border-slate-200/80 p-3.5 text-left space-y-2.5 shadow-2xs">
          <div className="flex items-center justify-between border-b border-slate-200/60 pb-1.5">
            <span className="text-[11px] font-bold text-slate-700 flex items-center gap-1">
              <ShieldCheck className="h-3.5 w-3.5 text-sky-600" />
              開戶前貼心提醒
            </span>
            <span className="text-[10px] text-slate-400 font-medium">線上申辦須知</span>
          </div>

          {/* 拍攝裝置提醒 */}
          <div className="flex items-start gap-2 text-xs">
            <div className="h-5 w-5 rounded-lg bg-sky-100/80 text-sky-700 flex items-center justify-center shrink-0 mt-0.5">
              <Camera className="h-3 w-3" />
            </div>
            <div>
              <p className="font-bold text-slate-800 text-[11px]">拍攝裝置提醒</p>
              <p className="text-[11px] text-slate-500 leading-tight mt-0.5">
                請確認裝置具備清晰相機鏡頭，以便進行證件拍攝與人臉活體核驗。
              </p>
            </div>
          </div>

          {/* 申請年齡提醒 */}
          <div className="flex items-start gap-2 text-xs">
            <div className="h-5 w-5 rounded-lg bg-emerald-100/80 text-emerald-700 flex items-center justify-center shrink-0 mt-0.5">
              <UserCheck className="h-3 w-3" />
            </div>
            <div>
              <p className="font-bold text-slate-800 text-[11px]">申請年齡提醒</p>
              <p className="text-[11px] text-slate-500 leading-tight mt-0.5">
                申請人須年滿 18 歲之中華民國國民，並備妥本人實體身分證正本。
              </p>
            </div>
          </div>
        </div>

        {/* Ultra-light reassurance pill */}
        <div className="inline-flex items-center gap-1.5 text-[11px] text-slate-400 font-medium">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          <span>金融級加密傳輸 • 資料全程受嚴密保護</span>
        </div>
      </div>

      {/* Primary CTA */}
      <div className="w-full pt-2">
        <button
          type="button"
          onClick={onStart}
          className="w-full py-3.5 px-6 rounded-2xl bg-sky-500 hover:bg-sky-600 active:bg-sky-700 text-white font-black text-base shadow-lg shadow-sky-500/25 flex items-center justify-center gap-2 transition-all cursor-pointer"
        >
          <span>開始驗證</span>
          <ArrowRight className="h-4 w-4 stroke-[2.5]" />
        </button>
      </div>
    </div>
  );
};
