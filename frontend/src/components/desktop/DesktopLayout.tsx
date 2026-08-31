import React from 'react';
import { OnboardingStep, FormData, GuardianMood } from '../../types';
import { AIGuardian } from '../AIGuardian';
import { SessionCountdownBadge } from '../common/SessionCountdownBadge';
import { 
  CheckCircle2, 
  ShieldCheck, 
  Sparkles, 
  Clock, 
  FileText, 
  Smartphone, 
  ScanFace, 
  KeyRound, 
  ArrowRight,
  Lock,
  ChevronRight,
  Shield,
  HelpCircle,
  PhoneCall,
  UserCheck,
  Check
} from 'lucide-react';

interface DesktopLayoutProps {
  currentStep: OnboardingStep;
  formData: FormData;
  onSelectStep: (step: OnboardingStep) => void;
  onNextStep: () => void;
  onBackStep: () => void;
  onReset: () => void;
  children: React.ReactNode;
}

const STEPS_NAV: { id: OnboardingStep; stepNum: number; title: string; desc: string; time: string; icon: any }[] = [
  { id: 'sms_verify', stepNum: 1, title: '手機號碼驗證', desc: '簡訊動態驗證碼', time: '30 秒', icon: Smartphone },
  { id: 'id_upload', stepNum: 2, title: '身分證驗證', desc: '身分證正反面拍攝', time: '1 分鐘', icon: FileText },
  { id: 'basic_info', stepNum: 3, title: '資料確認', desc: '確認與微調個資', time: '30 秒', icon: UserCheck },
  { id: 'face_verify', stepNum: 4, title: '人臉驗證', desc: '動態活體與照明響應', time: '23 秒', icon: ScanFace },
  { id: 'feature_select', stepNum: 5, title: '功能選擇', desc: '卡面與附加服務偏好', time: '45 秒', icon: KeyRound },
  { id: 'terms_submit', stepNum: 6, title: '條款與送審', desc: '法定條款確認並送審', time: '30 秒', icon: ShieldCheck },
];

