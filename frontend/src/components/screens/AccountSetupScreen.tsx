import React, { useState } from 'react';
import { FormData } from '../../types';
import { AIGuardian } from '../AIGuardian';
import { validatePassword } from '../../utils/passwordUtils';
import { 
  Lock, 
  Eye, 
  EyeOff, 
  Check, 
  ShieldCheck, 
  ArrowRight, 
  Loader2,
  CheckCircle2,
  FileText,
  Sparkles
} from 'lucide-react';

interface AccountSetupScreenProps {
  formData: FormData;
  updateFormData: (data: Partial<FormData>) => void;
  onNext: () => void;
}

export const AccountSetupScreen: React.FC<AccountSetupScreenProps> = ({
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
  const [touched, setTouched] = useState<boolean>(false);

  // Validation
  const validation = validatePassword(password);
  const passwordsMatch = password.length > 0 && confirmPassword.length > 0 && password === confirmPassword;
  const isConfirmTouched = confirmPassword.length > 0;
  const isMismatch = isConfirmTouched && password !== confirmPassword;
  
  const isFormValid = validation.isValid && passwordsMatch && agreeTerms && agreePrivacy;

  const handleSubmit = () => {
    setTouched(true);
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

      // Brief gentle success transition before advancing to Step 6
      setTimeout(() => {
        onNext();
      }, 900);
    }, 1100);
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
      <div className="flex flex-col items-center justify-center flex-1 px-5 py-16 bg-white text-center">
        <div className="h-16 w-16 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200 flex items-center justify-center mb-4 animate-in zoom-in-75 duration-300">
          <Check className="h-8 w-8 stroke-[3]" />
        </div>
        <h2 className="text-xl font-bold text-slate-900">設定完成</h2>
        <p className="text-xs text-slate-500 mt-1">正在產生身分核驗報告…</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 px-5 pt-3 pb-8 bg-white">
      {/* Title & Description */}
      <div className="mb-4 flex items-start justify-between">
        <div>
          <span className="text-[11px] font-bold text-sky-600 bg-sky-50 px-2 py-0.5 rounded-md border border-sky-100">
            步驟 05 / 05
          </span>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 mt-1.5">
            設定你的帳戶
          </h1>
          <p className="mt-1 text-xs text-slate-500 leading-relaxed">
            再完成最後一步，就可以完成開戶。
          </p>
        </div>

        <button
          type="button"
          onClick={handleFillDemoPassword}
          className="shrink-0 text-[11px] font-medium text-sky-600 bg-sky-50 hover:bg-sky-100 px-2.5 py-1 rounded-lg border border-sky-200/70 flex items-center gap-1 cursor-pointer transition-colors shadow-2xs"
          title="帶入符合 4 項規則之範例密碼"
        >
          <Sparkles className="h-3 w-3 text-sky-500" />
          <span>範例密碼</span>
        </button>
      </div>

      <div className="space-y-4">
        {/* Password Field */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1.5 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <Lock className="h-3.5 w-3.5 text-sky-600" />
              密碼
            </span>
            {password.length > 0 && (
              <span className={`text-[11px] font-medium ${
                validation.strength === 'strong' 
                  ? 'text-emerald-600' 
                  : validation.strength === 'good' 
                  ? 'text-sky-600' 
                  : validation.strength === 'fair' 
                  ? 'text-amber-600' 
                  : 'text-slate-400'
              }`}>
                強度：{validation.strengthLabel}
              </span>
            )}
          </label>
          <div className="relative">
            <input
              id="mobile-account-password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="請輸入密碼"
              className="w-full rounded-2xl border border-slate-200/80 bg-slate-50/60 px-4 py-3.5 pr-11 text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-sky-400 focus:outline-hidden focus:ring-2 focus:ring-sky-100 transition-all"
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

          {/* Password Strength Indicator Bar */}
          {password.length > 0 && (
            <div className="mt-2 space-y-1">
              <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
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
          <div className="mt-2.5 grid grid-cols-2 gap-1.5 text-[11px]">
            {/* 1. 至少 8 個字元 */}
            <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border transition-colors ${
              validation.hasMinLength 
                ? 'bg-emerald-50 border-emerald-200/80 text-emerald-700 font-medium' 
                : 'bg-slate-50 border-slate-200/70 text-slate-500'
            }`}>
              <Check className={`h-3.5 w-3.5 shrink-0 ${validation.hasMinLength ? 'text-emerald-600 stroke-[3]' : 'text-slate-300'}`} />
              <span className="truncate">至少 8 個字元</span>
            </div>

            {/* 2. 包含大寫字母 (A-Z) */}
            <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border transition-colors ${
              validation.hasUpperCase 
                ? 'bg-emerald-50 border-emerald-200/80 text-emerald-700 font-medium' 
                : 'bg-slate-50 border-slate-200/70 text-slate-500'
            }`}>
              <Check className={`h-3.5 w-3.5 shrink-0 ${validation.hasUpperCase ? 'text-emerald-600 stroke-[3]' : 'text-slate-300'}`} />
              <span className="truncate">包含大寫字母 (A-Z)</span>
            </div>

            {/* 3. 包含小寫字母 (a-z) */}
            <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border transition-colors ${
              validation.hasLowerCase 
                ? 'bg-emerald-50 border-emerald-200/80 text-emerald-700 font-medium' 
                : 'bg-slate-50 border-slate-200/70 text-slate-500'
            }`}>
              <Check className={`h-3.5 w-3.5 shrink-0 ${validation.hasLowerCase ? 'text-emerald-600 stroke-[3]' : 'text-slate-300'}`} />
              <span className="truncate">包含小寫字母 (a-z)</span>
            </div>

            {/* 4. 包含至少一個數字 */}
            <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border transition-colors ${
              validation.hasNumber 
                ? 'bg-emerald-50 border-emerald-200/80 text-emerald-700 font-medium' 
                : 'bg-slate-50 border-slate-200/70 text-slate-500'
            }`}>
              <Check className={`h-3.5 w-3.5 shrink-0 ${validation.hasNumber ? 'text-emerald-600 stroke-[3]' : 'text-slate-300'}`} />
              <span className="truncate">包含至少一個數字</span>
            </div>
          </div>
        </div>

        {/* Confirm Password Field */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1.5 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <Lock className="h-3.5 w-3.5 text-sky-600" />
              確認密碼
            </span>
          </label>
          <div className="relative">
            <input
              id="mobile-account-confirm-password"
              type={showConfirmPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="請再次輸入密碼"
              className={`w-full rounded-2xl border px-4 py-3.5 pr-11 text-sm font-medium placeholder:text-slate-400 transition-all ${
                isMismatch
                  ? 'border-rose-300 bg-rose-50/30 text-slate-900 focus:border-rose-400 focus:ring-2 focus:ring-rose-100'
                  : passwordsMatch
                  ? 'border-emerald-300 bg-emerald-50/20 text-slate-900 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100'
                  : 'border-slate-200/80 bg-slate-50/60 text-slate-900 focus:bg-white focus:border-sky-400 focus:ring-2 focus:ring-sky-100'
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

          {/* Confirm Password Feedback */}
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

        {/* Account Agreements */}
        <div className="pt-2 space-y-2 border-t border-slate-100">
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

      {/* Guardian Encourage Message */}
      <div className="mt-4 flex items-center gap-3 rounded-2xl bg-sky-50/70 p-3 border border-sky-100">
        <AIGuardian size="sm" mood="guiding" />
        <div className="text-xs text-sky-900 leading-relaxed">
          <p className="font-semibold text-sky-950">就快完成囉！</p>
          <p className="text-sky-700 text-[11px]">
            密碼設定完成後，點擊「完成設定」即可送出開戶。
          </p>
        </div>
      </div>

      {/* CTA Button */}
      <div className="mt-auto pt-4">
        <button
          id="mobile-account-setup-submit-btn"
          type="button"
          onClick={handleSubmit}
          disabled={!isFormValid || isLoading}
          className={`group flex w-full items-center justify-center gap-2 rounded-2xl py-4 px-6 text-base font-bold transition-all cursor-pointer ${
            isFormValid && !isLoading
              ? 'bg-sky-500 hover:bg-sky-600 text-white shadow-md shadow-sky-400/25 active:scale-[0.99]'
              : 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200/60'
          }`}
        >
          {isLoading ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" />
              <span>建立帳戶中…</span>
            </>
          ) : (
            <>
              <span>完成設定</span>
              <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
            </>
          )}
        </button>
      </div>
    </div>
  );
};
