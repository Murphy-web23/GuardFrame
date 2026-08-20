import React, { useState } from 'react';
import { FormData } from '../../../types';
import { 
  CreditCard, 
  Globe, 
  Bell, 
  Check, 
  Sparkles, 
  Smartphone, 
  Mail, 
  ArrowRight,
  Fingerprint,
  ReceiptText,
  ShieldCheck
} from 'lucide-react';

interface DesktopFeatureSelectionProps {
  formData: FormData;
  updateFormData: (data: Partial<FormData>) => void;
  onNext: () => void;
}

export const DesktopFeatureSelection: React.FC<DesktopFeatureSelectionProps> = ({
  formData,
  updateFormData,
  onNext,
}) => {
  const [cardStyle, setCardStyle] = useState<'style_a' | 'style_b'>(formData.cardStyle || 'style_a');
  const [applyOnlineBanking, setApplyOnlineBanking] = useState<boolean>(
    formData.applyOnlineBanking ?? true
  );
  const [enableBiometricLogin, setEnableBiometricLogin] = useState<boolean>(
    formData.enableBiometricLogin ?? true
  );
  const [enableEStatement, setEnableEStatement] = useState<boolean>(
    formData.enableEStatement ?? true
  );
  const [notificationMethod, setNotificationMethod] = useState<'sms' | 'email' | 'both'>(
    formData.notificationMethod || 'both'
  );

  const handleProceedNext = () => {
    updateFormData({
      cardStyle,
      applyOnlineBanking,
      enableBiometricLogin,
      enableEStatement,
      notificationMethod,
    });
    onNext();
  };

  return (
    <div className="flex flex-col flex-1 justify-center py-6 px-4 sm:px-8 max-w-4xl mx-auto w-full">
      <div className="bg-white p-8 sm:p-10 rounded-3xl border border-slate-200/80 shadow-xs space-y-6">
        <div>
          <span className="text-xs font-bold text-sky-600 bg-sky-50 px-2.5 py-1 rounded-md border border-sky-100">
            Step 5 / 6
          </span>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight mt-2">
            設定開戶服務與功能偏好
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            自訂您的數位金融卡卡面、網路銀行及各項智慧通知管道。
          </p>
        </div>

        {/* 2-Column Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
          {/* Left Column: Card Selection & Notification Method */}
          <div className="space-y-5">
            {/* 1. Card Selection */}
            <div className="space-y-2.5">
              <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                <CreditCard className="h-4 w-4 text-sky-600" />
                <span>金融卡卡面樣式選擇</span>
              </label>

              <div className="grid grid-cols-2 gap-3">
                {/* Style A */}
                <div
                  id="desktop-card-style-a"
                  onClick={() => setCardStyle('style_a')}
                  className={`p-3.5 rounded-2xl border-2 transition-all cursor-pointer flex flex-col justify-between aspect-[16/10] relative ${
                    cardStyle === 'style_a'
                      ? 'border-sky-500 bg-gradient-to-br from-sky-600 to-indigo-800 text-white shadow-md ring-2 ring-sky-200'
                      : 'border-slate-200 bg-slate-800 text-slate-300 opacity-70 hover:opacity-90'
                  }`}
                >
                  <div className="flex justify-between items-start">
                    <span className="text-xs font-bold tracking-wider">GuardFrame</span>
                    {cardStyle === 'style_a' && (
                      <div className="h-4 w-4 rounded-full bg-white text-sky-600 flex items-center justify-center">
                        <Check className="h-3 w-3 stroke-[3]" />
                      </div>
                    )}
                  </div>
                  <div>
                    <span className="text-xs font-bold">極簡深海藍 (經典)</span>
                    <p className="text-[10px] opacity-75 font-mono">•••• 8820</p>
                  </div>
                </div>

                {/* Style B */}
                <div
                  id="desktop-card-style-b"
                  onClick={() => setCardStyle('style_b')}
                  className={`p-3.5 rounded-2xl border-2 transition-all cursor-pointer flex flex-col justify-between aspect-[16/10] relative ${
                    cardStyle === 'style_b'
                      ? 'border-sky-500 bg-gradient-to-br from-sky-50 via-white to-emerald-50 text-slate-900 shadow-md ring-2 ring-sky-200'
                      : 'border-slate-200 bg-slate-100 text-slate-700 opacity-70 hover:opacity-90'
                  }`}
                >
                  <div className="flex justify-between items-start">
                    <span className="text-xs font-bold text-sky-700 tracking-wider">GuardFrame</span>
                    {cardStyle === 'style_b' && (
                      <div className="h-4 w-4 rounded-full bg-sky-500 text-white flex items-center justify-center">
                        <Check className="h-3 w-3 stroke-[3]" />
                      </div>
                    )}
                  </div>
                  <div>
                    <span className="text-xs font-bold text-slate-900">極光冰川白 (限定)</span>
                    <p className="text-[10px] text-slate-500 font-mono">•••• 8820</p>
                  </div>
                </div>
              </div>
            </div>

            {/* 2. Notification Method */}
            <div className="space-y-2.5">
              <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                <Bell className="h-4 w-4 text-sky-600" />
                <span>帳務異動即時通知管道</span>
              </label>

              <div className="grid grid-cols-3 gap-2.5">
                {[
                  { id: 'both', label: '簡訊 + Email', icon: Sparkles, desc: '最完整' },
                  { id: 'sms', label: '僅簡訊通知', icon: Smartphone, desc: '即時性' },
                  { id: 'email', label: '僅電子郵件', icon: Mail, desc: '無紙化' },
                ].map((item) => (
                  <div
                    key={item.id}
                    id={`desktop-notify-${item.id}`}
                    onClick={() => setNotificationMethod(item.id as any)}
                    className={`p-3 rounded-2xl border text-center cursor-pointer transition-all flex flex-col items-center justify-center ${
                      notificationMethod === item.id
                        ? 'border-sky-500 bg-sky-50/70 text-sky-900 shadow-xs ring-1 ring-sky-200'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <item.icon className={`h-4 w-4 mb-1.5 ${notificationMethod === item.id ? 'text-sky-600' : 'text-slate-400'}`} />
                    <span className="text-xs font-bold">{item.label}</span>
                    <span className="text-[10px] text-slate-400 mt-0.5">{item.desc}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right Column: Digital Services Features */}
          <div className="space-y-3">
            <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
              <Globe className="h-4 w-4 text-sky-600" />
              <span>附加數位金融服務設定</span>
            </label>

            <div className="space-y-2.5">
              {/* Online Banking */}
              <div
                id="desktop-toggle-online-banking"
                onClick={() => setApplyOnlineBanking(!applyOnlineBanking)}
                className={`p-3.5 rounded-2xl border transition-all cursor-pointer flex items-center justify-between ${
                  applyOnlineBanking
                    ? 'border-sky-300 bg-sky-50/60'
                    : 'border-slate-200 bg-slate-50 hover:bg-slate-100'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-xl bg-white border border-sky-200 flex items-center justify-center text-sky-600 shrink-0 shadow-xs">
                    <Globe className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-bold text-slate-900">申請網路銀行暨行動銀行</span>
                      <span className="text-[10px] font-bold text-sky-600 bg-sky-100 px-1.5 py-0.2 rounded">推薦</span>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      開戶完成自動啟用 App 24hr 即時跨行轉帳與理財
                    </p>
                  </div>
                </div>
                <div
                  className={`w-5 h-5 rounded-md border flex items-center justify-center transition-colors ${
                    applyOnlineBanking
                      ? 'bg-sky-500 border-sky-500 text-white'
                      : 'border-slate-300 bg-white'
                  }`}
                >
                  {applyOnlineBanking && <Check className="h-3.5 w-3.5 stroke-[3]" />}
                </div>
              </div>

              {/* Biometric login */}
              <div
                id="desktop-toggle-biometric"
                onClick={() => setEnableBiometricLogin(!enableBiometricLogin)}
                className={`p-3.5 rounded-2xl border transition-all cursor-pointer flex items-center justify-between ${
                  enableBiometricLogin
                    ? 'border-sky-300 bg-sky-50/60'
                    : 'border-slate-200 bg-slate-50 hover:bg-slate-100'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-xl bg-white border border-sky-200 flex items-center justify-center text-sky-600 shrink-0 shadow-xs">
                    <Fingerprint className="h-4 w-4" />
                  </div>
                  <div>
                    <span className="text-xs font-bold text-slate-900">啟用 Face ID / 指紋快速登入</span>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      結合剛完成之活體人臉驗證，日常登入與轉帳免重複輸入密碼
                    </p>
                  </div>
                </div>
                <div
                  className={`w-5 h-5 rounded-md border flex items-center justify-center transition-colors ${
                    enableBiometricLogin
                      ? 'bg-sky-500 border-sky-500 text-white'
                      : 'border-slate-300 bg-white'
                  }`}
                >
                  {enableBiometricLogin && <Check className="h-3.5 w-3.5 stroke-[3]" />}
                </div>
              </div>

              {/* E-statement */}
              <div
                id="desktop-toggle-estatement"
                onClick={() => setEnableEStatement(!enableEStatement)}
                className={`p-3.5 rounded-2xl border transition-all cursor-pointer flex items-center justify-between ${
                  enableEStatement
                    ? 'border-sky-300 bg-sky-50/60'
                    : 'border-slate-200 bg-slate-50 hover:bg-slate-100'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-xl bg-white border border-sky-200 flex items-center justify-center text-sky-600 shrink-0 shadow-xs">
                    <ReceiptText className="h-4 w-4" />
                  </div>
                  <div>
                    <span className="text-xs font-bold text-slate-900">申辦電子綜合對帳單 (免紙本)</span>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      每月寄送高安全加密電子對帳單至您的電子信箱
                    </p>
                  </div>
                </div>
                <div
                  className={`w-5 h-5 rounded-md border flex items-center justify-center transition-colors ${
                    enableEStatement
                      ? 'bg-sky-500 border-sky-500 text-white'
                      : 'border-slate-300 bg-white'
                  }`}
                >
                  {enableEStatement && <Check className="h-3.5 w-3.5 stroke-[3]" />}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Action Button: Go to Step 6 */}
        <div className="pt-4 border-t border-slate-100 flex justify-end">
          <button
            id="desktop-proceed-to-terms-btn"
            type="button"
            onClick={handleProceedNext}
            className="py-3.5 px-8 rounded-2xl bg-sky-500 hover:bg-sky-600 active:bg-sky-700 text-white font-bold text-sm shadow-md shadow-sky-200 flex items-center gap-2 transition-all cursor-pointer"
          >
            <span>下一步：確認法定條款與送審</span>
            <ArrowRight className="h-4 w-4 stroke-[2.5]" />
          </button>
        </div>
      </div>
    </div>
  );
};
