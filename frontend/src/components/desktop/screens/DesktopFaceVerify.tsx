import React from 'react';
import { FormData } from '../../../types';
import { FaceVerificationEngine } from '../../face/FaceVerificationEngine';
import { AIGuardian } from '../../AIGuardian';
import { 
  ShieldCheck, 
  Sparkles, 
  CheckCircle2, 
  Lock, 
  ScanFace,
  Eye,
  Hand,
  ArrowLeft,
  ArrowRight,
  Shield,
  Activity,
  Award,
  SunMedium
} from 'lucide-react';

interface DesktopFaceVerifyProps {
  formData: FormData;
  updateFormData: (data: Partial<FormData>) => void;
  onNext: () => void;
}

export const DesktopFaceVerify: React.FC<DesktopFaceVerifyProps> = ({
  formData,
  updateFormData,
  onNext,
}) => {
  const handleVerificationComplete = (confidence: number, photometricPassed = true) => {
    updateFormData({
      faceVerified: true,
      faceConfidence: confidence,
      photometricPassed: photometricPassed,
      photometricScore: confidence,
    });
  };

  // 2026-08-20：原本這裡是固定寫死「01 向左轉頭 → 02 揮手 → 03 眨眼 →
  // 04 向右轉頭」，但實際順序現在是伺服器隨機指派（見
  // FaceVerificationEngine 裡的 challenge-order 串接），寫死的列表會
  // 誤導使用者以為順序永遠一樣。這裡改成通用說明，不再列出假的固定
  // 順序；真正的順序會直接顯示在鏡頭畫面裡（跟 mobile 版行為一致）。
  const actionMilestones = [
    { title: '4 個動作指令', desc: '眨眼、左轉、右轉、揮手，每次順序皆為系統隨機指派', icon: ScanFace },
    { title: '照明響應', desc: '保持不動，螢幕會顯示一段隨機顏色序列', icon: SunMedium },
  ];

  if (!formData.applicantId || !formData.sessionId) {
    return (
      <div className="flex flex-col flex-1 items-center justify-center py-16 text-center">
        <p className="text-sm font-bold text-rose-600">找不到申請資料</p>
        <p className="text-xs text-slate-500 mt-1">請先完成「確認個人資料」步驟後再回來這裡。</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col justify-between h-full space-y-6">
      {/* Header */}
      <div className="border-b border-slate-100 pb-4 flex items-center justify-between">
        <div>
          <span className="text-xs font-bold text-sky-600 bg-sky-50 px-2.5 py-1 rounded-md border border-sky-100">
            Step 4 / 6 • 動態人臉防偽
          </span>
          <h1 className="text-2xl font-black text-slate-900 mt-2">
            人臉動態防偽驗證
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            動作指令與方向箭頭直接呈現在鏡頭畫面中央，注視鏡頭即可輕鬆完成驗證。
          </p>
        </div>

        <div className="hidden sm:flex items-center gap-2 bg-emerald-50 px-3.5 py-1.5 rounded-xl border border-emerald-200 text-emerald-700 text-xs font-semibold">
          <ShieldCheck className="h-4 w-4" />
          <span>FIDO2 / 金管會規範金融級活體防偽</span>
        </div>
      </div>

      {/* 2-Column Desktop Grid (Left: Camera-first, Right: Supplementary Milestones & Security) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left: Large In-Camera Viewfinder (7 cols) */}
        <div className="lg:col-span-7 flex flex-col items-center">
          <FaceVerificationEngine
            applicantId={formData.applicantId}
            sessionId={formData.sessionId}
            onVerificationComplete={handleVerificationComplete}
            onProceedNext={onNext}
            isDesktop={true}
          />
        </div>

        {/* Right: Supplementary Milestones & Security Details (5 cols) */}
        <div className="lg:col-span-5 space-y-4">
          {/* Action Sequence Overview Card */}
          <div className="bg-slate-50/70 p-5 rounded-2xl border border-slate-200/80 space-y-3.5">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                <Activity className="h-4 w-4 text-sky-600" />
                動態核驗指引與照明響應
              </h2>
              <span className="text-[11px] font-semibold text-sky-600">智能隨機序列</span>
            </div>

            <p className="text-xs text-slate-500 leading-relaxed">
              驗證時請專注注視左側鏡頭，系統會在畫面中央直接提示箭頭與倒數：
            </p>

            <div className="space-y-2">
              {actionMilestones.map((item, i) => {
                const Icon = item.icon;
                return (
                  <div
                    key={i}
                    className="p-3 bg-white rounded-xl border border-slate-200/70 flex items-center justify-between"
                  >
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-lg bg-sky-50 text-sky-600 flex items-center justify-center text-xs font-bold">
                        <Icon className="h-4 w-4" />
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-slate-800">{item.title}</h4>
                        <p className="text-[11px] text-slate-400">{item.desc}</p>
                      </div>
                    </div>

                    <span className="text-[10px] font-semibold text-slate-400 bg-slate-100 px-2 py-0.5 rounded">
                      鏡頭直覺導引
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Security & Friendly Mascot Guidance */}
          <div className="p-4 rounded-2xl bg-gradient-to-br from-sky-50/80 to-emerald-50/50 border border-sky-100 space-y-2.5">
            <div className="flex items-center gap-3">
              <AIGuardian size="sm" mood="guiding" />
              <div>
                <h4 className="text-xs font-bold text-slate-900">GuardFrame 守護小叮嚀</h4>
                <p className="text-[11px] text-slate-500">
                  請保持面部光線充足，若畫面提示偏離，依箭頭微調位置即可自動繼續。
                </p>
              </div>
            </div>

            <div className="pt-2 border-t border-sky-200/60 flex items-center justify-between text-[11px] text-emerald-800 font-medium">
              <span className="flex items-center gap-1">
                <Lock className="h-3 w-3 text-emerald-600" />
                256-bit TLS 傳輸加密
              </span>
              <span className="flex items-center gap-1">
                <ShieldCheck className="h-3 w-3 text-emerald-600" />
                防 Deepfake AI 偵測
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
