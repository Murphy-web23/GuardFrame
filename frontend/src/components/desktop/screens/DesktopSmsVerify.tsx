import React, { useState } from 'react';
import { FormData } from '../../../types';
import { ArrowRight, Phone, Sparkles } from 'lucide-react';
import { SessionCountdownBadge } from '../../common/SessionCountdownBadge';
import { DemoUserPicker } from '../../common/DemoUserPicker';
import { DemoUser } from '../../../data/demoUsers';

interface DesktopSmsVerifyProps {
  formData: FormData;
  updateFormData: (data: Partial<FormData>) => void;
  onNext: () => void;
}

export const DesktopSmsVerify: React.FC<DesktopSmsVerifyProps> = ({
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

  // 2026-08-22：跟 SmsVerifyScreen.tsx（手機版）同樣的修法，見那邊的
  // 說明——原本沒寫進 formData，導致「確認個人資料」步驟示範資料
  // 選到不同一組人，姓名/身分證跟這裡實際驗證的手機號碼對不上。
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

  const handleDigitChange = (index: number, val: string) => {
    const clean = val.replace(/\D/g, '').slice(-1);
    const newDigits = [...codeDigits];
    newDigits[index] = clean;
    setCodeDigits(newDigits);
    setCodeError('');

    if (clean && index < 5) {
      const nextInput = document.getElementById(`desktop-sms-digit-${index + 1}`);
      nextInput?.focus();
    }

    const full = newDigits.join('');
    if (full.length === 6) {
      handleVerifyCode(full);
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !codeDigits[index] && index > 0) {
      const prevInput = document.getElementById(`desktop-sms-digit-${index - 1}`);
      prevInput?.focus();
    }
  };

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
    <div className="flex flex-col flex-1 justify-center py-6 px-4 sm:px-8 max-w-2xl mx-auto w-full">
      <div className="bg-white p-8 sm:p-10 rounded-3xl border border-slate-200/80 shadow-xs space-y-6">
        <div>
          <span className="text-xs font-bold text-sky-600 bg-sky-50 px-2.5 py-1 rounded-md border border-sky-100">
            Step 1 / 6
          </span>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight mt-2">
            驗證手機號碼
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            {phase === 'input_phone'
              ? '請輸入手機號碼，我們將傳送動態簡訊驗證碼。'
              : `驗證碼已傳送至 ${maskedPhone}`}
          </p>
        </div>

        {phase === 'input_phone' ? (
          <div className="space-y-6">
            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-700">手機號碼</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-400">
                  <Phone className="h-5 w-5" />
                </div>
                <input
                  id="desktop-phone-input"
                  type="tel"
                  maxLength={10}
                  value={phoneInput}
                  onChange={(e) => {
                    setPhoneInput(e.target.value.replace(/\D/g, ''));
                    setPhoneError('');
                  }}
                  placeholder="0912345678"
                  className={`w-full pl-11 pr-4 py-3.5 rounded-2xl border text-base font-semibold tracking-wide outline-none transition-all ${
                    phoneError
                      ? 'border-rose-300 bg-rose-50/50 text-rose-900 focus:ring-2 focus:ring-rose-400'
                      : 'border-slate-200 bg-slate-50/70 text-slate-900 focus:bg-white focus:border-sky-500 focus:ring-2 focus:ring-sky-200'
                  }`}
                />
              </div>
              {phoneError && (
                <p className="text-xs text-rose-500 font-medium pl-1">{phoneError}</p>
              )}
            </div>

            <div className="pt-1">
              <DemoUserPicker onSelectUser={handleSelectDemoUser} />
            </div>

            <button
              id="desktop-get-sms-code-btn"
              type="button"
              onClick={handleSendCode}
              className="w-full py-4 px-6 rounded-2xl bg-sky-500 hover:bg-sky-600 active:bg-sky-700 text-white font-bold text-base shadow-lg shadow-sky-500/20 flex items-center justify-center gap-2 transition-all cursor-pointer"
            >
              <span>取得驗證碼</span>
              <ArrowRight className="h-5 w-5 stroke-[2.5]" />
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex items-center justify-between p-3.5 rounded-2xl bg-sky-50/70 border border-sky-100 text-sm">
              <span className="text-slate-600 font-medium">驗證碼有效時間 (5分鐘)</span>
              <SessionCountdownBadge startTime={codeSentTime} totalSeconds={300} />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-700">6 位數驗證碼</label>
              <div className="flex items-center justify-between gap-3 max-w-md mx-auto">
                {codeDigits.map((digit, idx) => (
                  <input
                    key={idx}
                    id={`desktop-sms-digit-${idx}`}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleDigitChange(idx, e.target.value)}
                    onKeyDown={(e) => handleKeyDown(idx, e)}
                    className="w-14 h-16 text-center text-2xl font-black rounded-2xl border border-slate-200 bg-slate-50 focus:bg-white focus:border-sky-500 focus:ring-2 focus:ring-sky-200 outline-none transition-all"
                  />
                ))}
              </div>
              {codeError && (
                <p className="text-xs text-rose-500 font-medium text-center">{codeError}</p>
              )}
            </div>

            <div className="flex items-center justify-between text-sm pt-2">
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

            <div className="pt-2 border-t border-slate-100 flex justify-center">
              <button
                id="desktop-demo-fill-sms-btn"
                type="button"
                onClick={handleFillDemoCode}
                className="px-4 py-2 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-semibold flex items-center gap-2 cursor-pointer transition-all border border-slate-200/80"
              >
                <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                <span>填入示範驗證碼 (123456)</span>
              </button>
            </div>

            <button
              id="desktop-verify-sms-submit-btn"
              type="button"
              disabled={isVerifying}
              onClick={() => handleVerifyCode()}
              className="w-full py-4 px-6 rounded-2xl bg-sky-500 hover:bg-sky-600 active:bg-sky-700 text-white font-bold text-base shadow-lg shadow-sky-500/20 flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50"
            >
              <span>{isVerifying ? '驗證中…' : '驗證'}</span>
              <ArrowRight className="h-5 w-5 stroke-[2.5]" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
