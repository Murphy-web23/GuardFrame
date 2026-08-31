import React, { useState } from 'react';
import { FormData } from '../../types';
import { ArrowRight, ShieldCheck, Phone, CheckCircle2, RotateCcw, Sparkles } from 'lucide-react';
import { SessionCountdownBadge } from '../common/SessionCountdownBadge';
import { DemoUserPicker } from '../common/DemoUserPicker';
import { DemoUser } from '../../data/demoUsers';

interface SmsVerifyScreenProps {
  formData: FormData;
  updateFormData: (data: Partial<FormData>) => void;
  onNext: () => void;
}

export const SmsVerifyScreen: React.FC<SmsVerifyScreenProps> = ({
  formData,
  updateFormData,
  onNext,
}) => {
  const [phase, setPhase] = useState<'input_phone' | 'input_code'>(
    formData.phone ? 'input_code' : 'input_phone'
  );
  const [phoneInput, setPhoneInput] = useState<string>(formData.phone || '');
  const [phoneError, setPhoneError] = useState<string>('');
  const [codeDigits, setCodeDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [codeError, setCodeError] = useState<string>('');
  const [isVerifying, setIsVerifying] = useState<boolean>(false);
  const [codeSentTime, setCodeSentTime] = useState<number>(Date.now());

  // Step 1: Send SMS & Transition to code phase
  const handleSendCode = () => {
    const cleanPhone = phoneInput.replace(/\D/g, '');
    if (!cleanPhone.startsWith('09') || cleanPhone.length !== 10) {
      setPhoneError('請輸入正確的 10 位數台灣手機號碼 (09xxxxxxxx)');
      return;
    }
    setPhoneError('');
    updateFormData({ phone: cleanPhone });
    setCodeSentTime(Date.now());
    setPhase('input_code');
  };

  // Demo user quick select
  // 2026-08-22：原本只填手機號碼欄位本身，沒有寫進共用的 formData，
  // 導致後面「確認個人資料」步驟自己的示範資料選單如果選了不同一組，
  // 姓名/身分證/生日等資料會跟這裡實際送出驗證的手機號碼對不上。這裡
  // 直接把整組示範資料寫進 formData，讓後面步驟預設帶出同一組人，
  // 不用重選（使用者仍然可以在後面步驟自己改）。
  const handleSelectDemoUser = (user: DemoUser) => {
    setPhoneInput(user.phone);
    setPhoneError('');
    updateFormData({
      fullName: user.fullName,
      idNumber: user.idNumber,
      birthday: user.birthday,
      email: user.email,
      address: user.address,
    });
  };

  // Handle digit inputs
  const handleDigitChange = (index: number, val: string) => {
    const clean = val.replace(/\D/g, '').slice(-1);
    const newDigits = [...codeDigits];
    newDigits[index] = clean;
    setCodeDigits(newDigits);
    setCodeError('');

    if (clean && index < 5) {
      const nextInput = document.getElementById(`sms-digit-${index + 1}`);
      nextInput?.focus();
    }

    const full = newDigits.join('');
    if (full.length === 6) {
      handleVerifyCode(full);
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !codeDigits[index] && index > 0) {
      const prevInput = document.getElementById(`sms-digit-${index - 1}`);
      prevInput?.focus();
    }
  };

  // Handle Verify CTA
  const handleVerifyCode = (codeToVerify?: string) => {
    const code = codeToVerify || codeDigits.join('');
    if (code.length < 6) {
      setCodeError('請輸入完整 6 位數驗證碼');
      return;
    }

    setIsVerifying(true);
    setTimeout(() => {
      setIsVerifying(false);
      updateFormData({
        smsCode: code,
        smsVerifiedAt: codeSentTime,
      });
      onNext();
    }, 600);
  };

  // Demo fill 123456
  const handleFillDemoCode = () => {
    const demo = ['1', '2', '3', '4', '5', '6'];
    setCodeDigits(demo);
    setCodeError('');
    handleVerifyCode('123456');
  };

  const maskedPhone = formData.phone
    ? `${formData.phone.slice(0, 4)} xxx ${formData.phone.slice(-3)}`
    : phoneInput.length === 10
    ? `${phoneInput.slice(0, 4)} xxx ${phoneInput.slice(-3)}`
    : '09xx xxx xxx';

  return (
    <div className="flex flex-col flex-1 px-5 pt-3 pb-8 bg-white select-none">
      {/* Step Header */}
      <div className="mb-4">
        <span className="text-[11px] font-bold text-sky-600 bg-sky-50 px-2 py-0.5 rounded-md border border-sky-100">
          Step 1 / 6
        </span>
        <h1 className="text-xl font-black text-slate-900 tracking-tight mt-1.5">
          驗證手機號碼
        </h1>
        <p className="text-xs text-slate-500 mt-0.5">
          {phase === 'input_phone'
            ? '請輸入手機號碼，我們將傳送動態簡訊驗證碼。'
            : `驗證碼已傳送至 ${maskedPhone}`}
        </p>
      </div>

      {/* PHASE 1: INPUT PHONE NUMBER
          2026-08-28：原本外層是 flex-1 justify-between，想把按鈕釘在
          畫面最下方，但這一階段內容很短（只有一個輸入框），真人手機
          測試回報「下面一整塊看起來是無效介面」——justify-between 在
          內容短、容器又撐滿全螢幕高度時，會留下一大塊視覺上像是壞掉
          的空白區域。改成讓按鈕自然接在內容後面，不強行釘底。 */}
      {phase === 'input_phone' && (
        <div className="flex flex-col space-y-6">
          <div className="space-y-4">
            {/* Phone Input Box */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700">手機號碼</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <Phone className="h-4 w-4" />
                </div>
                <input
                  id="mobile-phone-input"
                  type="tel"
                  maxLength={10}
                  value={phoneInput}
                  onChange={(e) => {
                    setPhoneInput(e.target.value.replace(/\D/g, ''));
                    setPhoneError('');
                  }}
                  placeholder="0912345678"
                  className={`w-full pl-10 pr-4 py-3 rounded-2xl border text-sm font-semibold tracking-wide transition-all outline-none ${
                    phoneError
                      ? 'border-rose-300 bg-rose-50/50 text-rose-900 focus:ring-2 focus:ring-rose-400'
                      : 'border-slate-200 bg-slate-50/70 text-slate-900 focus:bg-white focus:border-sky-500 focus:ring-2 focus:ring-sky-200'
                  }`}
                />
              </div>
              {phoneError && (
                <p className="text-[11px] text-rose-500 font-medium pl-1">{phoneError}</p>
              )}
            </div>

            {/* Quick Demo Picker (Secondary) */}
            <div className="pt-2">
              <DemoUserPicker onSelectUser={handleSelectDemoUser} />
            </div>
          </div>

          {/* Primary CTA */}
          <div>
            <button
              id="get-sms-code-btn"
              type="button"
              onClick={handleSendCode}
              className="w-full py-3.5 px-6 rounded-2xl bg-sky-500 hover:bg-sky-600 active:bg-sky-700 text-white font-bold text-sm shadow-lg shadow-sky-500/20 flex items-center justify-center gap-2 transition-all cursor-pointer"
            >
              <span>取得驗證碼</span>
              <ArrowRight className="h-4 w-4 stroke-[2.5]" />
            </button>
          </div>
        </div>
      )}

      {/* PHASE 2: 5-MIN COUNTDOWN & 6-DIGIT CODE VERIFICATION */}
      {phase === 'input_code' && (
        <div className="flex flex-col space-y-6">
          <div className="space-y-4">
            {/* 5 Minutes Countdown Notice */}
            <div className="flex items-center justify-between p-3 rounded-2xl bg-sky-50/70 border border-sky-100 text-xs">
              <span className="text-slate-600 font-medium">驗證碼有效時間 (5分鐘)</span>
              <SessionCountdownBadge startTime={codeSentTime} totalSeconds={300} compact={true} />
            </div>

            {/* 6 Digit Input Boxes */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-700">6 位數驗證碼</label>
              <div className="flex items-center justify-between gap-1.5">
                {codeDigits.map((digit, idx) => (
                  <input
                    key={idx}
                    id={`sms-digit-${idx}`}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleDigitChange(idx, e.target.value)}
                    onKeyDown={(e) => handleKeyDown(idx, e)}
                    className="w-11 h-13 sm:w-12 sm:h-14 text-center text-xl font-black rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:border-sky-500 focus:ring-2 focus:ring-sky-200 outline-none transition-all"
                  />
                ))}
              </div>
              {codeError && (
                <p className="text-[11px] text-rose-500 font-medium pl-1">{codeError}</p>
              )}
            </div>

            {/* Resend Code / Change Phone */}
            <div className="flex items-center justify-between text-xs pt-1">
              <button
                type="button"
                onClick={() => setPhase('input_phone')}
                className="text-slate-400 hover:text-slate-600 font-medium cursor-pointer"
              >
                修改手機號碼
              </button>
              <button
                type="button"
                onClick={() => {
                  setCodeSentTime(Date.now());
                  setCodeDigits(['', '', '', '', '', '']);
                }}
                className="text-sky-600 hover:text-sky-700 font-bold cursor-pointer"
              >
                重新發送驗證碼
              </button>
            </div>

            {/* Mock SMS Demo Fill Button (Subtle & Secondary) */}
            <div className="pt-3 border-t border-slate-100 flex justify-center">
              <button
                id="demo-fill-sms-btn"
                type="button"
                onClick={handleFillDemoCode}
                className="px-3.5 py-1.5 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-all border border-slate-200/80"
              >
                <Sparkles className="h-3 w-3 text-amber-500" />
                <span>填入示範驗證碼 (123456)</span>
              </button>
            </div>
          </div>

          {/* Primary CTA: 驗證 */}
          <div>
            <button
              id="verify-sms-submit-btn"
              type="button"
              disabled={isVerifying}
              onClick={() => handleVerifyCode()}
              className="w-full py-3.5 px-6 rounded-2xl bg-sky-500 hover:bg-sky-600 active:bg-sky-700 text-white font-bold text-sm shadow-lg shadow-sky-500/20 flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50"
            >
              <span>{isVerifying ? '驗證中…' : '驗證'}</span>
              <ArrowRight className="h-4 w-4 stroke-[2.5]" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
