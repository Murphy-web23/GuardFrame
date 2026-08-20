import React, { useState } from 'react';
import { FormData } from '../../../types';
import { AIGuardian } from '../../AIGuardian';
import { validatePassword } from '../../../utils/passwordUtils';
import { 
  Lock, 
  Eye, 
  EyeOff, 
  Check, 
  ShieldCheck, 
  ArrowRight, 
  Loader2,
  FileCheck,
  Sparkles
} from 'lucide-react';

interface DesktopAccountSetupProps {
  formData: FormData;
  updateFormData: (data: Partial<FormData>) => void;
  onNext: () => void;
}

export const DesktopAccountSetup: React.FC<DesktopAccountSetupProps> = ({
  formData,
  updateFormData,
  onNext,
}) => {
  const [password, setPassword] = useState<string>(formData.password || '');
  const [confirmPassword, setConfirmPassword] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState<boolean>(false);
  
  const [agreeTerms, setAgreeTerms] = useState<boolean>(formData.agreeTerms ?? true);
  const [agreePrivacy, setAgreePrivacy] = useState<boolean>(formData.agreePrivacy ?? true);
  
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isSuccessTransition, setIsSuccessTransition] = useState<boolean>(false);

  // Validation
  const validation = validatePassword(password);
  const passwordsMatch = password.length > 0 && confirmPassword.length > 0 && password === confirmPassword;
  const isConfirmTouched = confirmPassword.length > 0;
  const isMismatch = isConfirmTouched && password !== confirmPassword;
  
  const isFormValid = validation.isValid && passwordsMatch && agreeTerms && agreePrivacy;

  const handleSubmit = () => {
    if (!isFormValid || isLoading || isSuccessTransition) return;

    setIsLoading(true);

    // Mock API loading state
    setTimeout(() => {
      setIsLoading(false);
      setIsSuccessTransition(true);
      updateFormData({
        password,
        agreeTerms,
        agreePrivacy,
      });

      // Quick gentle transition before advancing to Step 6
      setTimeout(() => {
        onNext();
      }, 800);
    }, 1000);
  };

  const handleFillDemoPassword = () => {
    setPassword('Guard1234');
    setConfirmPassword('Guard1234');
    setAgreeTerms(true);
    setAgreePrivacy(true);
  };

  // If in quick gentle transition state
  if (isSuccessTransition) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-24 text-center">
        <div className="h-20 w-20 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200 flex items-center justify-center mb-5 shadow-xs animate-in zoom-in-75 duration-300">
          <Check className="h-10 w-10 stroke-[3]" />
        </div>
        <h2 className="text-2xl font-black text-slate-900">設定完成</h2>
        <p className="text-sm text-slate-500 mt-2">GuardFrame 正在彙整驗證資料並產生核驗結果…</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col justify-between h-full space-y-6">
      {/* Header */}
      <div className="border-b border-slate-100 pb-4 flex items-center justify-between">
        <div>
          <span className="text-xs font-bold text-sky-600 bg-sky-50 px-2.5 py-1 rounded-md border border-sky-100">
            步驟 05 / 05 (最後一步)
          </span>
          <h1 className="text-2xl font-black text-slate-900 mt-2">
            設定你的帳戶
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            再完成最後一步，就可以完成開戶。
          </p>
        </div>

        <div className="hidden sm:flex items-center gap-2 bg-emerald-50 px-3 py-1.5 rounded-xl border border-emerald-200/70 text-emerald-700 text-xs font-semibold">
          <ShieldCheck className="h-4 w-4" />
          <span>金融級端對端加密防護</span>
        </div>
      </div>

      {/* 2-Column Desktop Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Form: Password Settings (7 cols) */}
        <div className="lg:col-span-7 space-y-5">
          <div className="bg-slate-50/70 p-6 rounded-3xl border border-slate-200/80 space-y-4">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
              <Lock className="h-4 w-4 text-sky-600" />
              設定登入與交易密碼
            </h2>

            {/* Password */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5 flex items-center justify-between">
                <span>密碼</span>
                {password.length > 0 && (
                  <span className={`text-[11px] font-semibold ${
                    validation.strength === 'strong' 
                      ? 'text-emerald-600' 
                      : validation.strength === 'good' 
                      ? 'text-sky-600' 
                      : validation.strength === 'fair' 
                      ? 'text-amber-600' 
                      : 'text-slate-400'
                  }`}>
                    密碼強度：{validation.strengthLabel}
                  </span>
                )}
              </label>
              <div className="relative">
                <input
                  id="desktop-account-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="請輸入密碼"
                  className="w-full rounded-xl border border-slate-200/90 bg-white px-4 py-3.5 pr-11 text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:border-sky-400 focus:outline-hidden focus:ring-2 focus:ring-sky-100 transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
                  aria-label={showPassword ? '隱藏密碼' : '顯示密碼'}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>

              {/* Strength Bar */}
              {password.length > 0 && (
                <div className="mt-2 space-y-1">
                  <div className="h-1.5 w-full bg-slate-200/80 rounded-full overflow-hidden">
                    <div 
                      className={`h-full transition-all duration-300 rounded-full ${
                        validation.strength === 'strong'
                          ? 'bg-emerald-500'
                          : validation.strength === 'good'
                          ? 'bg-sky-500'
                          : validation.strength === 'fair'
                          ? 'bg-sky-400'
                          : 'bg-slate-300'
                      }`}
                      style={{ width: `${validation.strengthPercent}%` }}
                    />
                  </div>
                </div>
              )}

              {/* 4 Password Requirements Badges */}
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                {/* 1. 至少 8 個字元 */}
                <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition-colors ${
                  validation.hasMinLength 
                    ? 'bg-emerald-50 border-emerald-200/80 text-emerald-800 font-medium' 
                    : 'bg-white border-slate-200 text-slate-500'
                }`}>
                  <Check className={`h-3.5 w-3.5 shrink-0 ${validation.hasMinLength ? 'text-emerald-600 stroke-[3]' : 'text-slate-300'}`} />
                  <span>至少 8 個字元</span>
                </div>

                {/* 2. 包含大寫字母 (A-Z) */}
                <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition-colors ${
                  validation.hasUpperCase 
                    ? 'bg-emerald-50 border-emerald-200/80 text-emerald-800 font-medium' 
                    : 'bg-white border-slate-200 text-slate-500'
                }`}>
                  <Check className={`h-3.5 w-3.5 shrink-0 ${validation.hasUpperCase ? 'text-emerald-600 stroke-[3]' : 'text-slate-300'}`} />
                  <span>包含大寫字母 (A-Z)</span>
                </div>

                {/* 3. 包含小寫字母 (a-z) */}
                <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition-colors ${
                  validation.hasLowerCase 
                    ? 'bg-emerald-50 border-emerald-200/80 text-emerald-800 font-medium' 
                    : 'bg-white border-slate-200 text-slate-500'
                }`}>
                  <Check className={`h-3.5 w-3.5 shrink-0 ${validation.hasLowerCase ? 'text-emerald-600 stroke-[3]' : 'text-slate-300'}`} />
                  <span>包含小寫字母 (a-z)</span>
                </div>

                {/* 4. 包含至少一個數字 */}
                <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition-colors ${
                  validation.hasNumber 
                    ? 'bg-emerald-50 border-emerald-200/80 text-emerald-800 font-medium' 
                    : 'bg-white border-slate-200 text-slate-500'
                }`}>
                  <Check className={`h-3.5 w-3.5 shrink-0 ${validation.hasNumber ? 'text-emerald-600 stroke-[3]' : 'text-slate-300'}`} />
                  <span>包含至少一個數字</span>
                </div>
              </div>
            </div>

            {/* Confirm Password */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5 flex items-center justify-between">
                <span>確認密碼</span>
              </label>
              <div className="relative">
                <input
                  id="desktop-account-confirm-password"
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="請再次輸入密碼"
                  className={`w-full rounded-xl border px-4 py-3.5 pr-11 text-sm font-medium placeholder:text-slate-400 transition-all ${
                    isMismatch
                      ? 'border-rose-300 bg-rose-50/30 text-slate-900 focus:border-rose-400 focus:ring-2 focus:ring-rose-100'
                      : passwordsMatch
                      ? 'border-emerald-300 bg-emerald-50/20 text-slate-900 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100'
                      : 'border-slate-200/90 bg-white text-slate-900 focus:border-sky-400 focus:ring-2 focus:ring-sky-100'
                  }`}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
                  aria-label={showConfirmPassword ? '隱藏密碼' : '顯示密碼'}
                >
                  {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>

              {/* Feedback messages */}
              {isMismatch && (
                <p className="mt-1.5 text-xs text-rose-500 font-medium">
                  兩次輸入的密碼不一致
                </p>
              )}
              {passwordsMatch && (
                <p className="mt-1.5 text-xs text-emerald-600 font-medium flex items-center gap-1">
                  <Check className="h-3.5 w-3.5" />
                  密碼相符
                </p>
              )}
            </div>

            {/* Agreements */}
            <div className="pt-3 space-y-2.5 border-t border-slate-200/80">
              <label className="flex items-start gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={agreeTerms}
                  onChange={(e) => setAgreeTerms(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-400"
                />
                <span className="text-xs text-slate-600">
                  我已閱讀並同意 <span className="text-sky-600 font-semibold hover:underline">服務條款</span>
                </span>
              </label>

              <label className="flex items-start gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={agreePrivacy}
                  onChange={(e) => setAgreePrivacy(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-400"
                />
                <span className="text-xs text-slate-600">
                  我同意 <span className="text-sky-600 font-semibold hover:underline">隱私權政策</span> 與個人資料保護規範
                </span>
              </label>
            </div>
          </div>
        </div>

        {/* Right Form: Friendly Info & Safety Assurance (5 cols) */}
        <div className="lg:col-span-5 space-y-4">
          {/* Quick Demo Fill Helper */}
          <div className="bg-sky-50/50 p-4 rounded-2xl border border-sky-100/90 text-xs space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-sky-900 flex items-center gap-1.5">
                <Sparkles className="h-4 w-4 text-sky-500" />
                快速填寫示範
              </span>
              <button
                type="button"
                onClick={handleFillDemoPassword}
                className="text-[11px] font-bold text-sky-600 hover:text-sky-700 bg-white px-2.5 py-1 rounded-lg border border-sky-200 cursor-pointer"
              >
                帶入安全範例密碼
              </button>
            </div>
            <p className="text-[11px] text-sky-700 leading-relaxed">
              點擊可一鍵帶入符合 8 字元、含大小寫英文 (A-Z, a-z) 與數字 (0-9) 之安全密碼進行測試。
            </p>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-3">
            <div className="flex items-center gap-3">
              <AIGuardian size="sm" mood="guiding" />
              <div>
                <p className="text-xs font-bold text-slate-900">GuardFrame 守護小叮嚀</p>
                <p className="text-[11px] text-slate-500">
                  完成設定後，系統將完成整個開戶申請核驗程序。
                </p>
              </div>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 text-[11px] text-slate-500 leading-relaxed space-y-1.5">
              <p className="font-semibold text-slate-700">帳戶密碼安全檢核項目：</p>
              <p className="text-slate-600">1. 長度至少 8 個字元</p>
              <p className="text-slate-600">2. 包含大寫英文字母 (A-Z)</p>
              <p className="text-slate-600">3. 包含小寫英文字母 (a-z)</p>
              <p className="text-slate-600">4. 包含至少一個數字</p>
            </div>
          </div>
        </div>
      </div>

      {/* Footer Navigation */}
      <div className="pt-4 border-t border-slate-100 flex items-center justify-end">
        <button
          id="desktop-account-setup-submit-btn"
          type="button"
          onClick={handleSubmit}
          disabled={!isFormValid || isLoading}
          className={`px-8 py-3.5 rounded-xl font-bold text-sm flex items-center gap-2 transition-all cursor-pointer ${
            isFormValid && !isLoading
              ? 'bg-sky-500 hover:bg-sky-600 text-white shadow-md shadow-sky-400/25 active:scale-[0.99]'
              : 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200/60'
          }`}
        >
          {isLoading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>建立帳戶中…</span>
            </>
          ) : (
            <>
              <span>完成設定</span>
              <ArrowRight className="h-4 w-4" />
            </>
          )}
        </button>
      </div>
    </div>
  );
};
