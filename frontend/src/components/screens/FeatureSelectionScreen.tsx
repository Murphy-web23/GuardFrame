import React, { useState } from 'react';
import { FormData } from '../../types';
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
  ReceiptText
} from 'lucide-react';

interface FeatureSelectionScreenProps {
  formData: FormData;
  updateFormData: (data: Partial<FormData>) => void;
  onNext: () => void;
}

export const FeatureSelectionScreen: React.FC<FeatureSelectionScreenProps> = ({
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
    <div className="flex flex-col flex-1 px-5 pt-3 pb-8 bg-white select-none">
      {/* Step Header */}
      <div className="mb-4">
        <span className="text-[11px] font-bold text-sky-600 bg-sky-50 px-2 py-0.5 rounded-md border border-sky-100">
          Step 5 / 6
        </span>
        <h1 className="text-xl font-black text-slate-900 tracking-tight mt-1.5">
          設定開戶服務功能
        </h1>
        <p className="text-xs text-slate-500 mt-0.5">
          自訂您的數位金融卡卡面、網路銀行及通知功能偏好。
        </p>
      </div>

      <div className="space-y-5 flex-1">
        {/* 1. 金融卡卡面選擇 */}
        <div className="space-y-2">
          <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
            <CreditCard className="h-4 w-4 text-sky-600" />
            <span>金融卡卡面選擇</span>
          </label>
          <div className="grid grid-cols-2 gap-3">
            {/* Style A: 極簡曜石藍 */}
            <div
              id="card-style-a"
              onClick={() => setCardStyle('style_a')}
              className={`p-3 rounded-2xl border-2 transition-all cursor-pointer flex flex-col justify-between aspect-[16/10] relative ${
                cardStyle === 'style_a'
                  ? 'border-sky-500 bg-gradient-to-br from-sky-600 to-indigo-800 text-white shadow-md'
                  : 'border-slate-200 bg-gradient-to-br from-slate-700 to-slate-900 text-slate-200 opacity-70 hover:opacity-90'
              }`}
            >
              <div className="flex justify-between items-start">
                <span className="text-[11px] font-bold tracking-wider">GuardFrame</span>
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

            {/* Style B: 珍珠極光白 */}
            <div
              id="card-style-b"
              onClick={() => setCardStyle('style_b')}
              className={`p-3 rounded-2xl border-2 transition-all cursor-pointer flex flex-col justify-between aspect-[16/10] relative ${
                cardStyle === 'style_b'
                  ? 'border-sky-500 bg-gradient-to-br from-sky-50 via-white to-emerald-50 text-slate-900 shadow-md ring-2 ring-sky-200'
                  : 'border-slate-200 bg-slate-100 text-slate-700 opacity-70 hover:opacity-90'
              }`}
            >
              <div className="flex justify-between items-start">
                <span className="text-[11px] font-bold text-sky-700 tracking-wider">GuardFrame</span>
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

        {/* 2. 附加金融服務 (網路銀行、生物辨識、電子帳單) */}
        <div className="space-y-2">
          <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
            <Globe className="h-4 w-4 text-sky-600" />
            <span>數位帳戶服務功能</span>
          </label>

          <div className="space-y-2">
            {/* Online Banking */}
            <div
              id="toggle-online-banking"
              onClick={() => setApplyOnlineBanking(!applyOnlineBanking)}
              className={`p-3 rounded-2xl border transition-all cursor-pointer flex items-center justify-between ${
                applyOnlineBanking
                  ? 'border-sky-300 bg-sky-50/60'
                  : 'border-slate-200 bg-slate-50 hover:bg-slate-100'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-xl bg-white border border-sky-200 flex items-center justify-center text-sky-600 shrink-0 shadow-xs">
                  <Globe className="h-4 w-4" />
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-bold text-slate-900">申請網路銀行暨行動銀行</span>
                    <span className="text-[10px] font-bold text-sky-600 bg-sky-100/80 px-1.5 py-0.2 rounded">推薦</span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    開戶完成後自動開通 App 即時轉帳與數位理財功能
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
              id="toggle-biometric"
              onClick={() => setEnableBiometricLogin(!enableBiometricLogin)}
              className={`p-3 rounded-2xl border transition-all cursor-pointer flex items-center justify-between ${
                enableBiometricLogin
                  ? 'border-sky-300 bg-sky-50/60'
                  : 'border-slate-200 bg-slate-50 hover:bg-slate-100'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-xl bg-white border border-sky-200 flex items-center justify-center text-sky-600 shrink-0 shadow-xs">
                  <Fingerprint className="h-4 w-4" />
                </div>
                <div>
                  <span className="text-xs font-bold text-slate-900">啟用 Face ID / 指紋快速登入</span>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    結合本次人臉核驗，登入與轉帳免重複手動輸入密碼
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
              id="toggle-estatement"
              onClick={() => setEnableEStatement(!enableEStatement)}
              className={`p-3 rounded-2xl border transition-all cursor-pointer flex items-center justify-between ${
                enableEStatement
                  ? 'border-sky-300 bg-sky-50/60'
                  : 'border-slate-200 bg-slate-50 hover:bg-slate-100'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-xl bg-white border border-sky-200 flex items-center justify-center text-sky-600 shrink-0 shadow-xs">
                  <ReceiptText className="h-4 w-4" />
                </div>
                <div>
                  <span className="text-xs font-bold text-slate-900">申辦電子綜合對帳單 (免紙本)</span>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    每月寄送高安全加密電子帳單至個人電子信箱
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

        {/* 3. 帳務通知管道 */}
        <div className="space-y-2">
          <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
            <Bell className="h-4 w-4 text-sky-600" />
            <span>帳務異動即時通知管道</span>
          </label>

          <div className="grid grid-cols-3 gap-2">
            {[
              { id: 'both', label: '簡訊 + Email', icon: Sparkles, desc: '最完整' },
              { id: 'sms', label: '僅簡訊通知', icon: Smartphone, desc: '即時性' },
              { id: 'email', label: '僅電子郵件', icon: Mail, desc: '無紙化' },
            ].map((item) => (
              <div
                key={item.id}
                id={`notify-option-${item.id}`}
                onClick={() => setNotificationMethod(item.id as any)}
                className={`p-2.5 rounded-xl border text-center cursor-pointer transition-all flex flex-col items-center justify-center ${
                  notificationMethod === item.id
                    ? 'border-sky-500 bg-sky-50/70 text-sky-900 shadow-xs'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                <item.icon className={`h-4 w-4 mb-1 ${notificationMethod === item.id ? 'text-sky-600' : 'text-slate-400'}`} />
                <span className="text-xs font-bold">{item.label}</span>
                <span className="text-[10px] text-slate-400 mt-0.5">{item.desc}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Next Step CTA -> Step 6 (Terms & Submit) */}
      <div className="pt-4 mt-auto">
        <button
          id="proceed-to-terms-btn"
          type="button"
          onClick={handleProceedNext}
          className="w-full py-3.5 px-6 rounded-2xl font-bold text-sm bg-sky-500 hover:bg-sky-600 active:bg-sky-700 text-white shadow-lg shadow-sky-500/20 flex items-center justify-center gap-2 transition-all cursor-pointer"
        >
          <span>下一步：確認條款與送審</span>
          <ArrowRight className="h-4 w-4 stroke-[2.5]" />
        </button>
      </div>
    </div>
  );
};
