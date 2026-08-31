import React, { useEffect, useState } from 'react';
import { AlertTriangle, Eye, ShieldCheck, Sparkles, Phone } from 'lucide-react';

// 對應 04_SRS_系統需求規格書.md 的 NFR-12／NFR-13：照明挑戰前要先
// 告知使用者接下來會有閃爍燈光、並提供替代驗證路徑的「說明」。
//
// 這次的實作範圍：只做「事前告知＋文字說明替代方案」，不做真的能在
// 系統裡完成的替代數位驗證流程——後者需要重新設計 common/fusion.py
// 的加權融合邏輯（讓某一層可以被跳過、剩下四層重新分配權重），是另一
// 個層級的工程量，這次先不做，跟夥伴討論後決定分開處理。

interface PhotometricConsentNoticeProps {
  onAcknowledge: () => void;
}

export const PhotometricConsentNotice: React.FC<PhotometricConsentNoticeProps> = ({
  onAcknowledge,
}) => {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [showAlternative, setShowAlternative] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefersReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
    mq.addEventListener?.('change', handler);
    return () => mq.removeEventListener?.('change', handler);
  }, []);

  return (
    <div className="w-full max-w-md mx-auto bg-white rounded-3xl border border-slate-200/80 shadow-xl p-6 space-y-5">
      <div className="flex items-center gap-3">
        <div className="h-11 w-11 rounded-2xl bg-amber-100 text-amber-600 flex items-center justify-center shrink-0">
          <Eye className="h-5 w-5" />
        </div>
        <div>
          <h3 className="text-base font-black text-slate-900">開始前的重要提醒</h3>
          <p className="text-xs text-slate-500">人臉驗證含照明響應測試</p>
        </div>
      </div>

      <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-200/80 text-xs text-amber-800 leading-relaxed flex items-start gap-2">
        <Sparkles className="h-4 w-4 shrink-0 mt-0.5 text-amber-500" />
        <p>
          驗證過程中，螢幕會顯示約 <strong>3 秒鐘、5 段快速切換的柔和色彩</strong>。
          切換頻率與亮度已依照 WCAG 2.3.1 安全門檻設計，一般情況下不會造成不適。
        </p>
      </div>

      {prefersReducedMotion && (
        <div className="p-3.5 rounded-2xl bg-sky-50 border border-sky-200/80 text-xs text-sky-800 leading-relaxed flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-sky-500" />
          <p>
            偵測到您的裝置設定了「減少動態效果」偏好。目前這項驗證仍需要顯示
            上述色彩切換才能完成，如果您對閃爍畫面敏感，建議參考下方的替代
            辦理方式。
          </p>
        </div>
      )}

      {!showAlternative ? (
        <div className="space-y-2.5">
          <button
            type="button"
            onClick={onAcknowledge}
            className="w-full py-3.5 rounded-2xl bg-sky-500 hover:bg-sky-600 active:scale-[0.99] text-white font-bold text-sm shadow-lg shadow-sky-500/20 flex items-center justify-center gap-2 cursor-pointer transition-all"
          >
            <ShieldCheck className="h-4 w-4" />
            <span>我已了解，開始驗證</span>
          </button>
          <button
            type="button"
            onClick={() => setShowAlternative(true)}
            className="w-full py-2.5 rounded-2xl bg-white hover:bg-slate-50 text-slate-500 font-semibold text-xs border border-slate-200 cursor-pointer transition-all"
          >
            我對閃爍燈光敏感，需要其他辦理方式
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 text-xs text-slate-600 leading-relaxed flex items-start gap-2">
            <Phone className="h-4 w-4 shrink-0 mt-0.5 text-slate-400" />
            <p>
              若您對閃爍燈光敏感，此線上驗證方式暫不適合您。請改至本行實體
              分行辦理臨櫃開戶，或撥打客服專線 <strong>0800-000-888</strong>{' '}
              由專人協助安排其他驗證方式。
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowAlternative(false)}
            className="w-full py-2.5 rounded-2xl bg-white hover:bg-slate-50 text-slate-500 font-semibold text-xs border border-slate-200 cursor-pointer transition-all"
          >
            返回
          </button>
        </div>
      )}
    </div>
  );
};
