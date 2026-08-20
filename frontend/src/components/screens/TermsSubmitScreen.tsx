import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { FormData } from '../../types';
import { setupAccount, ApiError } from '../../api/client';
import { 
  ShieldCheck, 
  FileText, 
  ExternalLink, 
  X, 
  ArrowRight, 
  Loader2,
  CheckCircle2,
  AlertCircle,
  Lock,
  CreditCard,
  User,
  Bell,
  Check
} from 'lucide-react';

interface TermsSubmitScreenProps {
  formData: FormData;
  updateFormData: (data: Partial<FormData>) => void;
  onNext: () => void;
}

export const TermsSubmitScreen: React.FC<TermsSubmitScreenProps> = ({
  formData,
  updateFormData,
  onNext,
}) => {
  // Terms Agreement States
  const [agreeTerms, setAgreeTerms] = useState<boolean>(formData.agreeTerms ?? false);
  const [agreePrivacy, setAgreePrivacy] = useState<boolean>(formData.agreePrivacy ?? false);
  const [agreeElectronic, setAgreeElectronic] = useState<boolean>(formData.agreeElectronic ?? false);

  // 2026-08-20 新增：後端 account-setup 要求 6 位數交易密碼
  // （CONVENTIONS §5.8），但前端原本沒有任何畫面收集這個值
  // （FormData.accountPin 定義了卻從沒被設定過）——這裡補上最小可用的
  // 輸入欄位，不是重新設計整個帳戶設定流程。
  const [accountPin, setAccountPin] = useState<string>(formData.accountPin || '');
  const [pinError, setPinError] = useState<string>('');

  // Modal State for Terms viewer
  const [activeModal, setActiveModal] = useState<'terms' | 'privacy' | 'electronic' | null>(null);

  // Submission Loading State
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
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

  const handleSubmit = async () => {
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
    setIsSubmitting(true);

    try {
      // 真的呼叫 POST /api/applicants/{id}/account-setup（§5.8）。
      // cardStyle -> accountType、notificationMethod -> notificationPreference
      // 是這次整合時決定的映射，後端跟前端在這兩個欄位上本來就沒有
      // 完全對應的概念，見 07 spec 的說明。
      await setupAccount(formData.applicantId, formData.sessionId, {
        accountType: formData.cardStyle === 'style_b' ? 'type3' : 'type1',
        transactionPassword: accountPin,
        notificationPreference: {
          sms: formData.notificationMethod === 'sms' || formData.notificationMethod === 'both',
          email: formData.notificationMethod === 'email' || formData.notificationMethod === 'both',
        },
        termsAccepted: true,
      });

      updateFormData({
        agreeTerms,
        agreePrivacy,
        agreeElectronic,
        accountPin,
      });

      onNext();
    } catch (err) {
      setSubmitError(
        err instanceof ApiError
          ? `送出失敗：${err.message}`
          : '無法連線到後端伺服器，請確認伺服器是否已啟動'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const cardStyleName = formData.cardStyle === 'style_b' ? '極光冰川白 (限定版)' : '極簡深海藍 (經典版)';
  const notifyName = formData.notificationMethod === 'sms' ? '簡訊通知' : formData.notificationMethod === 'email' ? '電子郵件' : '簡訊 + 電子郵件';

  return (
    <div className="flex flex-col flex-1 px-5 pt-3 pb-8 bg-white select-none">
      {/* Step Header */}
      <div className="mb-4">
        <span className="text-[11px] font-bold text-sky-600 bg-sky-50 px-2 py-0.5 rounded-md border border-sky-100">
          Step 6 / 6
        </span>
        <h1 className="text-xl font-black text-slate-900 tracking-tight mt-1.5">
          確認條款與送出審核
        </h1>
        <p className="text-xs text-slate-500 mt-0.5">
          請核對您的申請摘要並詳閱法定條款，確認無誤後送出。
        </p>
      </div>

      <div className="space-y-4 flex-1">
        {/* Application Summary Card */}
        <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-2.5">
          <div className="flex items-center justify-between border-b border-slate-200/60 pb-2">
            <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
              <User className="h-3.5 w-3.5 text-sky-600" />
              開戶申請人摘要
            </span>
            <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
              已通過人臉防偽
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-[10px] text-slate-400">中文姓名</span>
              <p className="font-bold text-slate-800">{formData.fullName || '林語堂'}</p>
            </div>
            <div>
              <span className="text-[10px] text-slate-400">身分證字號</span>
              <p className="font-bold text-slate-800 font-mono">
                {formData.idNumber ? `${formData.idNumber.slice(0, 3)}****${formData.idNumber.slice(-2)}` : 'A123456789'}
              </p>
            </div>
            <div>
              <span className="text-[10px] text-slate-400">選擇金融卡面</span>
              <p className="font-semibold text-slate-700">{cardStyleName}</p>
            </div>
            <div>
              <span className="text-[10px] text-slate-400">交易通知管道</span>
              <p className="font-semibold text-slate-700">{notifyName}</p>
            </div>
          </div>
        </div>

        {/* Transaction Password (6-digit PIN) */}
        <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-2">
          <label htmlFor="mobile-account-pin" className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
            <Lock className="h-3.5 w-3.5 text-sky-600" />
            <span>設定交易密碼（6 位數字）</span>
          </label>
          <input
            id="mobile-account-pin"
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
          {pinError && <p className="text-[11px] text-rose-500 font-medium">{pinError}</p>}
        </div>

        {/* Legal Terms & Agreements */}
        <div className="p-4 rounded-2xl bg-sky-50/50 border border-sky-100 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
              <ShieldCheck className="h-4 w-4 text-sky-600" />
              <span>法定條款與個資聲明</span>
            </span>

            {/* Select All Button */}
            <button
              type="button"
              onClick={handleToggleAllTerms}
              className="text-[11px] font-bold text-sky-600 hover:text-sky-700 flex items-center gap-1 bg-white px-2 py-1 rounded-lg border border-sky-200 cursor-pointer active:scale-95 transition-all"
            >
              <Check className={`h-3 w-3 ${isAllTermsAgreed ? 'text-emerald-500' : 'text-slate-400'}`} />
              <span>{isAllTermsAgreed ? '全部已同意' : '全部同意'}</span>
            </button>
          </div>

          <div className="space-y-2 text-xs">
            {/* Term 1 */}
            <div className="flex items-start gap-2.5 bg-white p-2.5 rounded-xl border border-slate-200/80">
              <input
                id="mobile-agree-terms"
                type="checkbox"
                checked={agreeTerms}
                onChange={(e) => {
                  setAgreeTerms(e.target.checked);
                  if (e.target.checked && agreePrivacy && agreeElectronic) setShowValidationWarning(false);
                }}
                className="mt-0.5 h-4 w-4 text-sky-600 rounded-sm border-slate-300 focus:ring-sky-500 cursor-pointer"
              />
              <div className="flex-1 flex items-center justify-between">
                <label htmlFor="mobile-agree-terms" className="text-[11px] text-slate-700 cursor-pointer font-medium">
                  我已閱讀並同意 <span className="font-bold text-slate-900">數位存款帳戶開戶總約定書</span>
                </label>
                <button
                  type="button"
                  onClick={() => setActiveModal('terms')}
                  className="text-[10px] text-sky-600 hover:text-sky-700 flex items-center gap-0.5 ml-1 flex-shrink-0 cursor-pointer"
                >
                  <span>詳閱</span>
                  <ExternalLink className="h-2.5 w-2.5" />
                </button>
              </div>
            </div>

            {/* Term 2 */}
            <div className="flex items-start gap-2.5 bg-white p-2.5 rounded-xl border border-slate-200/80">
              <input
                id="mobile-agree-privacy"
                type="checkbox"
                checked={agreePrivacy}
                onChange={(e) => {
                  setAgreePrivacy(e.target.checked);
                  if (agreeTerms && e.target.checked && agreeElectronic) setShowValidationWarning(false);
                }}
                className="mt-0.5 h-4 w-4 text-sky-600 rounded-sm border-slate-300 focus:ring-sky-500 cursor-pointer"
              />
              <div className="flex-1 flex items-center justify-between">
                <label htmlFor="mobile-agree-privacy" className="text-[11px] text-slate-700 cursor-pointer font-medium">
                  我已詳閱 <span className="font-bold text-slate-900">個人資料保護法應告知事項</span>
                </label>
                <button
                  type="button"
                  onClick={() => setActiveModal('privacy')}
                  className="text-[10px] text-sky-600 hover:text-sky-700 flex items-center gap-0.5 ml-1 flex-shrink-0 cursor-pointer"
                >
                  <span>詳閱</span>
                  <ExternalLink className="h-2.5 w-2.5" />
                </button>
              </div>
            </div>

            {/* Term 3 */}
            <div className="flex items-start gap-2.5 bg-white p-2.5 rounded-xl border border-slate-200/80">
              <input
                id="mobile-agree-electronic"
                type="checkbox"
                checked={agreeElectronic}
                onChange={(e) => {
                  setAgreeElectronic(e.target.checked);
                  if (agreeTerms && agreePrivacy && e.target.checked) setShowValidationWarning(false);
                }}
                className="mt-0.5 h-4 w-4 text-sky-600 rounded-sm border-slate-300 focus:ring-sky-500 cursor-pointer"
              />
              <div className="flex-1 flex items-center justify-between">
                <label htmlFor="mobile-agree-electronic" className="text-[11px] text-slate-700 cursor-pointer font-medium">
                  同意遵守 <span className="font-bold text-slate-900">電子銀行服務作業條款</span>
                </label>
                <button
                  type="button"
                  onClick={() => setActiveModal('electronic')}
                  className="text-[10px] text-sky-600 hover:text-sky-700 flex items-center gap-0.5 ml-1 flex-shrink-0 cursor-pointer"
                >
                  <span>詳閱</span>
                  <ExternalLink className="h-2.5 w-2.5" />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Validation Warning when attempting to submit without agreeing */}
        {showValidationWarning && (
          <motion.div
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-3 rounded-xl bg-rose-50 border border-rose-200 flex items-center gap-2 text-rose-700 text-xs font-semibold"
          >
            <AlertCircle className="h-4 w-4 text-rose-500 flex-shrink-0" />
            <span>請勾選同意全部 3 項開戶條款後方可送出審核。</span>
          </motion.div>
        )}

        {submitError && (
          <motion.div
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-3 rounded-xl bg-rose-50 border border-rose-200 flex items-center gap-2 text-rose-700 text-xs font-semibold"
          >
            <AlertCircle className="h-4 w-4 text-rose-500 flex-shrink-0" />
            <span>{submitError}</span>
          </motion.div>
        )}

        {/* Encryption Guarantee Notice */}
        <div className="flex items-center justify-center gap-1.5 text-[11px] text-slate-400">
          <Lock className="h-3.5 w-3.5 text-emerald-600" />
          <span>送出時將以 256-bit TLS 傳輸至銀行核心核心系統</span>
        </div>
      </div>

      {/* Submit Button */}
      <div className="pt-4 mt-auto">
        <button
          id="submit-application-btn"
          type="button"
          disabled={isSubmitting}
          onClick={handleSubmit}
          className={`w-full py-3.5 px-4 rounded-2xl font-bold text-sm shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer ${
            isAllTermsAgreed
              ? 'bg-gradient-to-r from-sky-500 to-sky-600 hover:from-sky-600 hover:to-sky-700 text-white shadow-sky-200 active:scale-[0.99]'
              : 'bg-slate-200 text-slate-400 hover:bg-slate-300'
          }`}
        >
          {isSubmitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin text-white" />
              <span>核心加密送審中...</span>
            </>
          ) : (
            <>
              <span>確認條款並送出審核</span>
              <ArrowRight className="h-4 w-4" />
            </>
          )}
        </button>
      </div>

      {/* Terms Modal Viewer */}
      <AnimatePresence>
        {activeModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white w-full max-w-md rounded-3xl p-6 shadow-2xl flex flex-col max-h-[80vh] border border-slate-100"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <FileText className="h-5 w-5 text-sky-600" />
                  <h3 className="font-bold text-slate-800 text-sm">
                    {activeModal === 'terms' && '數位存款帳戶開戶總約定書'}
                    {activeModal === 'privacy' && '個人資料保護法應告知事項'}
                    {activeModal === 'electronic' && '電子銀行服務作業條款'}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveModal(null)}
                  className="p-1 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="py-4 text-xs text-slate-600 leading-relaxed overflow-y-auto space-y-3 flex-1 font-sans">
                {activeModal === 'terms' && (
                  <>
                    <p className="font-bold text-slate-800">第一條（契約之目的及範圍）</p>
                    <p>本約定書係由貴客戶與本行共同訂立，旨在規範雙方於本行數位存款帳戶相關之各項存款、轉帳、提領及其他金融服務權利義務。</p>
                    <p className="font-bold text-slate-800">第二條（帳戶開立與身分核驗）</p>
                    <p>貴客戶同意本行依據金管會規範進行身分證 OCR 光學字元辨識及金融級活體人臉防偽核驗。核驗通過後，帳戶即行生效。</p>
                    <p className="font-bold text-slate-800">第三條（存款計息與保障）</p>
                    <p>本帳戶為新臺幣活期儲蓄存款帳戶，受中央存款保險股份有限公司最高保額新臺幣 300 萬元之依法保障。</p>
                  </>
                )}
                {activeModal === 'privacy' && (
                  <>
                    <p className="font-bold text-slate-800">一、蒐集之目的</p>
                    <p>為辦理個人數位存款開戶、客戶身分確認（KYC）、反洗錢（AML）防制作業及提供各項數位金融服務。</p>
                    <p className="font-bold text-slate-800">二、個人資料之類別</p>
                    <p>包含姓名、國民身分證統一編號、出生年月日、住址、聯絡電話、電子郵件信箱及人臉生物辨識特徵影像等。</p>
                    <p className="font-bold text-slate-800">三、資料利用之期間與對象</p>
                    <p>自開戶申請日起至帳戶結清終止後依金融法規保存期限為止。本行承諾依 ISO 27001 標準進行高規格加密管理，絕不未經同意轉交第三人。</p>
                  </>
                )}
                {activeModal === 'electronic' && (
                  <>
                    <p className="font-bold text-slate-800">一、服務項目與登入安全</p>
                    <p>貴客戶得透過本行網路銀行、行動銀行 App 進行帳戶查詢、約定/非約定轉帳、各項繳費稅等數位交易。</p>
                    <p className="font-bold text-slate-800">二、密碼保管與生物辨識</p>
                    <p>貴客戶應妥善保管網路銀行使用者代號、登入密碼及交易驗證碼。啟用指紋或 Face ID 等生物特徵快速登入時，該裝置之權限應由本人專屬保管。</p>
                  </>
                )}
              </div>

              <div className="pt-3 border-t border-slate-100 flex justify-end">
                <button
                  type="button"
                  onClick={() => {
                    if (activeModal === 'terms') setAgreeTerms(true);
                    if (activeModal === 'privacy') setAgreePrivacy(true);
                    if (activeModal === 'electronic') setAgreeElectronic(true);
                    setActiveModal(null);
                  }}
                  className="py-2 px-4 rounded-xl bg-sky-500 hover:bg-sky-600 text-white text-xs font-bold transition-colors cursor-pointer"
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
