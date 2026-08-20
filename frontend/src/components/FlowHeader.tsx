import React from 'react';
import { OnboardingStep, FormData } from '../types';
import { AIGuardian } from './AIGuardian';
import { ArrowLeft, ShieldCheck, Lock } from 'lucide-react';
import { SessionCountdownBadge } from './common/SessionCountdownBadge';

interface FlowHeaderProps {
  currentStep: OnboardingStep;
  formData?: FormData;
  onBack: () => void;
  onHelp?: () => void;
}

const STEP_INFO: Record<OnboardingStep, { number: number; total: number; title: string }> = {
  welcome: { number: 0, total: 6, title: '歡迎開始' },
  sms_verify: { number: 1, total: 6, title: '手機驗證' },
  id_upload: { number: 2, total: 6, title: '身分證驗證' },
  basic_info: { number: 3, total: 6, title: '資料確認' },
  face_verify: { number: 4, total: 6, title: '人臉驗證' },
  feature_select: { number: 5, total: 6, title: '設定開戶服務' },
  terms_submit: { number: 6, total: 6, title: '確認條款與送審' },
  completed: { number: 6, total: 6, title: '開戶申請已送出' },
};

export const FlowHeader: React.FC<FlowHeaderProps> = ({ currentStep, formData, onBack }) => {
  const info = STEP_INFO[currentStep];
  const isSpecialScreen = currentStep === 'welcome';
  const isSmsCompleted = currentStep !== 'welcome' && currentStep !== 'sms_verify';
  const progressPercent = (info.number / info.total) * 100;

  return (
    <header className="sticky top-0 z-20 w-full bg-white/95 backdrop-blur-md border-b border-sky-100/80 px-4 pt-3 pb-2.5 transition-all">
      {/* Top row: Brand & Navigation & Countdown */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {!isSpecialScreen ? (
            <button
              id="header-back-button"
              onClick={onBack}
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-50 text-slate-600 hover:bg-sky-50 hover:text-sky-600 active:scale-95 transition-all border border-slate-200/60"
              aria-label="返回上一步"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <AIGuardian size="sm" mood={currentStep === 'completed' ? 'success' : 'welcoming'} />
              <div className="flex flex-col">
                <span className="text-base font-bold tracking-tight text-slate-900 flex items-center gap-1.5">
                  GuardFrame
                  <span className="rounded-md bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold text-sky-600 border border-sky-200/60">
                    BANK AI
                  </span>
                </span>
              </div>
            </div>
          )}

          {!isSpecialScreen && (
            <div className="flex items-center gap-1.5 pl-1">
              <AIGuardian size="xs" mood={currentStep === 'face_verify' ? 'scanning' : 'idle'} />
              <span className="text-sm font-semibold text-slate-800">
                {info.title}
              </span>
            </div>
          )}
        </div>

        {/* Right side: Bank security badge / 15-min Countdown / Step tag */}
        <div className="flex items-center gap-2">
          {/* 15-min Session Countdown (Visible after SMS verify) */}
          {isSmsCompleted && (
            <SessionCountdownBadge
              startTime={formData?.smsVerifiedAt}
              totalSeconds={900}
              compact={true}
              className="shadow-xs"
            />
          )}

          {!isSpecialScreen ? (
            <div className="flex items-center gap-1 rounded-full bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-700 border border-sky-200/50">
              <span className="text-[11px]">步驟</span>
              <span className="text-sky-900 font-bold">{info.number}</span>
              <span className="text-sky-400">/</span>
              <span className="text-sky-500">{info.total}</span>
            </div>
          ) : (
            <div className="flex items-center gap-1 text-[11px] font-medium text-slate-500 bg-slate-50 px-2.5 py-1 rounded-full border border-slate-200/70">
              <Lock className="h-3 w-3 text-emerald-600" />
              <span>256-bit 銀行安全</span>
            </div>
          )}
        </div>
      </div>

      {/* Progress Bar (Visible on 5 steps) */}
      {!isSpecialScreen && (
        <div className="mt-2.5">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-sky-100/80">
            <div
              id="header-progress-track"
              className="h-full rounded-full bg-gradient-to-r from-sky-400 via-sky-500 to-emerald-400 transition-all duration-500 ease-out shadow-xs"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      )}
    </header>
  );
};