export const DesktopLayout: React.FC<DesktopLayoutProps> = ({
  currentStep,
  formData,
  onSelectStep,
  onNextStep,
  onBackStep,
  onReset,
  children,
}) => {
  const currentStepObj = STEPS_NAV.find((s) => s.id === currentStep);
  const currentStepIndex = currentStepObj ? currentStepObj.stepNum : (currentStep === 'welcome' ? 0 : 6);
  const progressPercent = currentStep === 'welcome' ? 0 : ((currentStepIndex) / 6) * 100;
  const isSmsCompleted = currentStep !== 'welcome' && currentStep !== 'sms_verify';

  // Derive Guardian mood for desktop sidebar
  const getGuardianMood = (): GuardianMood => {
    if (currentStep === 'completed') return 'success';
    if (currentStep === 'face_verify') return 'scanning';
    if (currentStep === 'id_upload') return 'guiding';
    if (currentStep === 'sms_verify') return 'thinking';
    return 'welcoming';
  };

  return (
    <div className="w-full min-h-[900px] bg-slate-100 flex flex-col font-sans antialiased text-slate-800">
      {/* Top Application Header */}
      <header className="sticky top-0 z-40 w-full bg-white/95 backdrop-blur-md border-b border-sky-100/90 px-8 py-3.5 shadow-xs">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          {/* Logo & Product Title */}
          <div className="flex items-center gap-3.5">
            <div 
              onClick={() => onSelectStep('welcome')}
              className="flex items-center gap-2.5 cursor-pointer group"
            >
              <AIGuardian size="sm" mood={getGuardianMood()} showBadge={false} />
              <div className="flex flex-col">
                <div className="flex items-center gap-2">
                  <span className="text-lg font-black tracking-tight text-slate-900 group-hover:text-sky-600 transition-colors">
                    GuardFrame
                  </span>
                  <span className="rounded-md bg-sky-50 px-2 py-0.5 text-[10px] font-bold text-sky-700 border border-sky-200/70">
                    BANK AI
                  </span>
                </div>
                <span className="text-[11px] text-slate-400 font-medium">
                  次世代數位銀行身分核驗與開戶系統
                </span>
              </div>
            </div>

            <div className="hidden lg:flex items-center gap-2 ml-4 pl-4 border-l border-slate-200">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 border border-emerald-200/60">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                金管會金融級安全連線中
              </span>
            </div>
          </div>

          {/* Right Header Badges & Actions */}
          <div className="flex items-center gap-3 sm:gap-4">
            {/* 15-Minute Session Countdown after SMS verification */}
            {isSmsCompleted && (
              <div className="flex items-center gap-1.5 animate-in fade-in duration-200">
                <SessionCountdownBadge
                  startTime={formData.smsVerifiedAt}
                  totalSeconds={900}
                  compact={false}
                  label="操作時效："
                />
              </div>
            )}

            <div className="hidden md:flex items-center gap-3 text-xs text-slate-600 bg-slate-50 px-3.5 py-1.5 rounded-xl border border-slate-200/70">
              <Lock className="h-3.5 w-3.5 text-emerald-600" />
              <span>TLS 1.3 / 256-bit 端對端加密</span>
            </div>

            {/* Applicant Pill: ONLY shown during active onboarding steps (hidden on Welcome/Home page) */}
            {currentStep !== 'welcome' && (
              <div className="flex items-center gap-2 pl-2 border-l border-slate-200 animate-in fade-in duration-200">
                <div className="flex items-center gap-2 bg-sky-50/70 px-3 py-1.5 rounded-xl border border-sky-100">
                  <UserCheck className="h-4 w-4 text-sky-600" />
                  <div className="text-left">
                    <p className="text-xs font-bold text-slate-800">
                      {formData.fullName || (formData.phone ? `用戶 (${formData.phone.slice(-4)})` : '申請人')}
                    </p>
                    <p className="text-[10px] text-slate-400">
                      {formData.idNumber ? `${formData.idNumber.slice(0, 3)}****${formData.idNumber.slice(-2)}` : '線上開戶申請中'}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={onReset}
                  className="text-xs font-medium text-slate-500 hover:text-sky-600 px-2.5 py-1.5 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
                  title="重新開始"
                >
                  重置
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Container with Left Sidebar + Right Workspace */}
      <div className="flex-1 max-w-7xl w-full mx-auto px-6 py-6 grid grid-cols-12 gap-6 items-start">
        {/* Left Navigation & Status Sidebar (col-span-4 or 3) */}
        <aside className="col-span-12 lg:col-span-4 xl:col-span-3 space-y-4 sticky top-20">
          {/* Step Navigation Card */}
          <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs">
            <div className="flex items-center justify-between mb-3 px-1">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                開戶進度導覽
              </h2>
              <span className="text-xs font-bold text-sky-600">
                {currentStep === 'welcome' ? '準備開始' : currentStep === 'completed' ? '驗證完成' : `步驟 ${currentStepIndex} / 6`}
              </span>
            </div>

            {/* Overall Progress Bar */}
            <div className="mb-4 px-1">
              <div className="h-2 w-full bg-sky-100/70 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-sky-400 via-sky-500 to-emerald-400 rounded-full transition-all duration-500 ease-out shadow-xs"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>

            {/* 15-Minute Countdown Alert Banner inside sidebar when SMS is verified */}
            {isSmsCompleted && (
              <div className="mb-3 p-2.5 rounded-xl bg-sky-50/80 border border-sky-200/80 flex items-center justify-between animate-in fade-in duration-150">
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  <span className="text-[11px] font-bold text-slate-700">手機驗證已完成</span>
                </div>
                <SessionCountdownBadge
                  startTime={formData.smsVerifiedAt}
                  compact={true}
                />
              </div>
            )}

            {/* Steps List */}
            <div className="space-y-1.5">
              <button
                type="button"
                onClick={() => onSelectStep('welcome')}
                className={`w-full flex items-center justify-between p-2.5 rounded-xl text-left transition-all cursor-pointer ${
                  currentStep === 'welcome'
                    ? 'bg-sky-50 border border-sky-200/80 text-sky-900 font-bold shadow-xs'
                    : 'hover:bg-slate-50 text-slate-600 font-medium'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <div className={`h-6 w-6 rounded-lg flex items-center justify-center text-xs font-bold ${
                    currentStep === 'welcome' ? 'bg-sky-500 text-white' : 'bg-slate-100 text-slate-500'
                  }`}>
                    0
                  </div>
                  <span className="text-xs">歡迎與流程總覽</span>
                </div>
                {currentStep !== 'welcome' && (
                  <Check className="h-3.5 w-3.5 text-emerald-500" />
                )}
              </button>

              {STEPS_NAV.map((s) => {
                const isCurrent = currentStep === s.id;
                const isPassed = currentStepIndex > s.stepNum || currentStep === 'completed';
                const Icon = s.icon;

                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => onSelectStep(s.id)}
                    className={`w-full flex items-center justify-between p-2.5 rounded-xl text-left transition-all cursor-pointer ${
                      isCurrent
                        ? 'bg-sky-50 border border-sky-200/80 text-sky-950 font-bold shadow-xs ring-1 ring-sky-100'
                        : isPassed
                        ? 'hover:bg-slate-50 text-slate-700 font-medium'
                        : 'hover:bg-slate-50 text-slate-400 font-normal'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <div className={`h-6 w-6 rounded-lg flex items-center justify-center text-xs font-bold transition-colors ${
                        isCurrent
                          ? 'bg-sky-500 text-white shadow-xs'
                          : isPassed
                          ? 'bg-emerald-500 text-white'
                          : 'bg-slate-100 text-slate-400'
                      }`}>
                        {isPassed ? <Check className="h-3.5 w-3.5" /> : s.stepNum}
                      </div>
                      <div>
                        <p className={`text-xs ${isCurrent ? 'font-bold text-sky-950' : ''}`}>
                          {s.title}
                        </p>
                        <p className="text-[10px] text-slate-400">{s.time}</p>
                      </div>
                    </div>
                    {isCurrent && (
                      <span className="h-2 w-2 rounded-full bg-sky-500 animate-ping" />
                    )}
                  </button>
                );
              })}

              <button
                type="button"
                onClick={() => onSelectStep('completed')}
                className={`w-full flex items-center justify-between p-2.5 rounded-xl text-left transition-all cursor-pointer ${
                  currentStep === 'completed'
                    ? 'bg-emerald-50 border border-emerald-200 text-emerald-950 font-bold shadow-xs'
                    : 'hover:bg-slate-50 text-slate-400 font-normal'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <div className={`h-6 w-6 rounded-lg flex items-center justify-center text-xs font-bold ${
                    currentStep === 'completed' ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-400'
                  }`}>
                    ✓
                  </div>
                  <span className="text-xs">開戶審核與結果</span>
                </div>
              </button>
            </div>
          </div>

          {/* AI Guardian Status Widget */}
          <div className="bg-gradient-to-b from-sky-50/80 to-white rounded-2xl p-4 border border-sky-100 shadow-xs">
            <div className="flex items-center gap-3">
              <AIGuardian size="md" mood={getGuardianMood()} showBadge={true} />
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold text-slate-900">AI Guardian 守護助手</span>
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                </div>
                <p className="text-[11px] text-sky-800 mt-0.5 leading-relaxed font-medium">
                  {currentStep === 'welcome' && '歡迎！全程約需 3 分鐘，準備好身分證就可以開始囉。'}
                  {currentStep === 'basic_info' && '請確保填寫姓名與身分證一致，方便後續自動核驗。'}
                  {currentStep === 'sms_verify' && '已發送安全驗證碼至你的手機，請於 60 秒內輸入。'}
                  {currentStep === 'id_upload' && '可自由選擇拍照或上傳證件圖檔，請確認文字清晰、四角完整無反光。'}
                  {currentStep === 'face_verify' && '正在進行 23 秒動態防偽核驗，請配合畫面微動作。'}
                  {currentStep === 'account_setup' && '最後一步！設定 6 位數交易密碼即可完成開戶。'}
                  {currentStep === 'completed' && '恭喜！你的真人身分與證件核對皆已成功通過。'}
                </p>
              </div>
            </div>
          </div>

          {/* Security Guarantee Card */}
          <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs text-xs space-y-2 text-slate-500">
            <div className="flex items-center gap-2 text-slate-800 font-bold">
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
              <span>安全防護保證</span>
            </div>
            <p className="text-[11px] leading-relaxed text-slate-500">
              本系統採用金管會規範之金融級生物特徵活體辨識技術，所有影像資料皆以 ISO 27001 認證伺服器即時加密儲存。
            </p>
            <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-400">
              <span>GuardFrame Security ID</span>
              <span className="font-mono font-semibold text-slate-600">GF-2026-BANK</span>
            </div>
          </div>
        </aside>

        {/* Right Main Content Canvas (col-span-8 or 9) */}
        <main className="col-span-12 lg:col-span-8 xl:col-span-9 bg-white rounded-3xl border border-slate-200/90 shadow-sm p-6 lg:p-8 min-h-[720px] flex flex-col justify-between">
          {children}
        </main>
      </div>

      {/* Desktop Footer */}
      <footer className="mt-auto border-t border-slate-200/80 bg-white py-4 px-8 text-center text-xs text-slate-400">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>© 2026 GuardFrame Bank Inc. 數位銀行身分核驗系統 (Friendly Fintech × Soft Technology)</span>
          <div className="flex items-center gap-4 text-[11px] text-slate-500">
            <span className="hover:text-sky-600 cursor-pointer">隱私權聲明</span>
            <span className="hover:text-sky-600 cursor-pointer">金融身分核驗條款</span>
            <span className="hover:text-sky-600 cursor-pointer">客服專線 0800-000-888</span>
          </div>
        </div>
      </footer>
    </div>
  );
};
