import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { FormData } from '../../../types';
import { 
  ShieldCheck, 
  FileText, 
  ExternalLink, 
  X, 
  ArrowRight, 
  CheckCircle2,
  AlertCircle,
  Lock,
  CreditCard,
  User,
  Bell,
  Check,
  Smartphone,
  Globe,
  Shield
} from 'lucide-react';
import { setupAccount, waitForVerifyResult } from '../../../api/client';

interface DesktopTermsSubmitProps {
  formData: FormData;
  updateFormData: (data: Partial<FormData>) => void;
  onNext: () => void;
}

export const DesktopTermsSubmit: React.FC<DesktopTermsSubmitProps> = ({
  formData,
  updateFormData,
  onNext,
}) => {
  // Terms Agreement States
  const [agreeTerms, setAgreeTerms] = useState<boolean>(formData.agreeTerms ?? false);
  const [agreePrivacy, setAgreePrivacy] = useState<boolean>(formData.agreePrivacy ?? false);
  const [agreeElectronic, setAgreeElectronic] = useState<boolean>(formData.agreeElectronic ?? false);

  // 2026-08-20 新增：見 TermsSubmitScreen.tsx（mobile 版）同一段說明——
  // 後端 account-setup 要求 6 位數交易密碼，前端原本沒有畫面收集這個值。
  const [accountPin, setAccountPin] = useState<string>(formData.accountPin || '');
  const [pinError, setPinError] = useState<string>('');

  // Modal State for Terms viewer
  const [activeModal, setActiveModal] = useState<'terms' | 'privacy' | 'electronic' | null>(null);

  const [showValidationWarning, setShowValidationWarning] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string>('');

  const isAllTermsAgreed = agreeTerms && agreePrivacy && agreeElectronic;

  const handleToggleAllTerms = () => {
    const nextVal = !isAllTermsAgreed;
    setAgreeTerms(nextVal);
    setAgreePrivacy(nextVal);
    setAgreeElectronic(nextVal);
    if (nextVal) setShowValidationWarning(false);
  };

  const handleSubmit = () => {
    if (!isAllTermsAgreed) {
      setShowValidationWarning(true);
      return;
    }
    if (!/^\d{6}$/.test(accountPin)) {
      setPinError('請輸入 6 位數字交易密碼');
      return;
    }
    if (!formData.applicantId || !formData.sessionId) {
      setSubmitError('找不到申請資料，請回到「確認個人資料」重新送出一次');
      return;
    }

    setShowValidationWarning(false);
    setPinError('');
    setSubmitError('');

    // 2026-08-25：見 TermsSubmitScreen.tsx（mobile 版）同一段說明——
    // 不讓使用者卡在這一步等分析結果，立刻記錄資料＋前進，真正的開戶
    // 設定留到背景分析跑完後才默默送出。
    updateFormData({
      agreeTerms,
      agreePrivacy,
      agreeElectronic,
      accountPin,
    });
    onNext();

    const applicantId = formData.applicantId;
    const sessionId = formData.sessionId;
    const cardStyle = formData.cardStyle;
    const notificationMethod = formData.notificationMethod;

    (async () => {
      try {
        const record = await waitForVerifyResult(applicantId, sessionId);
        if (record.decision.verdict === 'reject') {
          updateFormData({ verificationVerdict: 'reject' });
          return;
        }
        await setupAccount(applicantId, sessionId, {
          accountType: cardStyle === 'style_b' ? 'type3' : 'type1',
          transactionPassword: accountPin,
          notificationPreference: {
            sms: notificationMethod === 'sms' || notificationMethod === 'both',
            email: notificationMethod === 'email' || notificationMethod === 'both',
          },
          termsAccepted: true,
        });
        updateFormData({ verificationVerdict: record.decision.verdict });
      } catch (err) {
        console.warn('[背景開戶設定失敗]', err);
      }
    })();
  };

  const cardStyleName = formData.cardStyle === 'style_b' ? '極光冰川白 (限定版)' : '極簡深海藍 (經典版)';
  const notifyName = formData.notificationMethod === 'sms' ? '簡訊通知' : formData.notificationMethod === 'email' ? '電子郵件' : '簡訊 + 電子郵件';

  return (
    <div className="flex flex-col flex-1 justify-center py-6 px-4 sm:px-8 max-w-4xl mx-auto w-full">
      <div className="bg-white p-8 sm:p-10 rounded-3xl border border-slate-200/80 shadow-xs space-y-6">
        <div>
          <span className="text-xs font-bold text-sky-600 bg-sky-50 px-2.5 py-1 rounded-md border border-sky-100">
            Step 6 / 6
          </span>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight mt-2">
            法定條款確認與送出審核
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            請核對您的開戶申請摘要並詳閱法定條款，確認無誤後點擊送出審核。
          </p>
        </div>

        {/* 2-Column Side by Side Layout for Desktop */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: Application Summary (5 cols) */}
          <div className="lg:col-span-5 space-y-4">
            <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-200/70 pb-3">
                <span className="text-sm font-bold text-slate-800 flex items-center gap-2">
                  <User className="h-4 w-4 text-sky-600" />
                  開戶申請人資料摘要
                </span>
                <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200 flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" /> 已防偽核驗
                </span>
              </div>

              <div className="space-y-2.5 text-xs">
                <div className="flex justify-between items-center py-1 border-b border-slate-100">
                  <span className="text-slate-500">中文姓名</span>
                  <span className="font-bold text-slate-900">{formData.fullName || '林語堂'}</span>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-slate-100">
                  <span className="text-slate-500">身分證字號</span>
                  <span className="font-mono font-bold text-slate-900">
                    {formData.idNumber ? `${formData.idNumber.slice(0, 3)}****${formData.idNumber.slice(-2)}` : 'A123456789'}
                  </span>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-slate-100">
                  <span className="text-slate-500">驗證手機</span>
                  <span className="font-mono text-slate-800">{formData.phone || '0912-345-678'}</span>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-slate-100">
                  <span className="text-slate-500">金融卡面</span>
                  <span className="font-semibold text-sky-700">{cardStyleName}</span>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-slate-100">
                  <span className="text-slate-500">網路銀行服務</span>
                  <span className="font-semibold text-emerald-600">已啟用 (全功能)</span>
                </div>
                <div className="flex justify-between items-center py-1">
                  <span className="text-slate-500">即時通知管道</span>
                  <span className="font-semibold text-slate-800">{notifyName}</span>
                </div>
              </div>
            </div>

            {/* Security Guarantee Notice */}
            <div className="p-3.5 rounded-xl bg-emerald-50/60 border border-emerald-200/70 text-xs text-emerald-800 flex items-start gap-2.5">
              <ShieldCheck className="h-4 w-4 text-emerald-600 flex-shrink-0 mt-0.5" />
              <div>
                <span className="font-bold">金管會金融級端對端加密</span>
                <p className="text-[11px] text-emerald-700 mt-0.5">
                  所有送審資料皆以 TLS 1.3 / 256-bit 傳輸，並依個人資料保護法嚴格存取控管。
                </p>
              </div>
            </div>
          </div>

          {/* Right Column: Legal Terms Checklist & Submit (7 cols) */}
          <div className="lg:col-span-7 space-y-4">
            {/* Transaction Password (6-digit PIN) */}
            <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-2">
              <label htmlFor="desktop-account-pin" className="text-sm font-bold text-slate-800 flex items-center gap-2">
                <Lock className="h-4 w-4 text-sky-600" />
                <span>設定交易密碼（6 位數字）</span>
              </label>
              <input
                id="desktop-account-pin"
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={accountPin}
                onChange={(e) => {
                  setAccountPin(e.target.value.replace(/\D/g, '').slice(0, 6));
                  setPinError('');
                }}
                placeholder="請輸入 6 位數字"
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-semibold tracking-[0.3em] text-slate-900 focus:border-sky-500 focus:ring-2 focus:ring-sky-200 outline-none"
              />
              {pinError && <p className="text-xs text-rose-500 font-medium">{pinError}</p>}
            </div>

            <div className="p-5 rounded-2xl bg-sky-50/40 border border-sky-100 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-slate-800 flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-sky-600" />
                  <span>法定約定書與聲明條款</span>
                </span>

                <button
                  type="button"
                  onClick={handleToggleAllTerms}
                  className="text-xs font-bold text-sky-600 hover:text-sky-700 flex items-center gap-1.5 bg-white px-3 py-1.5 rounded-xl border border-sky-200 cursor-pointer active:scale-95 transition-all shadow-2xs"
                >
                  <Check className={`h-3.5 w-3.5 ${isAllTermsAgreed ? 'text-emerald-500' : 'text-slate-400'}`} />
                  <span>{isAllTermsAgreed ? '全部已同意' : '一鍵全部同意'}</span>
                </button>
              </div>

              <div className="space-y-2.5 text-xs">
                {/* Term 1 */}
                <div className="flex items-start gap-3 bg-white p-3.5 rounded-xl border border-slate-200/80 hover:border-sky-200 transition-colors">
                  <input
                    id="desktop-agree-terms"
                    type="checkbox"
                    checked={agreeTerms}
                    onChange={(e) => {
                      setAgreeTerms(e.target.checked);
                      if (e.target.checked && agreePrivacy && agreeElectronic) setShowValidationWarning(false);
                    }}
                    className="mt-0.5 h-4 w-4 text-sky-600 rounded-sm border-slate-300 focus:ring-sky-500 cursor-pointer"
                  />
                  <div className="flex-1 flex items-center justify-between">
                    <label htmlFor="desktop-agree-terms" className="text-xs text-slate-700 cursor-pointer font-medium">
                      我已詳閱並同意 <span className="font-bold text-slate-900">數位存款帳戶開戶總約定書</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => setActiveModal('terms')}
                      className="text-xs font-bold text-sky-600 hover:text-sky-700 flex items-center gap-1 ml-2 flex-shrink-0 cursor-pointer"
                    >
                      <span>詳閱條款</span>
                      <ExternalLink className="h-3 w-3" />
                    </button>
                  </div>
                </div>

                {/* Term 2 */}
                <div className="flex items-start gap-3 bg-white p-3.5 rounded-xl border border-slate-200/80 hover:border-sky-200 transition-colors">
                  <input
                    id="desktop-agree-privacy"
                    type="checkbox"
                    checked={agreePrivacy}
                    onChange={(e) => {
                      setAgreePrivacy(e.target.checked);
                      if (agreeTerms && e.target.checked && agreeElectronic) setShowValidationWarning(false);
                    }}
                    className="mt-0.5 h-4 w-4 text-sky-600 rounded-sm border-slate-300 focus:ring-sky-500 cursor-pointer"
                  />
                  <div className="flex-1 flex items-center justify-between">
                    <label htmlFor="desktop-agree-privacy" className="text-xs text-slate-700 cursor-pointer font-medium">
                      我已詳閱 <span className="font-bold text-slate-900">個人資料保護法應告知事項</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => setActiveModal('privacy')}
                      className="text-xs font-bold text-sky-600 hover:text-sky-700 flex items-center gap-1 ml-2 flex-shrink-0 cursor-pointer"
                    >
                      <span>詳閱條款</span>
                      <ExternalLink className="h-3 w-3" />
                    </button>
                  </div>
                </div>

                {/* Term 3 */}
                <div className="flex items-start gap-3 bg-white p-3.5 rounded-xl border border-slate-200/80 hover:border-sky-200 transition-colors">
                  <input
                    id="desktop-agree-electronic"
                    type="checkbox"
                    checked={agreeElectronic}
                    onChange={(e) => {
                      setAgreeElectronic(e.target.checked);
                      if (agreeTerms && agreePrivacy && e.target.checked) setShowValidationWarning(false);
                    }}
                    className="mt-0.5 h-4 w-4 text-sky-600 rounded-sm border-slate-300 focus:ring-sky-500 cursor-pointer"
                  />
                  <div className="flex-1 flex items-center justify-between">
                    <label htmlFor="desktop-agree-electronic" className="text-xs text-slate-700 cursor-pointer font-medium">
                      同意遵守 <span className="font-bold text-slate-900">電子銀行服務作業條款</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => setActiveModal('electronic')}
                      className="text-xs font-bold text-sky-600 hover:text-sky-700 flex items-center gap-1 ml-2 flex-shrink-0 cursor-pointer"
                    >
                      <span>詳閱條款</span>
                      <ExternalLink className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Validation Warning */}
            {showValidationWarning && (
              <motion.div
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 flex items-center gap-2.5 text-rose-700 text-xs font-semibold"
              >
                <AlertCircle className="h-4 w-4 text-rose-500 flex-shrink-0" />
                <span>請勾選同意全部 3 項開戶條款後方可送出審核。</span>
              </motion.div>
            )}

            {submitError && (
              <motion.div
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 flex items-center gap-2.5 text-rose-700 text-xs font-semibold"
              >
                <AlertCircle className="h-4 w-4 text-rose-500 flex-shrink-0" />
                <span>{submitError}</span>
              </motion.div>
            )}

            {/* Submit Action Button */}
            <div className="pt-2">
              <button
                id="desktop-submit-application-btn"
                type="button"
                onClick={handleSubmit}
                className={`w-full py-4 px-6 rounded-2xl font-bold text-sm shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer ${
                  isAllTermsAgreed
                    ? 'bg-gradient-to-r from-sky-500 to-sky-600 hover:from-sky-600 hover:to-sky-700 text-white shadow-sky-200 active:scale-[0.99]'
                    : 'bg-slate-200 text-slate-400 hover:bg-slate-300'
                }`}
              >
                <span>確認條款並送出審核</span>
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Terms Modal Viewer */}
      <AnimatePresence>
        {activeModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white w-full max-w-lg rounded-3xl p-6 sm:p-8 shadow-2xl flex flex-col max-h-[85vh] border border-slate-100"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <FileText className="h-5 w-5 text-sky-600" />
                  <h3 className="font-bold text-slate-800 text-base">
                    {activeModal === 'terms' && '數位存款帳戶開戶總約定書'}
                    {activeModal === 'privacy' && '個人資料保護法應告知事項'}
                    {activeModal === 'electronic' && '電子銀行服務作業條款'}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveModal(null)}
                  className="p-1.5 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="py-5 text-sm text-slate-600 leading-relaxed overflow-y-auto space-y-4 flex-1 font-sans">
                {activeModal === 'terms' && (
                  <>
                    <p className="font-bold text-slate-900">第一條（契約之目的及範圍）</p>
                    <p>本約定書係由貴客戶與本行共同訂立，旨在規範雙方於本行數位存款帳戶相關之各項存款、轉帳、提領及其他金融服務權利義務。</p>
                    <p className="font-bold text-slate-900">第二條（帳戶開立與身分核驗）</p>
                    <p>貴客戶同意本行依據金管會規範進行身分證資料辨識及金融級活體人臉防偽核驗。核驗通過後，帳戶即行生效。</p>
                    <p className="font-bold text-slate-900">第三條（存款計息與保障）</p>
                    <p>本帳戶為新臺幣活期儲蓄存款帳戶，受中央存款保險股份有限公司最高保額新臺幣 300 萬元之依法保障。</p>
                  </>
                )}
                {activeModal === 'privacy' && (
                  <>
                    <p className="font-bold text-slate-900">一、蒐集之目的</p>
                    <p>為辦理個人數位存款開戶、客戶身分確認（KYC）、反洗錢（AML）防制作業及提供各項數位金融服務。</p>
                    <p className="font-bold text-slate-900">二、個人資料之類別</p>
                    <p>包含姓名、國民身分證統一編號、出生年月日、住址、聯絡電話、電子郵件信箱及人臉生物辨識特徵影像等。</p>
                    <p className="font-bold text-slate-900">三、資料利用之期間與對象</p>
                    <p>自開戶申請日起至帳戶結清終止後依金融法規保存期限為止。本行承諾依 ISO 27001 標準進行高規格加密管理，絕不未經同意轉交第三人。</p>
                  </>
                )}
                {activeModal === 'electronic' && (
                  <>
                    <p className="font-bold text-slate-900">一、服務項目與登入安全</p>
                    <p>貴客戶得透過本行網路銀行、行動銀行 App 進行帳戶查詢、約定/非約定轉帳、各項繳費稅等數位交易。</p>
                    <p className="font-bold text-slate-900">二、密碼保管與生物辨識</p>
                    <p>貴客戶應妥善保管網路銀行使用者代號、登入密碼及交易驗證碼。啟用指紋或 Face ID 等生物特徵快速登入時，該裝置之權限應由本人專屬保管。</p>
                  </>
                )}
              </div>

              <div className="pt-4 border-t border-slate-100 flex justify-end">
                <button
                  type="button"
                  onClick={() => {
                    if (activeModal === 'terms') setAgreeTerms(true);
                    if (activeModal === 'privacy') setAgreePrivacy(true);
                    if (activeModal === 'electronic') setAgreeElectronic(true);
                    setActiveModal(null);
                  }}
                  className="py-2.5 px-5 rounded-xl bg-sky-500 hover:bg-sky-600 text-white text-xs font-bold transition-colors cursor-pointer"
                >
                  我已閱讀並同意
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
